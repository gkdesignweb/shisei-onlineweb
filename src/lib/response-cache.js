// Tiny in-process response cache for read-heavy public endpoints.
// Trade-off: skip the Tokyo Supabase round-trip at the cost of N seconds
// of staleness. Bust by either calling bustResponseCache() on admin writes
// or letting the TTL expire (default 60s).
//
// SAFETY: never use this on user-specific responses (cart, auth/me).
// SAFETY: pass a stable cache key — defaults to req.originalUrl, which is
// fine for endpoints whose response depends only on the URL.

const store = new Map(); // key -> { body: string, etag: string, contentType, exp }
const DEFAULT_TTL_MS = 60_000;

export function withCache(ttlSeconds, handler) {
  const ttlMs = ttlSeconds * 1000;
  return async (req, res, next) => {
    const key = req.originalUrl;
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.exp > now) {
      res.set('Content-Type', hit.contentType || 'application/json; charset=utf-8');
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`);
      // 304 short-circuit when client already has it.
      if (req.headers['if-none-match'] === hit.etag) {
        return res.status(304).end();
      }
      res.set('ETag', hit.etag);
      return res.send(hit.body);
    }

    // Capture res.json output so we can cache it.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const serialized = JSON.stringify(body);
      const etag = 'W/"' + simpleHash(serialized) + '"';
      store.set(key, {
        body: serialized,
        etag,
        contentType: 'application/json; charset=utf-8',
        exp: Date.now() + ttlMs,
      });
      res.set('ETag', etag);
      res.set('X-Cache', 'MISS');
      res.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`);
      return originalJson(body);
    };

    try {
      await handler(req, res, next);
    } catch (e) {
      next(e);
    }
  };
}

// 32-bit FNV-1a — fast non-crypto hash for ETags.
function simpleHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function bustResponseCache(prefix = '') {
  if (!prefix) { store.clear(); return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

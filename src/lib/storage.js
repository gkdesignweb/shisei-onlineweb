// Supabase Storage adapter — replaces the local `public/uploads/` disk write
// so admin media uploads persist on Vercel (whose serverless filesystem is
// read-only). Uses the SERVICE ROLE key server-side to bypass RLS.
//
// Setup steps (once, in Supabase dashboard):
//   1. Storage → New bucket → name: "uploads" → PUBLIC
//   2. Project Settings → API → copy the `service_role` key
//   3. Set env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
import { createClient } from '@supabase/supabase-js';

let cached = null;

export function getSupabase() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const BUCKET = 'uploads';

// Upload a file buffer to Supabase Storage. Returns the public URL that can
// go straight into an <img src="..."> tag.
export async function uploadToStorage({ buffer, path, contentType }) {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase_not_configured');

  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
    cacheControl: '31536000, immutable',
  });
  if (error) throw new Error('storage_upload_failed: ' + error.message);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFromStorage(pathOrUrl) {
  const sb = getSupabase();
  if (!sb) return;
  // Accept either "uploads/2026/06/hash.png" or a full public URL.
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = pathOrUrl.indexOf(marker);
  const key = idx >= 0 ? pathOrUrl.slice(idx + marker.length) : pathOrUrl.replace(/^\/+/, '');
  await sb.storage.from(BUCKET).remove([key]).catch(() => {});
}

// Convenience: is Supabase Storage available?
export function isStorageAvailable() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

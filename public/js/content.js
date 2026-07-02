// Hydrates [data-content="key"] elements with values from /api/content.
// - data-content alone: replaces innerHTML (newlines → <br>)
// - data-content + data-content-attr: sets that attribute (e.g. img src)
//   Empty values are SKIPPED so we don't break image src or break a placeholder.
// - Logo: when a real URL is set on site.logo.url, hides any [data-logo-fallback]
//   siblings (the "M" badge) and reveals the image element.

// Pull the medical-professional confirmation gate onto every public page.
// content.js is the universal injection point — every public page already loads
// it, and admin pages don't, which matches the gate's audience.
(function loadProfGate() {
  if (/^\/admin/.test(location.pathname)) return;
  const s = document.createElement('script');
  s.src = '/js/professional-gate.js'; s.defer = true;
  document.head.appendChild(s);
})();

(async function () {
  // cache: 'no-store' kills the stale-then-refresh flash users saw — every
  // page load reads fresh content from /api/content (server-side cache still
  // covers cost, ~0ms when warm).
  const map = await fetch('/api/content', { cache: 'no-store' })
    .then((r) => r.json()).then((d) => d.content).catch(() => ({}));

  document.querySelectorAll('[data-content]').forEach((el) => {
    const key = el.dataset.content;
    const val = map[key];
    if (val === undefined) return;
    if (el.dataset.contentAttr) {
      if (val) {
        el.setAttribute(el.dataset.contentAttr, val);
        // Hero <video>: once a real src is in, kick the browser to (re)load
        // and start playback — otherwise the element shows the initial poster.
        if (el.tagName === 'VIDEO') {
          el.classList.remove('hidden');
          try { el.load(); el.play(); } catch {}
          // If the bg image is also bound and a video is present, hide it so
          // we don't double-stack media.
          const sib = document.getElementById('heroBgImage');
          if (sib) sib.classList.add('hidden');
          const fb = document.getElementById('heroBgFallback');
          if (fb) fb.classList.add('hidden');
        }
        // Hero <img> reveal (mirrors the legacy site.logo.url path)
        if (el.tagName === 'IMG' && el.id === 'heroBgImage') {
          // Only show the image if no video URL got set above
          const vid = document.getElementById('heroBgVideo');
          if (!vid?.getAttribute('src')) {
            el.classList.remove('hidden');
            const fb = document.getElementById('heroBgFallback');
            if (fb) fb.classList.add('hidden');
          }
        }
      }
    } else {
      el.innerHTML = String(val).replace(/\n/g, '<br>');
    }
  });

  // Brand swap: if site.logo.url is set, show the image element(s) bound to
  // it and hide the "M" fallback marker(s).
  if (map['site.logo.url']) {
    document.querySelectorAll('[data-content="site.logo.url"][data-content-attr="src"]')
      .forEach((el) => el.classList.remove('hidden'));
    document.querySelectorAll('[data-logo-fallback]')
      .forEach((el) => el.classList.add('hidden'));
  }

  // Inline "編輯內容" floating button was removed per spec —
  // admins now edit copy exclusively through /admin-content.html.
})();

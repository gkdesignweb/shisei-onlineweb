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

  const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => ({}));
  if (me?.user?.role !== 'MANAGER' && !me?.user?.isSuperAdmin) return;

  const btn = document.createElement('button');
  btn.id = 'cms-edit-toggle';
  btn.textContent = '✏️ 編輯內容';
  Object.assign(btn.style, {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: 9999,
    background: '#0f766e', color: 'white', border: 'none',
    padding: '10px 16px', borderRadius: '999px', fontWeight: '700',
    fontSize: '14px', boxShadow: '0 10px 25px rgba(15,118,110,.35)', cursor: 'pointer',
  });
  document.body.appendChild(btn);

  let editing = false;
  btn.addEventListener('click', () => {
    editing = !editing;
    btn.textContent = editing ? '✅ 完成編輯' : '✏️ 編輯內容';
    btn.style.background = editing ? '#dc2626' : '#0f766e';
    document.querySelectorAll('[data-content]').forEach((el) => {
      if (el.dataset.contentAttr) return;
      el.contentEditable = editing ? 'true' : 'false';
      el.style.outline = editing ? '2px dashed #14b8a6' : '';
      el.style.borderRadius = editing ? '4px' : '';
      el.style.padding = editing ? '2px 4px' : '';
      if (editing && !el.dataset.cmsBound) {
        el.dataset.cmsBound = '1';
        el.addEventListener('blur', async () => {
          const key = el.dataset.content;
          const valueZh = el.innerText;
          await fetch('/api/content/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key, group: key.split('.')[0] ?? 'misc',
              label: key, valueZh, kind: 'text',
            }),
          });
        });
      }
    });
  });
})();

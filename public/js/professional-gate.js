// Medical-professional confirmation gate.
//
// Behavior:
//   1. Fetch /api/site → profGate.{enabled, title, body, confirmLabel, declineLabel}.
//   2. If disabled, do nothing.
//   3. If localStorage["profGateConfirmed"] = "1", do nothing.
//   4. Otherwise inject a full-screen overlay that blocks interaction until
//      the visitor confirms. Decline → window.location = "about:blank".
//
// Loaded on every public page. Skipped on /admin*.html so staff aren't gated.
(function () {
  if (/^\/admin/.test(location.pathname)) return;

  const KEY_AT = 'profGateConfirmedAt';
  const TIMEOUT_MS = 2 * 60 * 1000; // re-prompt after 2 minutes of absence

  // Heartbeat: while the page is open, keep stamping "I'm still here". When the
  // visitor leaves and comes back later, the gap between the last heartbeat and
  // page load tells us how long they were away.
  function heartbeat() {
    try { localStorage.setItem(KEY_AT, String(Date.now())); } catch {}
  }
  setInterval(heartbeat, 15_000);
  window.addEventListener('beforeunload', heartbeat);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') heartbeat(); });

  // Trust check: confirmed within the last TIMEOUT_MS → bail without a fetch.
  let confirmedAt = 0;
  try { confirmedAt = parseInt(localStorage.getItem(KEY_AT) || '0', 10); } catch {}
  if (confirmedAt && (Date.now() - confirmedAt) < TIMEOUT_MS) return;

  fetch('/api/site').then((r) => r.json()).then((site) => {
    const g = site?.profGate;
    if (!g || !g.enabled) return;
    show(g);
  }).catch(() => {});

  function show(g) {
    // Lock scroll until resolved.
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const wrap = document.createElement('div');
    wrap.id = 'prof-gate-overlay';
    wrap.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.78);
      display: grid; place-items: center; padding: 24px;
      font-family: 'Noto Sans TC', system-ui, sans-serif;
    `;
    wrap.innerHTML = `
      <div role="dialog" aria-modal="true" style="
        max-width: 480px; width: 100%; background: #fff; border-radius: 20px;
        padding: 32px 28px; box-shadow: 0 20px 60px rgba(0,0,0,.35);
        text-align: center;
      ">
        <div style="width:64px;height:64px;border-radius:50%;background:#ecfdf5;color:#0d9488;
                    display:grid;place-items:center;margin:0 auto 18px;font-size:32px;">🩺</div>
        <h2 style="font-size:1.35rem;font-weight:900;color:#0f172a;margin:0 0 12px;">
          ${escapeHtml(g.title || '醫療專業人員確認')}
        </h2>
        <div style="color:#475569;line-height:1.7;font-size:0.95rem;margin-bottom:24px;">
          ${g.body || ''}
        </div>
        <button id="prof-gate-confirm" style="
          background:#0d9488;color:#fff;font-weight:700;font-size:0.95rem;
          border:0;border-radius:9999px;padding:12px 24px;cursor:pointer;width:100%;
        ">${escapeHtml(g.confirmLabel || '我是醫療專業人員，繼續瀏覽')}</button>
        <button id="prof-gate-decline" style="
          background:transparent;color:#64748b;font-weight:500;font-size:0.85rem;
          border:0;padding:12px;cursor:pointer;margin-top:6px;width:100%;
        ">${escapeHtml(g.declineLabel || '離開')}</button>
      </div>`;
    document.body.appendChild(wrap);

    wrap.querySelector('#prof-gate-confirm').addEventListener('click', () => {
      heartbeat();
      document.documentElement.style.overflow = prevOverflow;
      wrap.remove();
    });
    wrap.querySelector('#prof-gate-decline').addEventListener('click', () => {
      // Leave the site. about:blank is intentional — we don't want to send
      // them somewhere we can't control.
      window.location.replace('about:blank');
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[<>&"']/g, (c) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();

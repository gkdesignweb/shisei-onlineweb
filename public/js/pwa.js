// Register the service worker + show a small "install" hint on mobile when
// the browser fires beforeinstallprompt (Android Chrome). iOS users still
// install via Safari Share → "加入主畫面"; we surface a one-line tip too.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) =>
      console.warn('[pwa] sw register failed:', err)
    );
  });
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBubble();
});

function showInstallBubble() {
  if (document.getElementById('__pwaInstall')) return;
  const bubble = document.createElement('button');
  bubble.id = '__pwaInstall';
  bubble.textContent = '📲 安裝 App';
  Object.assign(bubble.style, {
    position: 'fixed', right: '16px', bottom: '88px',
    background: '#0d9488', color: '#fff',
    border: 'none', borderRadius: '999px',
    padding: '10px 14px', fontSize: '13px', fontWeight: '700',
    boxShadow: '0 10px 25px rgba(15,118,110,.35)', zIndex: 9998,
    cursor: 'pointer',
  });
  bubble.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    bubble.remove();
  });
  document.body.appendChild(bubble);
}

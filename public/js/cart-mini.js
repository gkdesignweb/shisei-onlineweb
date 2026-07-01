// Mini-cart popover. Any element with [data-mini-cart] (button or anchor)
// triggers the popover instead of navigating. Click outside or X to close.
(function () {
  let panel = null;

  function ensure() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = '__miniCart';
    panel.style.cssText = `
      position:fixed; right:16px; top:64px; width:360px; max-width:calc(100vw - 24px);
      max-height:75vh; overflow:hidden; background:#fff; border-radius:18px;
      box-shadow:0 25px 50px -12px rgba(0,0,0,.25); border:1px solid #e2e8f0;
      z-index:10000; display:none; flex-direction:column;
    `;
    panel.innerHTML = `
      <div style="padding:14px 16px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center">
        <span style="font-weight:700">購物車</span>
        <button id="__miniClose" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:18px">×</button>
      </div>
      <div id="__miniBody" style="flex:1; overflow-y:auto; padding:12px 16px"></div>
      <div id="__miniFooter" style="padding:12px 16px; border-top:1px solid #f1f5f9"></div>`;
    document.body.appendChild(panel);
    panel.querySelector('#__miniClose').addEventListener('click', close);
    document.addEventListener('click', (e) => {
      if (!panel || panel.style.display === 'none') return;
      if (panel.contains(e.target)) return;
      if (e.target.closest('[data-mini-cart]')) return;
      close();
    });
    return panel;
  }

  function close() { if (panel) panel.style.display = 'none'; }

  async function open() {
    const el = ensure();
    el.style.display = 'flex';

    const body = el.querySelector('#__miniBody');
    const footer = el.querySelector('#__miniFooter');
    body.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:24px 0">載入中…</p>';

    let data;
    try { data = await fetch('/api/cart').then(r => r.ok ? r.json() : null); } catch {}
    if (!data) {
      body.innerHTML = `<p style="text-align:center;color:#475569;padding:24px 0;font-size:13px">請先 <a href="/login.html" style="color:#0d9488;text-decoration:underline">登入</a> 才能使用購物車。</p>`;
      footer.innerHTML = '';
      return;
    }
    const { items, subtotal } = data;
    if (!items.length) {
      body.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:24px 0">購物車是空的</p>';
      footer.innerHTML = '';
      return;
    }
    body.innerHTML = items.map((it) => `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f8fafc">
        <div style="width:48px;height:48px;background:#f1f5f9;border-radius:8px;overflow:hidden;flex-shrink:0">
          ${it.imageUrl ? `<img src="${it.imageUrl}" style="width:100%;height:100%;object-fit:cover"/>` : '<div style="display:grid;place-items:center;height:100%;font-size:18px">📦</div>'}
        </div>
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.nameZh}</p>
          <p style="font-size:11px;color:#64748b;margin:2px 0 0">${it.variantName ? it.variantName + ' · ' : ''}× ${it.quantity}</p>
        </div>
        <p style="font-size:13px;font-weight:700;color:#0f766e;margin:0">NT$ ${it.lineTotal.toLocaleString()}</p>
      </div>`).join('');
    footer.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px">
        <span style="color:#64748b">小計</span>
        <span style="font-weight:800;color:#0f172a">NT$ ${subtotal.toLocaleString()}</span>
      </div>
      <a href="/checkout.html" style="display:block;text-align:center;background:var(--theme,#0d9488);color:#fff;font-weight:700;padding:10px;border-radius:10px;text-decoration:none">前往結帳 →</a>`;
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-mini-cart]');
    if (!trigger) return;
    e.preventDefault();
    open();
  });
})();

// Admin chrome: top category tabs + dynamic left sidebar.
//
// Each admin page renders `<nav id="adminNav">` in its `<header>`. This script
// fills that nav with category buttons, then injects a left sidebar (`<aside id="adminSidebar">`)
// containing the items inside the *current* category. Main content is pushed
// right on desktop so the sidebar doesn't overlap.

const CATEGORIES = [
  // Top categories — fixed order. Icons removed per spec; clean text labels.
  // 總覽 is its own top-level category (out of 訂單) so it lives on its own page.
  { key: 'overview', label: '總覽', items: [
    { href: '/admin.html', label: '總覽' },
  ]},
  { key: 'catalog', label: '商品', items: [
    { href: '/admin-products.html',   label: '商品' },
    { href: '/admin-categories.html', label: '分類' },
    { href: '/admin-brands.html',     label: '品牌' },
    { href: '/admin-bundles.html',    label: '團購優惠' },
  ]},
  { key: 'orders', label: '訂單', items: [
    { href: '/admin-orders.html',     label: '訂單管理' },
    { href: '/admin-picking.html',    label: '提貨單' },
    { href: '/admin-statements.html', label: '月結對帳單' },
  ]},
  { key: 'members', label: '會員', items: [
    { href: '/admin-customers.html', label: '客戶管理' },
    { href: '/admin-vouchers.html',  label: '優惠券' },
    { href: '/admin-tiers.html',     label: '會員等級' },
    { href: '/admin-leads.html',     label: '客戶來電' },
  ]},
  { key: 'content', label: '內容', items: [
    { href: '/admin-home.html',           label: '首頁' },
    { href: '/admin-content.html',        label: '內容區塊' },
    { href: '/admin-pages.html',          label: '頁面 / 選單' },
    { href: '/admin-page-templates.html', label: 'Header / Footer 模板' },
    { href: '/admin-banners.html',        label: '首頁橫幅' },
    { href: '/admin-page-banners.html',   label: '頁面橫幅' },
    { href: '/admin-promotion.html',      label: '檔期優惠' },
    { href: '/admin-media.html',          label: '媒體庫' },
  ]},
  { key: 'staff', label: '員工', items: [
    { href: '/admin-staff.html',       label: '員工帳號' },
    { href: '/admin-staff-roles.html', label: '角色與權限' },
  ]},
  { key: 'system', label: '系統', items: [
    { href: '/admin-settings.html', label: '系統設定' },
    { href: '/admin-shipping.html', label: '運費與地區' },
    { href: '/', label: '查看前台 ↗' },
  ]},
];

(async function () {
  // Permission guard
  const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ user: null }));
  if (!me.user || me.user.role === 'MEMBER' || me.user.role === 'GUEST') {
    document.body.innerHTML = '<div class="grid place-items-center min-h-screen"><p class="text-slate-600">需要員工權限才能存取。<a href="/login.html" class="text-teal-600 underline ml-1">登入</a></p></div>';
    return;
  }

  const here = location.pathname;
  const currentCat =
    CATEGORIES.find((c) => c.items.some((i) => i.href === here)) ?? CATEGORIES[0];

  // ----- User menu (account dropdown after 系統) -----
  injectUserMenu(me.user);

  // ----- Top nav: categories only -----
  const topNav = document.getElementById('adminNav');
  if (topNav) {
    topNav.innerHTML = CATEGORIES.map((c) => {
      const active = c.key === currentCat.key;
      const cls = active
        ? 'text-teal-300 border-b-2 border-teal-400'
        : 'text-slate-300 hover:text-teal-300 border-b-2 border-transparent';
      return `<a href="${c.items[0].href}" class="${cls} pb-1 inline-flex items-center font-medium">${c.label}</a>`;
    }).join('');
    topNav.classList.add('items-center');
    // Roomier spacing: bigger gap between items, push the whole nav further
    // from the logo block on its left, and reserve right margin so the user
    // menu pill doesn't crowd the last category.
    topNav.style.cssText = (topNav.style.cssText || '') +
      ';display:flex;gap:2.5rem;flex-wrap:nowrap;white-space:nowrap;margin-left:2.5rem;margin-right:auto;padding-right:1.5rem;';
  }

  // ----- Left sidebar -----
  const sidebar = document.createElement('aside');
  sidebar.id = 'adminSidebar';
  sidebar.innerHTML = `
    <div style="padding:18px 16px 6px;">
      <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:0">
        ${currentCat.label}
      </p>
    </div>
    <nav style="padding:0 8px 16px;display:flex;flex-direction:column;gap:2px">
      ${currentCat.items.map((i) => {
        const active = i.href === here;
        return `<a href="${i.href}" style="
          display:block; padding:9px 12px; border-radius:8px; text-decoration:none; font-size:14px;
          ${active ? 'background:#0f766e; color:#fff; font-weight:600' : 'color:#334155; background:transparent'};
          transition: background .15s;
        " onmouseover="if(!this.style.background.includes('rgb(15, 118, 110)')) this.style.background='#f1f5f9'"
           onmouseout="if(!this.style.background.includes('rgb(15, 118, 110)')) this.style.background='transparent'"
        >${i.label}</a>`;
      }).join('')}
    </nav>`;
  sidebar.style.cssText = `
    position:fixed; top:64px; left:0; bottom:0; width:220px;
    background:#fff; border-right:1px solid #e2e8f0;
    overflow-y:auto; z-index:20;
  `;
  document.body.appendChild(sidebar);

  // Mobile toggle button (placed near brand)
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'adminSidebarToggle';
  toggleBtn.setAttribute('aria-label', '選單');
  toggleBtn.innerHTML = '☰';
  toggleBtn.style.cssText = `
    background:rgba(255,255,255,.08); color:#fff; border:none;
    width:36px; height:36px; border-radius:8px; cursor:pointer; font-size:18px;
    margin-right:4px;
  `;
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  const headerInner = document.querySelector('header > div');
  if (headerInner) headerInner.insertBefore(toggleBtn, headerInner.firstChild);

  function injectUserMenu(user) {
    const wrap = document.createElement('div');
    wrap.id = 'adminUserMenu';
    wrap.style.cssText = 'position:relative; margin-left:auto;';
    wrap.innerHTML = `
      <button id="auMenuBtn" style="
        display:inline-flex; align-items:center; gap:8px;
        background:rgba(255,255,255,.08); color:#fff; border:none;
        padding:6px 12px 6px 6px; border-radius:999px; cursor:pointer;
        font-size:13px;
      ">
        <span style="
          width:28px; height:28px; border-radius:50%; background:#0d9488;
          display:grid; place-items:center; font-weight:700; font-size:13px;
        ">${(user.name ?? user.email ?? '?').charAt(0)}</span>
        <span style="font-weight:600">${escapeHtml(user.name ?? user.email)}</span>
        <span style="font-size:10px; opacity:.7">▼</span>
      </button>
      <div id="auMenuPanel" style="
        position:absolute; right:0; top:calc(100% + 8px);
        background:#fff; color:#0f172a; border:1px solid #e2e8f0;
        border-radius:12px; min-width:240px; box-shadow:0 12px 30px rgba(0,0,0,.18);
        display:none; z-index:200; overflow:hidden;
      ">
        <div style="padding:14px 16px; border-bottom:1px solid #f1f5f9">
          <p style="font-weight:700; margin:0; font-size:14px">${escapeHtml(user.name ?? '')}</p>
          <p style="font-size:11px; color:#64748b; margin:2px 0 0">${escapeHtml(user.email ?? '')}</p>
          ${user.isSuperAdmin ? '<p style="font-size:10px; color:#0d9488; margin:6px 0 0; font-weight:700">超級管理員</p>'
            : user.staffRoleName ? `<p style="font-size:10px; color:#64748b; margin:6px 0 0">${escapeHtml(user.staffRoleName)}</p>` : ''}
        </div>
        <button data-action="profile"  style="${menuItemStyle()}">👤 更新資料</button>
        <button data-action="password" style="${menuItemStyle()}">🔒 更換密碼</button>
        <a href="/account.html" style="${menuItemStyle()};text-decoration:none;display:block">⚙️ 完整會員中心 ↗</a>
        <div style="border-top:1px solid #f1f5f9"></div>
        <button data-action="logout"   style="${menuItemStyle('#dc2626')}">🚪 登出</button>
      </div>`;
    const nav = document.getElementById('adminNav');
    nav?.parentElement?.appendChild(wrap);

    const btn = wrap.querySelector('#auMenuBtn');
    const panel = wrap.querySelector('#auMenuPanel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) panel.style.display = 'none';
    });

    wrap.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      panel.style.display = 'none';
      if (action === 'logout') {
        await fetch('/api/auth/logout', { method: 'POST' });
        location.href = '/login.html';
      } else if (action === 'password') {
        openPasswordModal();
      } else if (action === 'profile') {
        openProfileModal(user);
      }
    });
  }

  function menuItemStyle(color = '#0f172a') {
    return `
      display:block; width:100%; text-align:left;
      padding:11px 16px; font-size:14px; border:none; background:transparent;
      cursor:pointer; color:${color};
      transition:background .12s;
    `;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  function ensureModal() {
    let m = document.getElementById('__auModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = '__auModal';
    m.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9999;
      display:none; place-items:center; padding:16px;
    `;
    m.innerHTML = `<div id="__auBox" style="
      background:#fff; border-radius:16px; padding:24px; max-width:420px; width:100%;
    "></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    return m;
  }

  function openPasswordModal() {
    const m = ensureModal();
    m.style.display = 'grid';
    m.querySelector('#__auBox').innerHTML = `
      <h3 style="margin:0 0 16px; font-weight:700; font-size:18px">變更密碼</h3>
      <div style="display:flex; flex-direction:column; gap:10px; font-size:14px">
        <label>目前密碼 <input id="pwCur" type="password" style="${inputStyle()}"/></label>
        <label>新密碼 (至少 8 字元) <input id="pwNew" type="password" minlength="8" style="${inputStyle()}"/></label>
        <label>再次輸入新密碼 <input id="pwNew2" type="password" minlength="8" style="${inputStyle()}"/></label>
        <p id="pwMsg" style="font-size:12px; color:#dc2626; min-height:18px"></p>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px">
        <button id="pwCancel" style="${btnStyle()}">取消</button>
        <button id="pwSave"   style="${btnStyle('#0d9488','#fff')}">變更</button>
      </div>`;
    const close = () => m.style.display = 'none';
    m.querySelector('#pwCancel').onclick = close;
    m.querySelector('#pwSave').onclick = async () => {
      const cur = m.querySelector('#pwCur').value;
      const a = m.querySelector('#pwNew').value, b = m.querySelector('#pwNew2').value;
      const msg = m.querySelector('#pwMsg');
      if (a.length < 8) return msg.textContent = '新密碼至少 8 字元';
      if (a !== b)      return msg.textContent = '兩次新密碼不一致';
      const r = await fetch('/api/auth/me/password', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ currentPassword: cur, newPassword: a }),
      });
      if (!r.ok) {
        const d = await r.json();
        return msg.textContent = d.error === 'current_password_wrong' ? '目前密碼不正確' : '變更失敗';
      }
      msg.style.color = '#16a34a'; msg.textContent = '✓ 密碼已變更';
      setTimeout(close, 1200);
    };
  }

  function openProfileModal(user) {
    const m = ensureModal();
    m.style.display = 'grid';
    m.querySelector('#__auBox').innerHTML = `
      <h3 style="margin:0 0 16px; font-weight:700; font-size:18px">更新資料</h3>
      <div style="display:flex; flex-direction:column; gap:10px; font-size:14px">
        <label>姓名 <input id="pName"  value="${escapeHtml(user.name ?? '')}"  style="${inputStyle()}"/></label>
        <label>電話 <input id="pPhone" value="${escapeHtml(user.phone ?? '')}" style="${inputStyle()}"/></label>
        <p style="font-size:12px; color:#64748b">Email：${escapeHtml(user.email ?? '')} <br>(如需變更 Email 請至「完整會員中心」進行驗證流程)</p>
        <p id="prMsg" style="font-size:12px; color:#dc2626; min-height:18px"></p>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px">
        <button id="prCancel" style="${btnStyle()}">取消</button>
        <button id="prSave"   style="${btnStyle('#0d9488','#fff')}">儲存</button>
      </div>`;
    const close = () => m.style.display = 'none';
    m.querySelector('#prCancel').onclick = close;
    m.querySelector('#prSave').onclick = async () => {
      const name  = m.querySelector('#pName').value.trim();
      const phone = m.querySelector('#pPhone').value.trim();
      const msg   = m.querySelector('#prMsg');
      if (!name) return msg.textContent = '請填入姓名';
      const r = await fetch('/api/auth/me/profile', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name, phone }),
      });
      if (!r.ok) return msg.textContent = '儲存失敗';
      msg.style.color = '#16a34a'; msg.textContent = '✓ 已更新';
      setTimeout(() => { close(); location.reload(); }, 900);
    };
  }

  function inputStyle() {
    return `
      display:block; width:100%; padding:8px 10px; border:1px solid #e2e8f0;
      border-radius:8px; margin-top:4px; font-size:14px;
    `;
  }
  function btnStyle(bg = '#fff', color = '#475569') {
    return `
      background:${bg}; color:${color}; border:1px solid #e2e8f0;
      padding:8px 16px; border-radius:8px; font-size:14px; font-weight:600;
      cursor:pointer;
    `;
  }

  // ----- Layout shift CSS -----
  // Tailwind's .mx-auto on <main> has higher specificity than a plain tag
  // selector, so we need !important here to actually push the main panel
  // to the right of the fixed sidebar.
  const css = document.createElement('style');
  css.textContent = `
    @media (min-width: 1024px) {
      body > main {
        margin-left: 240px !important;
        margin-right: 0 !important;
        transition: margin-left .15s;
      }
      #adminSidebarToggle { display: none; }
    }
    @media (max-width: 1023px) {
      #adminSidebar {
        transform: translateX(-100%);
        transition: transform .2s;
        box-shadow: 0 10px 25px rgba(0,0,0,.2);
      }
      #adminSidebar.open { transform: translateX(0); }
    }
  `;
  document.head.appendChild(css);
})();

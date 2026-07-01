// Drop-in mobile menu. Any customer page that includes this script gets a
// hamburger button + slide-down drawer with the same nav as index.html.
// Skips pages that already define their own #mobileMenu element.
(function () {
  if (document.getElementById('mobileMenu')) return; // page handles its own
  const header = document.querySelector('header');
  if (!header) return;

  const btn = document.createElement('button');
  btn.id = 'mobileMenuBtn';
  btn.className = 'md:hidden p-2 -mr-1 text-slate-700';
  btn.setAttribute('aria-label', '開啟選單');
  btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

  const flexRow = header.querySelector('.flex.items-center.justify-between') || header.firstElementChild;
  if (flexRow) flexRow.appendChild(btn);

  const sheet = document.createElement('div');
  sheet.id = 'mobileMenu';
  sheet.className = 'hidden md:hidden border-t border-slate-200 bg-white';
  sheet.innerHTML = `
    <nav class="px-6 py-4 flex flex-col gap-3 text-base font-medium text-slate-800">
      <a href="/" class="hover:text-teal-600">回首頁</a>
      <span id="__mmNav" class="flex flex-col gap-3"></span>
      <a href="/account.html" id="__mmAccount" class="hover:text-teal-600" style="display:none">會員中心</a>
    </nav>
    <div class="px-6 pb-4 pt-2 flex gap-2 border-t border-slate-100" id="__mmAuth">
      <a href="/login.html" class="flex-1 text-center text-sm font-medium border border-slate-200 rounded-full py-2">登入</a>
      <a href="/register.html" class="flex-1 text-center text-sm font-semibold bg-slate-900 text-white rounded-full py-2">註冊會員</a>
    </div>
  `;
  header.appendChild(sheet);

  btn.addEventListener('click', () => sheet.classList.toggle('hidden'));

  // Inject the auth widget (登入/註冊 or 會員 pill) into the header's right side
  // unless the page already provides one. auth-nav.js will swap the inner state
  // depending on /api/auth/me.
  if (flexRow && !document.querySelector('[data-auth-user-menu]') && !document.querySelector('[data-auth-anon]')) {
    const cart = flexRow.querySelector('[data-mini-cart]');
    const wrap = document.createElement('span');
    wrap.className = 'flex items-center gap-2 sm:gap-3';
    wrap.innerHTML = `
      <a href="/login.html" data-auth-anon class="hidden sm:inline text-sm font-medium text-slate-700 hover:text-teal-600">登入</a>
      <a href="/register.html" data-auth-anon class="hidden sm:inline text-sm font-semibold bg-slate-900 text-white px-4 py-2 rounded-full hover:bg-slate-800">註冊會員</a>
      <span data-auth-user-menu id="userMenuHost" class="hidden sm:inline-block" style="display:none"></span>
    `;
    if (cart) cart.parentNode.insertBefore(wrap, cart);
    else flexRow.appendChild(wrap);
  }

  // Populate nav from /api/nav
  fetch('/api/nav').then(r => r.json()).then(({ items = [] }) => {
    const host = document.getElementById('__mmNav');
    if (!host) return;
    host.innerHTML = items.map(it =>
      `<a href="${it.href}" class="hover:text-teal-600">${escape(it.label)}</a>`
    ).join('');
  }).catch(() => {});

  // Show 會員中心 / hide login if authenticated
  fetch('/api/auth/me').then(r => r.json()).then(({ user }) => {
    if (user) {
      const acct = document.getElementById('__mmAccount');
      const auth = document.getElementById('__mmAuth');
      if (acct) acct.style.display = '';
      if (auth) auth.style.display = 'none';
    }
  }).catch(() => {});

  function escape(s) {
    return String(s).replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' })[c]);
  }
})();

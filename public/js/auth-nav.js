// Toggle public nav buttons based on whether the user is logged in.
// Markup contract:
//   [data-auth-anon]      — shown only when NOT logged in (e.g. 登入 / 註冊會員)
//   [data-auth-user]      — shown only when logged in (e.g. 會員資訊)
//   [data-auth-user-href] — element's href is set to /admin.html for staff,
//                           /account.html for members
//   [data-user-name]      — innerText replaced with user.name
(async function () {
  const me = await fetch('/api/auth/me')
    .then((r) => r.json())
    .catch(() => ({ user: null }));
  const user = me?.user ?? null;
  const isStaff = !!user && (
    user.isSuperAdmin || user.staffRoleId ||
    ['STAFF', 'MANAGER', 'SALES', 'FINANCE', 'WAREHOUSE'].includes(user.role)
  );

  document.querySelectorAll('[data-auth-anon]').forEach((el) => {
    el.style.display = user ? 'none' : '';
  });

  document.querySelectorAll('[data-auth-user]').forEach((el) => {
    el.style.display = user ? '' : 'none';
    if (user && el.dataset.authUserHref !== undefined) {
      el.href = isStaff ? '/admin.html' : '/account.html';
    }
  });

  document.querySelectorAll('[data-user-name]').forEach((el) => {
    if (user) el.textContent = user.name;
  });

  // Upgrade [data-auth-user-menu] anchors into a dropdown matching the admin
  // header pattern: 更新資料 / 更換密碼 / 會員中心 / 登出. Click the pill to open.
  document.querySelectorAll('[data-auth-user-menu]').forEach((host) => {
    if (!user) { host.style.display = 'none'; return; }
    host.style.display = '';
    host.style.position = 'relative';
    const initial = (user.name?.[0] ?? '會').toUpperCase();
    host.innerHTML = `
      <button type="button" id="${host.id}-trigger"
        class="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm pl-1 pr-4 py-1 rounded-full">
        <span class="w-7 h-7 rounded-full bg-white text-teal-700 grid place-items-center font-bold">${initial}</span>
        <span data-user-name>${user.name}</span>
        <span class="text-xs opacity-80">▾</span>
      </button>
      <div id="${host.id}-menu" class="hidden absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-50 text-sm">
        <div class="px-4 py-2 border-b border-slate-100">
          <p class="font-semibold">${user.name}</p>
          <p class="text-xs text-slate-500 truncate">${user.email ?? ''}</p>
          ${isStaff ? '<p class="text-[10px] text-teal-600 font-bold mt-0.5">員工 / 後台</p>' : ''}
        </div>
        ${isStaff ? `
          <a href="/admin.html" class="block px-4 py-2 hover:bg-slate-50">後台總覽</a>` : ''}
        <a href="/account.html" class="block px-4 py-2 hover:bg-slate-50">更新資料</a>
        <a href="/account.html#change-password" class="block px-4 py-2 hover:bg-slate-50">更換密碼</a>
        <a href="/account.html" class="block px-4 py-2 hover:bg-slate-50">會員中心</a>
        <button type="button" data-logout class="w-full text-left px-4 py-2 hover:bg-rose-50 text-rose-600 border-t border-slate-100">登出</button>
      </div>`;
    const trigger = host.querySelector('button');
    const menu    = host.querySelector(`#${host.id}-menu`);
    trigger.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => {
      if (!host.contains(e.target)) menu.classList.add('hidden');
    });
    host.querySelector('[data-logout]').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    });
  });
})();

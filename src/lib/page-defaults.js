// Shared header/footer HTML used in two places:
//   1. /p/:slug renderer — fallback chrome when neither the page's own template
//      override nor a DB-default template (isDefault=true) is available.
//   2. Seeded into PageTemplate as the editable "預設 Header / Footer" rows so
//      admins can adjust the platform-wide chrome from /admin-page-templates.html.

export const DEFAULT_HEADER_HTML = `<header class="border-b border-slate-200">
    <div class="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between flex-wrap gap-3">
      <a href="/" class="flex items-center gap-2">
        <img data-content="site.logo.url" data-content-attr="src" alt="" class="h-9 w-auto hidden"/>
        <span data-logo-fallback class="w-9 h-9 rounded-full bg-teal-500 grid place-items-center text-white font-bold">M</span>
      </a>
      <nav id="mainNav" class="hidden md:flex items-center gap-7 text-sm font-medium text-slate-700"></nav>
      <div class="flex items-center gap-3">
        <a href="/login.html" data-auth-anon class="text-sm font-medium text-slate-700 hover:text-teal-600" data-content="nav.cta.login">登入</a>
        <a href="/register.html" data-auth-anon class="text-sm font-semibold bg-slate-900 text-white px-4 py-2 rounded-full hover:bg-slate-800" data-content="nav.cta.register">註冊會員</a>
        <a data-auth-user data-auth-user-href href="/account.html" class="text-sm font-semibold bg-teal-600 text-white px-4 py-2 rounded-full hover:bg-teal-700" style="display:none">
          <span data-user-name>會員資訊</span>
        </a>
      </div>
    </div>
  </header>`;

// CMS pages get the SAME rich footer as index.html: a <div id="siteFooter">
// placeholder + the shared /js/footer.js renderer (loaded from the page route).
// This way 會員制度 / 常見問題 / 保固政策 / etc. all share the platform footer
// (link columns + payment icons + social + copyright bar).
export const DEFAULT_FOOTER_HTML = `<div id="siteFooter"></div>`;

// Shared site footer. Injects markup into <div id="siteFooter"></div> on
// any public page that includes this script.

(async function () {
  const slot = document.getElementById('siteFooter');
  if (!slot) return;

  const site = await fetch('/api/site').then((r) => r.json()).catch(() => ({}));
  const content = await fetch('/api/content').then((r) => r.json()).then((d) => d.content).catch(() => ({}));

  // Apply theme color globally via CSS var (used by [data-theme-bg] etc.)
  if (site.themeColor) {
    document.documentElement.style.setProperty('--theme', site.themeColor);
  }

  const copyright = content['footer.copyright'] || '© 2026 資生國際有限公司 Shisei International Limited. 統一編號: 28343724';
  // Drop the hardcoded defaultLinks fallback — footer link section is now
  // 100% DB-driven via admin /admin-pages.html → 頁面頁尾.
  const note      = content['footer.note']      || '本平台僅對通過審核之醫療專業人員開放。';

  // Footer links come exclusively from /api/site.footerPages (admin-managed
  // FOOTER NavItems + legacy FOOTER_PAGE_SLUGS). Admin assigns each one to a
  // column: SERVICE (客戶服務) or POLICY (政策與條款).
  const links = (site.footerPages ?? []).map((p) => ({
    href: p.href ?? ('/p/' + p.slug),
    label: p.title,
    col: (p.footerColumn === 'POLICY') ? 'POLICY' : 'SERVICE',
  }));
  const serviceLinks = links.filter((l) => l.col === 'SERVICE');
  const policyLinks  = links.filter((l) => l.col === 'POLICY');

  const PAY_ICONS = [
    { name: 'VISA',       svg: payVisa() },
    { name: 'Mastercard', svg: payMC() },
    { name: 'JCB',        svg: payJCB() },
    { name: 'LINE Pay',   svg: payLinePay() },
    { name: 'ATM',        svg: payATM() },
    { name: 'CVS',        svg: payCVS() },
  ];

  slot.innerHTML = `
    <footer class="bg-slate-900 text-slate-300 mt-16">
      <div class="max-w-7xl mx-auto px-6 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <h3 class="text-white font-bold leading-tight">資生國際有限公司</h3>
          <p class="mt-1 text-sm font-semibold text-white leading-tight">Shisei International Limited</p>
          <div class="mt-3 space-y-1">
            <p class="text-xs text-slate-400 leading-relaxed">台中市西屯區安林路45-2號之1</p>
            <p class="text-xs text-slate-400 leading-relaxed">04-24612266｜080024612266</p>
            <p class="text-xs text-slate-400 leading-relaxed">jay@shiseidental.com</p>
          </div>
          <p class="mt-4 text-sm leading-relaxed">${escapeHtml(note)}</p>
          ${(site.lineUrl || site.fbUrl) ? `
            <div class="flex items-center gap-3 mt-4">
              ${site.lineUrl ? `<a href="${site.lineUrl}" target="_blank" rel="noopener" class="w-10 h-10 grid place-items-center rounded-full bg-[#06C755] hover:opacity-90" aria-label="LINE">${iconLine()}</a>` : ''}
              ${site.fbUrl   ? `<a href="${site.fbUrl}"   target="_blank" rel="noopener" class="w-10 h-10 grid place-items-center rounded-full bg-[#1877F2] hover:opacity-90" aria-label="Facebook">${iconFB()}</a>` : ''}
            </div>` : ''}
        </div>

        <div>
          <h4 class="text-white font-semibold mb-3 text-sm">客戶服務</h4>
          <ul class="space-y-2 text-sm">
            ${serviceLinks.map(l => `<li><a href="${l.href}" class="hover:text-teal-300">${l.label}</a></li>`).join('') || '<li class="text-slate-500 text-xs">尚未設定</li>'}
          </ul>
        </div>

        <div>
          <h4 class="text-white font-semibold mb-3 text-sm">政策與條款</h4>
          <ul class="space-y-2 text-sm">
            ${policyLinks.map(l => `<li><a href="${l.href}" class="hover:text-teal-300">${l.label}</a></li>`).join('') || '<li class="text-slate-500 text-xs">尚未設定</li>'}
          </ul>
        </div>

        <div>
          <h4 class="text-white font-semibold mb-3 text-sm">付款方式</h4>
          <div class="flex flex-wrap gap-2">
            ${PAY_ICONS.map(p => `<span title="${p.name}" class="bg-white rounded px-2 py-1 grid place-items-center">${p.svg}</span>`).join('')}
          </div>
        </div>
      </div>

      <div class="border-t border-slate-800">
        <div class="max-w-7xl mx-auto px-6 py-4 text-xs text-slate-400">
          <span>${escapeHtml(copyright)}</span>
        </div>
      </div>
    </footer>`;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---- Icons (inline so no extra requests, theme-color safe) ----
  function iconLine() {
    // Official LINE bubble. White on LINE-green (#06C755) for the circular pill.
    return `<svg width="22" height="22" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <path fill="#fff" d="M29.7 16.18c0-5.23-5.24-9.48-11.7-9.48S6.3 10.95 6.3 16.18c0 4.69 4.16 8.62 9.78 9.36.38.08.9.25 1.03.58.12.3.08.76.04 1.07l-.17 1c-.05.3-.23 1.16 1.02.63 1.25-.52 6.74-3.97 9.2-6.8 1.7-1.86 2.5-3.76 2.5-5.84zM12.34 19.5h-2.33c-.34 0-.61-.27-.61-.61v-4.66c0-.34.27-.61.61-.61.34 0 .61.27.61.61v4.05h1.72c.34 0 .61.27.61.61s-.27.61-.61.61zm2.39-.61c0 .34-.27.61-.61.61-.34 0-.61-.27-.61-.61v-4.66c0-.34.27-.61.61-.61.34 0 .61.27.61.61v4.66zm5.6 0c0 .26-.17.5-.42.58-.07.02-.13.03-.2.03-.19 0-.37-.09-.49-.24l-2.39-3.25v2.88c0 .34-.27.61-.61.61-.34 0-.61-.27-.61-.61v-4.66c0-.26.17-.5.42-.58.07-.02.13-.03.2-.03.19 0 .37.09.49.24l2.39 3.25v-2.88c0-.34.27-.61.61-.61.34 0 .61.27.61.61v4.66zm3.76-2.94c.34 0 .61.27.61.61s-.27.61-.61.61h-1.72v1.11h1.72c.34 0 .61.27.61.61s-.27.61-.61.61h-2.33c-.34 0-.61-.27-.61-.61v-4.66c0-.34.27-.61.61-.61h2.33c.34 0 .61.27.61.61s-.27.61-.61.61h-1.72v1.11h1.72z"/>
    </svg>`;
  }
  function iconFB() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 5 3.7 9.1 8.4 9.9v-7H8v-2.9h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.5.7-1.5 1.5v1.8h2.6l-.4 2.9h-2.2v7C18.3 21.1 22 17 22 12z"/></svg>`;
  }
  function payVisa()  { return `<svg width="36" height="14" viewBox="0 0 50 20"><text x="0" y="16" font-family="Arial Black" font-size="18" font-weight="900" fill="#1A1F71">VISA</text></svg>`; }
  function payMC()    { return `<svg width="32" height="20" viewBox="0 0 40 24"><circle cx="15" cy="12" r="9" fill="#EB001B"/><circle cx="25" cy="12" r="9" fill="#F79E1B" opacity=".95"/></svg>`; }
  function payJCB()   { return `<svg width="36" height="14" viewBox="0 0 50 20"><text x="0" y="16" font-family="Arial Black" font-size="16" font-weight="900" fill="#0E4C92">JCB</text></svg>`; }
  function payLinePay(){return `<svg width="44" height="14" viewBox="0 0 60 20"><rect width="60" height="20" rx="3" fill="#06C755"/><text x="6" y="14" font-family="Arial" font-size="11" font-weight="bold" fill="#fff">LINE Pay</text></svg>`; }
  function payATM()   { return `<svg width="32" height="14" viewBox="0 0 40 20"><rect width="40" height="20" rx="3" fill="#475569"/><text x="6" y="14" font-family="Arial" font-size="11" font-weight="bold" fill="#fff">ATM</text></svg>`; }
  function payCVS()   { return `<svg width="32" height="14" viewBox="0 0 40 20"><rect width="40" height="20" rx="3" fill="#7c3aed"/><text x="6" y="14" font-family="Arial" font-size="11" font-weight="bold" fill="#fff">CVS</text></svg>`; }
})();

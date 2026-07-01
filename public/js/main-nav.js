(async function () {
  const target = document.getElementById('mainNav');
  if (!target) return;
  try {
    const { items } = await fetch('/api/nav').then((r) => r.json());
    if (!items?.length) return;
    target.innerHTML = items.map((it) =>
      `<a href="${it.href}" class="hover:text-teal-600">${escape(it.label)}</a>`
    ).join('');
  } catch {}
  function escape(s) {
    return String(s).replace(/[<>&"']/g, (c) =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' })[c]);
  }
})();

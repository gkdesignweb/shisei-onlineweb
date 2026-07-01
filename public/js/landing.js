const CATEGORY_FALLBACK_ICONS = {
  consumables: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-8 h-8"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M9 2v4M15 2v4M4 10h16"/></svg>`,
  orthodontic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-8 h-8"><path d="M4 9c0-3 4-5 8-5s8 2 8 5v3c0 2-2 3-3 3l-2 3h-6l-2-3c-1 0-3-1-3-3V9z"/></svg>`,
  implant:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-8 h-8"><path d="M12 3l3 4-1 9-2 5-2-5-1-9z"/></svg>`,
  instruments: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="w-8 h-8"><path d="M4 4l6 6M14 14l6 6M9 4l11 11M4 9l11 11"/></svg>`,
};

async function loadCategories() {
  try {
    const res = await fetch('/api/products/categories');
    const { categories } = await res.json();
    const grid = document.getElementById('category-grid');
    grid.innerHTML = categories.map((c) => {
      const icon = c.iconUrl
        ? `<img src="${c.iconUrl}" alt="" class="w-12 h-12 object-contain"/>`
        : CATEGORY_FALLBACK_ICONS[c.slug] ?? CATEGORY_FALLBACK_ICONS.consumables;
      return `
        <a href="/shop.html?category=${c.slug}" class="snap-start shrink-0 w-56 sm:w-64 bg-white border border-slate-100 rounded-2xl p-6 hover:border-teal-500 hover:shadow-xl hover:shadow-teal-100 transition flex flex-col items-start gap-3">
          <div class="text-teal-600">${icon}</div>
          <h3 class="font-bold text-xl text-slate-900">${c.nameZh}</h3>
          <p class="text-sm text-slate-500">${c.nameEn ?? ''}</p>
          <p class="mt-auto text-sm font-semibold text-teal-600">瀏覽商品 →</p>
        </a>`;
    }).join('');
  } catch (err) { console.error(err); }
}
loadCategories();

// ----- Hero banner carousel -----
let BANNER_IDX = 0;
let BANNER_TIMER = null;
let BANNERS_COUNT = 0;
async function loadBanners() {
  try {
    const { banners } = await fetch('/api/banners').then((r) => r.json());
    if (!banners?.length) return;
    BANNERS_COUNT = banners.length;
    document.getElementById('bannerSection').classList.remove('hidden');
    const track = document.getElementById('bannerTrack');
    track.innerHTML = banners.map((b) => `
      <div class="min-w-full h-full relative">
        ${b.linkUrl ? `<a href="${b.linkUrl}" class="absolute inset-0"></a>` : ''}
        <img src="${b.imageUrl}" class="w-full h-full object-cover"/>
        ${b.captionHtml ? `<div class="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/60 to-transparent text-white text-base sm:text-lg font-semibold">${b.captionHtml}</div>` : ''}
      </div>`).join('');
    document.getElementById('bannerDots').innerHTML = banners.map((_, i) =>
      `<button data-banner-dot="${i}" class="w-2 h-2 rounded-full bg-white/60 hover:bg-white"></button>`).join('');
    setBanner(0);
    if (BANNERS_COUNT > 1) startAutoplay();
    addBannerListeners();
  } catch (err) { console.error(err); }
}

function setBanner(i) {
  BANNER_IDX = (i + BANNERS_COUNT) % BANNERS_COUNT;
  document.getElementById('bannerTrack').style.transform = `translateX(-${BANNER_IDX * 100}%)`;
  document.querySelectorAll('[data-banner-dot]').forEach((d, j) => {
    d.style.background = j === BANNER_IDX ? '#fff' : 'rgba(255,255,255,.55)';
    d.style.width = j === BANNER_IDX ? '20px' : '8px';
    d.style.transition = 'all .3s';
  });
}

function startAutoplay() {
  clearInterval(BANNER_TIMER);
  BANNER_TIMER = setInterval(() => setBanner(BANNER_IDX + 1), 5000);
}

function addBannerListeners() {
  document.getElementById('bannerPrev').addEventListener('click', () => { setBanner(BANNER_IDX - 1); startAutoplay(); });
  document.getElementById('bannerNext').addEventListener('click', () => { setBanner(BANNER_IDX + 1); startAutoplay(); });
  document.querySelectorAll('[data-banner-dot]').forEach((d) =>
    d.addEventListener('click', () => { setBanner(parseInt(d.dataset.bannerDot, 10)); startAutoplay(); })
  );
  // Touch swipe
  const el = document.getElementById('banners');
  let startX = null;
  el.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) { setBanner(BANNER_IDX + (dx < 0 ? 1 : -1)); startAutoplay(); }
    startX = null;
  });
}
loadBanners();

// ----- Search bar -----
window.doSearch = () => {
  const q = document.getElementById('homeSearch').value.trim();
  if (!q) return;
  location.href = '/shop.html?q=' + encodeURIComponent(q);
};

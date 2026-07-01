import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BRANDS = [
  { slug: 'meditech', nameZh: 'MediTech 醫科', nameEn: 'MediTech', sortOrder: 1,
    introHtml: '<p>專注醫療耗材設計與製造，產品通過 ISO 13485 認證。</p>' },
  { slug: 'orthowave', nameZh: 'OrthoWave 矯正', nameEn: 'OrthoWave', sortOrder: 2,
    introHtml: '<p>專業矯正器材品牌，自鎖式與隱形矯正系統。</p>' },
  { slug: 'titanlab',  nameZh: 'TitanLab 鈦科',   nameEn: 'TitanLab',  sortOrder: 3,
    introHtml: '<p>鈦合金植體領導品牌，提供完整骨整合解決方案。</p>' },
];

const STAFF_ROLES = [
  { name: '店長', description: '全部權限 (與超級管理員等價)', isSystem: true,
    permissions: 'catalog.view,catalog.products.edit,catalog.categories.edit,media.view,media.upload,media.delete,orders.view,orders.ship,orders.refund,members.view,members.verify,members.tier.edit,vouchers.view,vouchers.create,vouchers.edit,vouchers.delete,vouchers.tier_link,pages.view,pages.create,pages.edit,pages.delete,nav.edit,content.edit,tiers.edit,settings.edit,staff.view,staff.create,staff.edit,staff.delete,staff.role.edit' },
  { name: '客服', description: '審核會員、查看訂單', isSystem: true,
    permissions: 'catalog.view,members.view,members.verify,orders.view,vouchers.view' },
  { name: '倉管', description: '查看訂單與出貨', isSystem: true,
    permissions: 'catalog.view,orders.view,orders.ship' },
  { name: '財務', description: '查看訂單、退款、優惠券', isSystem: true,
    permissions: 'orders.view,orders.refund,vouchers.view,vouchers.create,vouchers.edit' },
];

const categories = [
  { slug: 'consumables', nameZh: '醫療耗材', nameEn: 'Consumables', sortOrder: 1 },
  { slug: 'orthodontic', nameZh: '矯正器材', nameEn: 'Orthodontic', sortOrder: 2 },
  { slug: 'implant',     nameZh: '植牙材料', nameEn: 'Implant',     sortOrder: 3 },
  { slug: 'instruments', nameZh: '手術器械', nameEn: 'Instruments', sortOrder: 4 },
];

const products = [
  { sku: 'MD-G100', categorySlug: 'consumables', nameZh: '醫用乳膠手套 (M) 100入',
    descriptionZh: 'EN 455 認證，無粉、低敏。每盒 100 入。\n適用於一般診療與處置。',
    priceA: 380, priceB: 350, priceC: 320, priceD: 295, priceOriginal: 450, priceBulk: 290, bulkMinQty: 10,
    labels: 'HOT,BUNDLE', isFeatured: true, stock: 500, imageUrl: '/images/p1.svg', images: '/images/p1.svg' },
  { sku: 'MD-M050', categorySlug: 'consumables', nameZh: '三層醫療口罩 50入',
    descriptionZh: 'MD 雙鋼印認證。三層構造，過濾效率 ≥ 99%。',
    priceA: 260, priceB: 240, priceC: 220, priceD: 195, priceOriginal: 320, priceBulk: 200, bulkMinQty: 20,
    labels: 'BUNDLE', isFeatured: true, stock: 800, imageUrl: '/images/p2.svg', images: '/images/p2.svg' },
  { sku: 'OR-BR24', categorySlug: 'orthodontic', nameZh: '自鎖式矯正器 24顆',
    descriptionZh: '自鎖式被動托槽，減少摩擦力，療程更短。',
    priceA: 4800, priceB: 4500, priceC: 4200, priceD: 3950, priceOriginal: 5600,
    labels: 'NEW', stock: 60, imageUrl: '/images/p3.svg', images: '/images/p3.svg' },
  { sku: 'IM-TI10', categorySlug: 'implant',     nameZh: '鈦合金植體 4.0x10mm',
    descriptionZh: 'Grade 4 商業純鈦。SLA 表面處理，骨整合速度快。',
    priceA: 8500, priceB: 8050, priceC: 7600, priceD: 7100, priceOriginal: 9800,
    labels: 'NEW,HOT', stock: 35, imageUrl: '/images/p4.svg', images: '/images/p4.svg' },
  { sku: 'IS-FOR1', categorySlug: 'instruments', nameZh: '不鏽鋼拔牙鉗',
    descriptionZh: '德國醫療級不鏽鋼。可高溫高壓消毒。',
    priceA: 1800, priceB: 1650, priceC: 1500, priceD: 1380, priceOriginal: 2200, priceBulk: 1380, bulkMinQty: 5,
    labels: 'SALE', stock: 40, imageUrl: '/images/p5.svg', images: '/images/p5.svg' },
  { sku: 'IS-MIR1', categorySlug: 'instruments', nameZh: '口鏡 (5入組)',
    descriptionZh: '高解析鏡面，防霧處理。一組 5 入。',
    priceA: 520,  priceB: 490,  priceC: 460,  priceD: 425,  priceOriginal: 650, priceBulk: 420, bulkMinQty: 10,
    labels: 'BUNDLE', isFeatured: true, stock: 200, imageUrl: '/images/p6.svg', images: '/images/p6.svg' },
];

const vouchers = [
  { code: 'WELCOME100', description: '新會員首單折抵 NT$ 100', type: 'FIXED', value: 100,
    minOrderAmount: 1000, monthlyPerMember: 1, isActive: true },
  { code: 'BULK10',     description: '滿 NT$ 5,000 享 10% 折扣', type: 'PERCENT', value: 10,
    minOrderAmount: 5000, monthlyPerMember: 2, isActive: true },
];

const tiers = [
  {
    code: 'BRONZE', nameZh: '銅級會員', priceField: 'A',
    discountPercent: 0, freeShippingThreshold: 3000, creditInstallmentMax: 6,
    benefits: '標準價格\n滿 3000 免運\n信用卡最高 6 期',
    yearlyUpgradeThreshold: 100000, // 年消費 10 萬升金
    yearlyRetainThreshold:  0,       // 銅級無維持門檻
    nextTierCode: 'GOLD',
    sortOrder: 1,
  },
  {
    code: 'GOLD', nameZh: '金級會員', priceField: 'B',
    discountPercent: 0, freeShippingThreshold: 2000, creditInstallmentMax: 12,
    benefits: '專屬優惠價\n滿 2000 免運\n信用卡最高 12 期\n優先出貨',
    yearlyUpgradeThreshold: null,   // 已為最高
    yearlyRetainThreshold:  60000,  // 年消費 6 萬可維持金級
    nextTierCode: null,
    sortOrder: 2,
  },
];

const contentBlocks = [
  { key: 'nav.brand',           group: 'nav',      label: '導覽列品牌',     valueZh: '資生國際 Shisei Dental' },
  { key: 'nav.cta.register',    group: 'nav',      label: '導覽列「註冊」', valueZh: '註冊會員' },
  { key: 'nav.cta.login',       group: 'nav',      label: '導覽列「登入」', valueZh: '登入' },

  { key: 'landing.hero.eyebrow', group: 'landing', label: 'Hero 小標',     valueZh: 'B2B Professional Channel' },
  { key: 'landing.hero.title1',  group: 'landing', label: 'Hero 主標 1',   valueZh: 'Smile of' },
  { key: 'landing.hero.title2',  group: 'landing', label: 'Hero 主標 2',   valueZh: 'your dreams.' },
  { key: 'landing.hero.subtitle', group: 'landing', label: 'Hero 副標',
    valueZh: '專為診所與醫療機構打造的封閉式採購平台。\n通過身份審核後，享有差別議價、快速到貨、及完整的電子發票服務。',
    kind: 'richtext',
  },
  { key: 'landing.hero.ctaPrimary',   group: 'landing', label: '主要 CTA',         valueZh: '立即申請會員' },
  { key: 'landing.hero.ctaSecondary', group: 'landing', label: '次要 CTA',         valueZh: '業務專員回電' },
  { key: 'landing.callback.title',    group: 'landing', label: '回電卡片標題',    valueZh: 'Enter Number' },
  { key: 'landing.callback.subtitle', group: 'landing', label: '回電卡片副標',    valueZh: '留下電話，業務專員 30 分鐘內回電。' },

  { key: 'landing.categories.eyebrow', group: 'landing', label: '商品分類 eyebrow', valueZh: 'Our Categories' },
  { key: 'landing.categories.title',   group: 'landing', label: '商品分類標題',     valueZh: '完整的醫材品項' },

  { key: 'landing.how.eyebrow',  group: 'landing', label: 'How it works eyebrow', valueZh: 'How it works' },
  { key: 'landing.how.title',    group: 'landing', label: 'How it works 標題',    valueZh: '三步驟，開啟採購' },
  { key: 'landing.how.step1.title', group: 'landing', label: '步驟 1 標題',  valueZh: '註冊與身份審核' },
  { key: 'landing.how.step1.body',  group: 'landing', label: '步驟 1 內文', valueZh: '提供醫師證書或診所執照，系統審核後立即升級為驗證會員，解鎖完整價格。' },
  { key: 'landing.how.step2.title', group: 'landing', label: '步驟 2 標題',  valueZh: '瀏覽商品 · 議價' },
  { key: 'landing.how.step2.body',  group: 'landing', label: '步驟 2 內文', valueZh: '依會員等級享有差別議價，主管帳號可調整等級。' },
  { key: 'landing.how.step3.title', group: 'landing', label: '步驟 3 標題',  valueZh: '綠界結帳 · 電子發票' },
  { key: 'landing.how.step3.body',  group: 'landing', label: '步驟 3 內文', valueZh: '信用卡分期、ATM、超商代碼皆支援；結帳時填入統編抬頭，自動開立 B2B 電子發票。' },

  { key: 'landing.cta.title',  group: 'landing', label: '頁尾 CTA 標題', valueZh: '準備好升級您的採購流程了嗎？' },
  { key: 'landing.cta.body',   group: 'landing', label: '頁尾 CTA 內文', valueZh: '加入超過 500 家合作診所，體驗封閉式 B2B 平台的議價與物流優勢。' },
  { key: 'landing.cta.button', group: 'landing', label: '頁尾 CTA 按鈕', valueZh: '立即申請會員' },

  { key: 'site.logo.url', group: 'brand', label: '網站 Logo (主圖)', kind: 'image', valueZh: '' },

  { key: 'footer.copyright', group: 'footer', label: '版權聲明',  valueZh: '© 2026 資生國際有限公司 Shisei International Limited. 統一編號: 28343724' },
  { key: 'footer.note',      group: 'footer', label: '頁尾說明',  valueZh: '本平台僅對通過審核之醫療專業人員開放。' },

  { key: 'login.title',    group: 'login', label: '登入頁標題',  valueZh: '會員登入' },
  { key: 'login.subtitle', group: 'login', label: '登入頁副標',  valueZh: '登入後解鎖完整商品價格' },
  { key: 'login.cta',      group: 'login', label: '登入按鈕',   valueZh: '登入' },
  { key: 'login.lineCta',  group: 'login', label: 'LINE 按鈕',  valueZh: '使用 LINE 登入' },

  { key: 'register.title',    group: 'register', label: '註冊頁標題',  valueZh: '申請成為驗證會員' },
  { key: 'register.subtitle', group: 'register', label: '註冊頁副標',  valueZh: '提交後將由業務團隊審核，通常 1 個工作天內完成。' },

  { key: 'shop.title', group: 'shop', label: '商品專區標題', valueZh: '商品專區' },
  { key: 'shop.lockedHint', group: 'shop', label: '價格遮蔽提示', valueZh: '登入後顯示' },

  { key: 'checkout.title', group: 'checkout', label: '結帳標題', valueZh: '配送與付款資訊' },
  { key: 'checkout.cta',   group: 'checkout', label: '結帳按鈕', valueZh: '前往綠界完成付款' },
].map((b, i) => ({ ...b, sortOrder: i }));

const navItems = [
  { label: '所有產品',  href: '/shop.html',  order: 10 },
  { label: '品牌分類',  href: '/brands',     order: 20 },
  { label: '關於我們',  href: '/p/about',    order: 30 },
  { label: '聯絡業務',  href: '/#callback',  order: 40 },
];
// Old labels that we're replacing — wiped on seed so existing rows update
const navItemsToReplace = ['商品分類', '會員專區'];

const pages = [
  { slug: 'about', title: '關於我們',
    metaDesc: '資生國際 Shisei Dental 是專為診所與醫療機構打造的封閉式 B2B 採購平台。',
    body: `<p>資生國際 Shisei Dental 成立於 2024 年，是專為診所與醫療機構打造的封閉式 B2B 採購平台。我們相信專業的醫療採購應該與一般電商有所區隔——僅服務通過身份審核的合作機構。</p>
<h2>我們的承諾</h2>
<ul>
  <li><strong>專業議價：</strong>依會員等級提供差別化價格</li>
  <li><strong>品質把關：</strong>所有商品通過 GMP 認證</li>
  <li><strong>合規開立：</strong>支援 統編 + 抬頭 自動開立 B2B 電子發票</li>
</ul>` },
  { slug: 'member-tiers', title: '會員制度',
    metaDesc: '了解資生國際 Shisei Dental 會員等級、福利與升等條件。',
    body: `<h2>我們的會員等級</h2>
<p>會員等級會依年度累計消費自動調整，並提供差別化價格與福利。<b>下方表格內容會自動與後台「會員等級」設定同步</b>，無需手動更新。</p>
<!--TIER_TABLE-->
<h3>升等與維持說明</h3>
<ul>
  <li><strong>升等：</strong>當您本年度累計消費達到「升等門檻」，將自動於下個月升至下一個等級。</li>
  <li><strong>維持：</strong>當您本年度累計消費達到「維持門檻」，將保留現有等級至明年。未達門檻會自動於明年年初調降一級。</li>
  <li><strong>查看進度：</strong>可在「會員中心」即時查看當年累計消費與距離下個門檻的差距。</li>
</ul>` },
  { slug: 'faq', title: '常見問題', body: `<h2>採購問題</h2>
<h3>需要先成為會員嗎？</h3><p>是的。本平台僅服務通過身份審核的醫療機構，請先註冊並提供醫師證書或診所執照供業務團隊審核。</p>
<h3>下單後多久可以收到商品？</h3><p>標準訂單將於 1-2 個工作天內出貨，金級會員享有優先出貨。</p>
<h3>可以併單嗎？</h3><p>同一機構可指定多位收件人，請聯繫業務專員協助處理。</p>` },
  { slug: 'warranty', title: '保固政策', body: `<h2>保固期限</h2>
<p>所有商品自送達日起提供下列保固：</p>
<ul><li>耗材類：到貨檢查後 7 日內如有瑕疵可申請換貨</li>
<li>器械類：自製造日起 1 年保固</li>
<li>植體類：原廠保固 5 年</li></ul>` },
  { slug: 'terms', title: '條款與細則', body: `<h2>使用條款</h2>
<p>使用本平台即視為同意以下條款...</p>
<h3>1. 會員義務</h3><p>會員應提供正確的執業資訊並確保資料即時更新。</p>
<h3>2. 商品使用</h3><p>所有商品僅限合格醫療專業人員或機構使用。</p>` },
  { slug: 'shipping', title: '運送服務方式', body: `<h2>配送方式</h2>
<ul><li>本島：黑貓宅急便 / 大榮貨運，1-2 個工作天</li>
<li>離島：中華郵政，3-5 個工作天</li>
<li>免運門檻：依會員等級不同</li></ul>` },
  { slug: 'returns', title: '退換貨政策', body: `<h2>退換貨流程</h2>
<p>商品到貨 7 日內，若有以下情況可申請退換貨：</p>
<ul><li>商品瑕疵或破損</li>
<li>內容物錯誤</li>
<li>未拆封且包裝完整 (限部分品項)</li></ul>
<p>植體與耗材等一經拆封不得退貨，請於下單前確認規格。</p>` },
  { slug: 'anti-fraud', title: '防詐騙宣導', body: `<h2>提醒您注意</h2>
<p>本平台不會：</p>
<ul><li>主動電話索取信用卡資訊</li>
<li>要求臨櫃 ATM 操作解除分期</li>
<li>透過簡訊夾帶縮網址要求點擊登入</li></ul>
<p>若收到可疑訊息，請撥打 165 反詐騙專線。</p>` },
  { slug: 'privacy', title: '隱私政策', body: `<p>我們重視您的個資保護。</p>
<h2>蒐集範圍</h2><p>僅於必要時蒐集：姓名、診所名稱、聯絡電話、Email、統一編號、執業資訊。</p>
<h2>使用目的</h2><p>用於會員身份審核、訂單處理、發票開立與服務通知。</p>
<h2>保存期限</h2><p>會員關係存續期間 + 法令要求保存期限。</p>` },
];

async function main() {
  console.log('Seeding…');

  // Replace the canonical nav items each seed — leaves admin-added items alone.
  await prisma.navItem.deleteMany({
    where: { label: { in: [...navItems.map(i => i.label), ...navItemsToReplace] } },
  });
  for (const item of navItems) await prisma.navItem.create({ data: item });
  for (const p of pages) {
    await prisma.page.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
  }

  for (const b of BRANDS) {
    await prisma.brand.upsert({
      where: { slug: b.slug },
      update: b,
      create: b,
    });
  }

  for (const r of STAFF_ROLES) {
    await prisma.staffRole.upsert({
      where: { name: r.name },
      update: r,
      create: r,
    });
  }

  for (const t of tiers) {
    await prisma.tier.upsert({
      where: { code: t.code },
      update: t,
      create: t,
    });
  }

  for (const b of contentBlocks) {
    await prisma.contentBlock.upsert({
      where: { key: b.key },
      update: { group: b.group, label: b.label, valueZh: b.valueZh, kind: b.kind ?? 'text', sortOrder: b.sortOrder },
      create: { ...b, kind: b.kind ?? 'text' },
    });
  }

  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: c,
      create: c,
    });
  }

  // Seed a sample hero banner if none exist
  const bannerCount = await prisma.heroBanner.count();
  if (bannerCount === 0) {
    await prisma.heroBanner.create({
      data: {
        imageUrl: 'https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?w=1600&q=80',
        linkUrl: '/shop.html?featured=1',
        captionHtml: '<b>限時優惠</b> 全館滿千折百，會員專享 95 折',
        sortOrder: 1, isActive: true,
      },
    });
    await prisma.heroBanner.create({
      data: {
        imageUrl: 'https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=1600&q=80',
        linkUrl: '/brands',
        captionHtml: '<b>合作品牌</b> 認識我們經銷的優質品牌',
        sortOrder: 2, isActive: true,
      },
    });
  }

  const BRAND_BY_CAT = {
    consumables: 'meditech',
    orthodontic: 'orthowave',
    implant:     'titanlab',
    instruments: 'meditech',
  };

  for (const p of products) {
    const cat = await prisma.category.findUnique({ where: { slug: p.categorySlug } });
    const brandSlug = BRAND_BY_CAT[p.categorySlug];
    const brand = brandSlug ? await prisma.brand.findUnique({ where: { slug: brandSlug } }) : null;
    const { categorySlug, ...rest } = p;
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { ...rest, categoryId: cat.id, brandId: brand?.id ?? null },
      create: { ...rest, categoryId: cat.id, brandId: brand?.id ?? null },
    });
  }

  // Demo accordions + long description + variants for one product
  const demoGloves = await prisma.product.findUnique({ where: { sku: 'MD-G100' } });
  if (demoGloves) {
    await prisma.product.update({
      where: { id: demoGloves.id },
      data: {
        longDescriptionHtml: `<h2>產品特色</h2>
<p>採用 100% 醫療級乳膠，無粉設計減少粉塵污染。觸感靈敏、貼合手部，適合長時間佩戴。</p>
<h3>規格</h3>
<ul><li>材質：天然乳膠</li><li>每盒：100 入</li><li>認證：EN 455 / FDA 510(k)</li></ul>`,
        accordionsJson: JSON.stringify([
          { title: '尺寸建議', body: '依手掌寬度選擇：S (≤8cm) / M (8-9cm) / L (≥9cm)。' },
          { title: '使用注意', body: '一次性使用，請勿重複佩戴；對乳膠過敏者請改用 PVC 手套。' },
          { title: '保存方式', body: '避光、陰涼乾燥處保存，避免接觸熱源與化學溶劑。' },
        ]),
      },
    });
    // Add two variants (size)
    const existing = await prisma.productVariant.count({ where: { productId: demoGloves.id } });
    if (existing === 0) {
      await prisma.productVariant.createMany({
        data: [
          { productId: demoGloves.id, name: 'M (中)', optionType: 'size', stock: 300, sortOrder: 1 },
          { productId: demoGloves.id, name: 'L (大)', optionType: 'size', stock: 200, sortOrder: 2 },
        ],
      });
    }
  }

  for (const v of vouchers) {
    await prisma.voucher.upsert({
      where: { code: v.code },
      update: v,
      create: v,
    });
  }

  const adminEmail = 'manager@example.com';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isSuperAdmin: true, isActive: true },
    create: {
      email: adminEmail,
      name: 'Platform Manager',
      passwordHash: await bcrypt.hash('admin1234', 10),
      role: 'STAFF',
      isSuperAdmin: true,
      verificationStatus: 'APPROVED',
      tier: 'GOLD',
    },
  });

  // Demo staff with the 客服 role
  const csRole = await prisma.staffRole.findUnique({ where: { name: '客服' } });
  if (csRole) {
    await prisma.user.upsert({
      where: { email: 'support@example.com' },
      update: { staffRoleId: csRole.id, isActive: true },
      create: {
        email: 'support@example.com',
        name: '客服小櫻',
        passwordHash: await bcrypt.hash('support1234', 10),
        role: 'STAFF',
        staffRoleId: csRole.id,
        verificationStatus: 'APPROVED',
      },
    });
  }

  // Link the BULK10 voucher to GOLD tier only (demo of tier-restricted vouchers)
  const goldTier = await prisma.tier.findUnique({ where: { code: 'GOLD' } });
  const bulk10 = await prisma.voucher.findUnique({ where: { code: 'BULK10' } });
  if (goldTier && bulk10) {
    await prisma.tierVoucher.upsert({
      where: { tierId_voucherId: { tierId: goldTier.id, voucherId: bulk10.id } },
      update: {},
      create: { tierId: goldTier.id, voucherId: bulk10.id },
    });
  }

  await prisma.user.upsert({
    where: { email: 'goldclinic@example.com' },
    update: {},
    create: {
      email: 'goldclinic@example.com',
      name: '黃金診所',
      passwordHash: await bcrypt.hash('clinic1234', 10),
      role: 'MEMBER',
      tier: 'GOLD',
      verificationStatus: 'APPROVED',
      medicalLicenseNo: 'TW-DENT-00021',
      clinicName: '黃金牙醫診所',
      taxId: '12345678',
      companyTitle: '黃金牙醫診所',
    },
  });

  await prisma.user.upsert({
    where: { email: 'bronzeclinic@example.com' },
    update: {},
    create: {
      email: 'bronzeclinic@example.com',
      name: '銅級診所',
      passwordHash: await bcrypt.hash('clinic1234', 10),
      role: 'MEMBER',
      tier: 'BRONZE',
      verificationStatus: 'APPROVED',
      medicalLicenseNo: 'TW-DENT-00099',
      clinicName: '青銅牙醫診所',
      taxId: '87654321',
      companyTitle: '青銅牙醫診所',
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

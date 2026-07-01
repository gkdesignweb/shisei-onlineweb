import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { withCache, bustResponseCache } from './lib/response-cache.js';
import { config } from './config.js';
import { attachUser } from './middleware/auth.js';

import { authRouter } from './routes/auth.js';
import { productsRouter } from './routes/products.js';
import { cartRouter } from './routes/cart.js';
import { ordersRouter } from './routes/orders.js';
import { adminRouter } from './routes/admin.js';
import { contentRouter } from './routes/content.js';
import { tiersRouter } from './routes/tiers.js';
import { settingsRouter } from './routes/settings.js';
import { mediaRouter } from './routes/media.js';
import { catalogRouter } from './routes/catalog.js';
import { pagesRouter } from './routes/pages.js';
import { vouchersRouter } from './routes/vouchers.js';
import { staffRouter } from './routes/staff.js';
import { brandsRouter } from './routes/brands.js';
import { wishlistRouter } from './routes/wishlist.js';
import { bannersRouter } from './routes/banners.js';
import { bundlesRouter } from './routes/bundles.js';
import { leadsRouter } from './routes/leads.js';
import { customersRouter } from './routes/customers.js';
import { dashboardRouter } from './routes/dashboard.js';
import { shippingRouter } from './routes/shipping.js';
import { statementsRouter } from './routes/statements.js';
import { promotionRouter } from './routes/promotion.js';
import { pickingRouter } from './routes/picking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({
  // Tailwind CDN + LINE icons need permissive CSP for the demo; tighten in prod.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
// gzip/br for everything — 3-5× smaller JSON over Malaysia↔Tokyo links.
app.use(compression({ threshold: 512 }));
app.use(cookieParser());
app.use(express.json());
app.use(attachUser);

app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 30 }), authRouter);
app.use('/api/products', productsRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/content', contentRouter);
app.use('/api/tiers', tiersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/admin/media', mediaRouter);
app.use('/api/admin/catalog', catalogRouter);
// pagesRouter declares absolute paths: /api/nav, /p/:slug, /api/admin/pages-mgmt/*
app.use(pagesRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/admin', staffRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/banners', bannersRouter);
app.use('/api/bundles', bundlesRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/admin/dashboard', dashboardRouter);
app.use('/api/shipping', shippingRouter);
app.use('/api/admin/statements', statementsRouter);
app.use('/api/admin/picking', pickingRouter);
app.use('/api/promotion', promotionRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Public site config for the shared footer / brand chrome / pop-up gate.
// no-store so admin edits to nav/footer/gate appear on the next page load.
// 30s cache: admins editing nav/footer/gate see changes within half a minute.
// getSetting() reads the in-memory settings cache; the DB round-trips here come
// from the 4 prisma queries which we now batch into a single Promise.all.
app.get('/api/site', withCache(30, async (_req, res) => {
  const { getSetting } = await import('./lib/settings.js');
  const { prisma } = await import('./db.js');
  const footerSlugs = (await getSetting('FOOTER_PAGE_SLUGS') || '').split(',').map(s=>s.trim()).filter(Boolean);
  const shopSlugs   = (await getSetting('SHOP_NAV_PAGE_SLUGS') || '').split(',').map(s=>s.trim()).filter(Boolean);
  const slugs = [...new Set([...footerSlugs, ...shopSlugs])];
  // 4 queries in ONE round-trip instead of 2 sequential rounds.
  const [pages, footerNavItems, shopNavItems, marqueeRows] = await Promise.all([
    slugs.length
      ? prisma.page.findMany({
          where: { slug: { in: slugs }, isPublished: true },
          select: { slug: true, title: true },
        })
      : [],
    prisma.navItem.findMany({
      where: { isActive: true, location: 'FOOTER' },
      orderBy: { order: 'asc' },
      select: { label: true, href: true, footerColumn: true },
    }),
    prisma.navItem.findMany({
      where: { isActive: true, location: 'SHOP' },
      orderBy: { order: 'asc' },
      select: { label: true, href: true },
    }),
    prisma.contentBlock.findMany({
      where: { key: { in: ['landing.marquee.enabled', 'landing.marquee.text'] } },
      select: { key: true, valueZh: true },
    }),
  ]);
  const byMap = Object.fromEntries(pages.map(p => [p.slug, p.title]));
  const slugItems = (list) => list
    .filter(s => byMap[s])
    .map(s => ({ slug: s, title: byMap[s], href: '/p/' + s, footerColumn: 'SERVICE' }));
  const navItems = (items) => items.map(it => ({ slug: it.href, title: it.label, href: it.href, footerColumn: it.footerColumn || 'SERVICE' }));
  const m = Object.fromEntries(marqueeRows.map((r) => [r.key, r.valueZh]));
  res.json({
    siteName:    await getSetting('SITE_NAME'),
    tagline:     await getSetting('SITE_TAGLINE'),
    lineUrl:     await getSetting('SOCIAL_LINE_URL'),
    fbUrl:       await getSetting('SOCIAL_FB_URL'),
    themeColor:  await getSetting('SITE_THEME_COLOR'),
    footerPages:  [...slugItems(footerSlugs), ...navItems(footerNavItems)],
    shopNavPages: [...slugItems(shopSlugs),   ...navItems(shopNavItems).map(({ footerColumn, ...rest }) => rest)],
    profGate: {
      enabled:      (await getSetting('PROF_GATE_ENABLED')) === 'true',
      title:         await getSetting('PROF_GATE_TITLE'),
      body:          await getSetting('PROF_GATE_BODY'),
      confirmLabel:  await getSetting('PROF_GATE_CONFIRM_LABEL'),
      declineLabel:  await getSetting('PROF_GATE_DECLINE_LABEL'),
    },
    marquee: {
      enabled: (m['landing.marquee.enabled'] || '').toLowerCase() === 'true',
      text:     m['landing.marquee.text'] || '',
    },
  });
}));

// Expose busters so admin write routes can purge after edits.
app.locals.bustResponseCache = bustResponseCache;

// Product detail: /products/:sku serves the SPA shell; client fetches by SKU.
app.get('/products/:sku', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'product.html'));
});
app.get('/brands',         (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'brands.html')));
app.get('/brands/:slug',   (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'brand.html')));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.http ?? 500).json({ error: err.message ?? 'internal_error' });
});

// Only bind a socket when running as a normal Node process. On Vercel the
// serverless runtime imports `app` and dispatches requests itself.
if (!process.env.VERCEL) {
  app.listen(config.port, async () => {
    console.log(`資生國際 Shisei Dental running at ${config.appUrl} (${config.env})`);
    try {
      const { warmSettingsCache } = await import('./lib/settings.js');
      await warmSettingsCache();
      console.log('Settings cache warmed.');
    } catch (e) { console.warn('Settings prewarm failed:', e.message); }
  });
}

export default app;

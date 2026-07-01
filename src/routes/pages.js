import express from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { getSetting } from '../lib/settings.js';
import { renderBlocks, isValidBlockType } from '../lib/blocks.js';
import { DEFAULT_HEADER_HTML, DEFAULT_FOOTER_HTML } from '../lib/page-defaults.js';
import { withCache } from '../lib/response-cache.js';

// Memoize the default header/footer template lookups. The site can use this
// data on every /p/:slug request; without the cache each render was paying
// 2 extra Supabase round-trips (~1s).
let defaultTplCache = null;
let defaultTplCacheAt = 0;
const DEFAULT_TPL_TTL = 60_000;
async function getDefaultTemplates() {
  if (defaultTplCache && Date.now() - defaultTplCacheAt < DEFAULT_TPL_TTL) return defaultTplCache;
  const [header, footer] = await Promise.all([
    prisma.pageTemplate.findFirst({ where: { type: 'HEADER', isDefault: true }, select: { html: true } }),
    prisma.pageTemplate.findFirst({ where: { type: 'FOOTER', isDefault: true }, select: { html: true } }),
  ]);
  defaultTplCache = { header, footer };
  defaultTplCacheAt = Date.now();
  return defaultTplCache;
}
export function bustDefaultTemplateCache() { defaultTplCache = null; defaultTplCacheAt = 0; }

export const pagesRouter = express.Router();

// ----- Public: nav + page render -----

// 60s cache — nav rarely changes; admin edits surface on next minute.
pagesRouter.get('/api/nav', withCache(60, async (req, res) => {
  const items = await prisma.navItem.findMany({
    where: { isActive: true, location: 'MAIN' },
    orderBy: { order: 'asc' },
    select: { label: true, href: true, order: true },
  });
  res.json({ items });
}));

// Server-render a published page. Slug-based URL keeps SEO + sharing clean.
pagesRouter.get('/p/:slug', async (req, res) => {
  const page = await prisma.page.findUnique({
    where: { slug: req.params.slug },
    include: {
      headBanner: true,
      footBanner: true,
      headerTemplate: true,
      footerTemplate: true,
      blocks: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!page || !page.isPublished) return res.status(404).send('Page not found');

  // Resolve chrome: page-specific override > DB isDefault row (memoized) > hardcoded fallback.
  const defs = (!page.headerTemplate || !page.footerTemplate) ? await getDefaultTemplates() : null;
  const headerHtml = page.headerTemplate?.html ?? defs?.header?.html ?? DEFAULT_HEADER_HTML;
  const footerHtml = page.footerTemplate?.html ?? defs?.footer?.html ?? DEFAULT_FOOTER_HTML;

  const siteName    = await getSetting('SITE_NAME');
  const siteTagline = await getSetting('SITE_TAGLINE');
  const siteOgImage = await getSetting('SITE_OG_IMAGE');
  const appUrl      = await getSetting('APP_URL');

  // Blocks take precedence — pages with at least one block render via the block
  // pipeline; pages with no blocks fall back to legacy HTML body for back-compat.
  let bodyHtml;
  if (page.blocks.length > 0) {
    bodyHtml = await renderBlocks(page.blocks);
  } else {
    let renderedBody = page.body || '';
    if (renderedBody.includes('<!--TIER_TABLE-->')) {
      renderedBody = renderedBody.replace(/<!--TIER_TABLE-->/g, await renderTierTable());
    }
    bodyHtml = `<article class="max-w-3xl mx-auto px-6 py-16">
      <h1 class="text-4xl lg:text-5xl font-black mb-8">${escapeHtml(page.title)}</h1>
      <div class="prose">${renderedBody}</div>
    </article>`;
  }

  const title       = page.metaTitle || `${page.title} · ${siteName}`;
  const description = page.metaDesc  || siteTagline;
  const ogTitle     = page.ogTitle   || page.title;
  const ogImage     = page.ogImage   || siteOgImage;
  const canonical   = `${appUrl.replace(/\/$/, '')}/p/${page.slug}`;

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:site_name" content="${escapeHtml(siteName)}"/>
  <meta property="og:title" content="${escapeHtml(ogTitle)}"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:url" content="${escapeHtml(canonical)}"/>
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}"/>` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}"/>
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>` : ''}
  <link rel="manifest" href="/manifest.json"/>
  <meta name="theme-color" content="#0d9488"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css"/>
  <style>
    .prose h1 { font-size: 2.25rem; font-weight: 900; margin: 1.5rem 0 1rem; }
    .prose h2 { font-size: 1.75rem; font-weight: 800; margin: 1.5rem 0 .75rem; color: #0f172a; }
    .prose h3 { font-size: 1.35rem; font-weight: 700; margin: 1.25rem 0 .5rem; }
    .prose p  { line-height: 1.8; color: #334155; margin: .75rem 0; }
    .prose ul, .prose ol { margin: .75rem 0 .75rem 1.5rem; line-height: 1.8; color: #334155; }
    .prose ul { list-style: disc; } .prose ol { list-style: decimal; }
    .prose a  { color: #0d9488; text-decoration: underline; }
    .prose img { border-radius: 1rem; margin: 1.5rem 0; max-width: 100%; height: auto; }
    .prose strong { color: #0f172a; }
    .prose hr { margin: 2rem 0; border-color: #e2e8f0; }
  </style>
</head>
<body class="font-sans bg-white text-slate-900 antialiased">
  ${headerHtml}

  ${renderBanner(page.headBanner)}
  ${renderPageBanner(page)}

  <main class="py-12 px-6">${bodyHtml}</main>

  ${renderBanner(page.footBanner)}

  ${footerHtml}

  <script src="/js/main-nav.js"></script>
  <script src="/js/auth-nav.js"></script>
  <script src="/js/content.js"></script>
  <script src="/js/footer.js"></script>
</body>
</html>`;
  res.set('Cache-Control', 'public, max-age=60');
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

// Per-page direct banner (page.bannerEnabled + bannerImageUrl). Independent
// of the HeroBanner picker; admin uploads an image directly on the page modal.
function renderPageBanner(p) {
  if (!p.bannerEnabled || !p.bannerImageUrl) return '';
  const img = `<img src="${escapeHtml(p.bannerImageUrl)}" alt="" class="w-full h-auto block"/>`;
  const wrap = `<div class="relative rounded-2xl overflow-hidden bg-slate-100">${img}</div>`;
  const inner = p.bannerLinkUrl ? `<a href="${escapeHtml(p.bannerLinkUrl)}" class="block">${wrap}</a>` : wrap;
  return `<section class="max-w-6xl mx-auto px-6 mt-6">${inner}</section>`;
}

function renderBanner(b) {
  if (!b || !b.isActive) return '';
  const inner = `<img src="${escapeHtml(b.imageUrl)}" alt="" class="w-full h-auto block"/>${
    b.captionHtml ? `<div class="absolute inset-0 grid place-items-center p-6 text-white text-center">${b.captionHtml}</div>` : ''
  }`;
  const wrap = `<div class="relative rounded-2xl overflow-hidden bg-slate-100">${inner}</div>`;
  const linked = b.linkUrl
    ? `<a href="${escapeHtml(b.linkUrl)}" class="block">${wrap}</a>`
    : wrap;
  return `<section class="max-w-6xl mx-auto px-6 mt-6">${linked}</section>`;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Build a live tier table from current Tier rows. Embedded in any Page whose
// body contains the marker <!--TIER_TABLE--> — used by /p/member-tiers so
// edits made in /admin-tiers.html automatically reflect on the member page.
async function renderTierTable() {
  const tiers = await prisma.tier.findMany({
    where: { isActive: true }, orderBy: { sortOrder: 'asc' },
  });
  if (tiers.length === 0) return '<p><i>尚未設定會員等級。</i></p>';
  return `
<div style="overflow-x:auto; margin:1.5rem 0">
  <table style="width:100%; min-width:680px; border-collapse:collapse; font-size:.9rem">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="padding:.85rem; text-align:left;  border:1px solid #e2e8f0; font-weight:700">等級</th>
        <th style="padding:.85rem; text-align:right; border:1px solid #e2e8f0; font-weight:700">免運門檻</th>
        <th style="padding:.85rem; text-align:right; border:1px solid #e2e8f0; font-weight:700">升等門檻<br><span style="font-weight:400; font-size:.75rem; color:#64748b">(年消費)</span></th>
        <th style="padding:.85rem; text-align:right; border:1px solid #e2e8f0; font-weight:700">維持門檻<br><span style="font-weight:400; font-size:.75rem; color:#64748b">(明年保留)</span></th>
        <th style="padding:.85rem; text-align:left;  border:1px solid #e2e8f0; font-weight:700">福利</th>
      </tr>
    </thead>
    <tbody>
${tiers.map((t) => `      <tr>
        <td style="padding:.85rem; border:1px solid #e2e8f0; font-weight:700">${escapeHtml(t.nameZh)} <span style="font-family:monospace; font-size:.7rem; color:#64748b">(${escapeHtml(t.code)})</span></td>
        <td style="padding:.85rem; border:1px solid #e2e8f0; text-align:right">NT$ ${t.freeShippingThreshold.toLocaleString()}</td>
        <td style="padding:.85rem; border:1px solid #e2e8f0; text-align:right">${t.yearlyUpgradeThreshold ? 'NT$ ' + t.yearlyUpgradeThreshold.toLocaleString() : '<span style="color:#64748b">— 已是最高等級 —</span>'}</td>
        <td style="padding:.85rem; border:1px solid #e2e8f0; text-align:right">${t.yearlyRetainThreshold ? 'NT$ ' + t.yearlyRetainThreshold.toLocaleString() : '<span style="color:#64748b">永久維持</span>'}</td>
        <td style="padding:.85rem; border:1px solid #e2e8f0">${(t.benefits ?? '').split('\n').filter(Boolean).map((b) => '• ' + escapeHtml(b)).join('<br>')}</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
</div>`;
}

// ----- Admin: Pages CRUD + NavItem CRUD -----

const adminRouter = express.Router();

const pageSchema = z.object({
  slug: z.string().optional(),
  title: z.string().min(1),
  body: z.string().default(''),
  metaTitle: z.string().optional().nullable(),
  metaDesc: z.string().optional().nullable(),
  ogTitle: z.string().optional().nullable(),
  ogImage: z.string().optional().nullable(),
  isPublished: z.boolean().default(true),
  headBannerId: z.string().nullable().optional(),
  footBannerId: z.string().nullable().optional(),
  bannerEnabled: z.boolean().optional(),
  bannerImageUrl: z.string().nullable().optional(),
  bannerLinkUrl: z.string().nullable().optional(),
  headerTemplateId: z.string().nullable().optional(),
  footerTemplateId: z.string().nullable().optional(),
  addToNav: z.boolean().optional(),
  addToFooter: z.boolean().optional(),
  addToShopNav: z.boolean().optional(),
  navLabel: z.string().optional(),
  navOrder: z.number().int().optional(),
});

adminRouter.get('/pages', requirePermission('pages.view'), async (req, res) => {
  const pages = await prisma.page.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ pages });
});

adminRouter.post('/pages', requirePermission('pages.create'), async (req, res) => {
  const parsed = pageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const d = parsed.data;
  const slug = (d.slug || slugify(d.title, { lower: true, strict: true })) || `page-${Date.now()}`;
  try {
    const page = await prisma.page.create({
      data: {
        slug, title: d.title, body: d.body,
        metaTitle: d.metaTitle ?? null,
        metaDesc:  d.metaDesc  ?? null,
        ogTitle:   d.ogTitle   ?? null,
        ogImage:   d.ogImage   ?? null,
        isPublished: d.isPublished,
        headBannerId: d.headBannerId || null,
        footBannerId: d.footBannerId || null,
        bannerEnabled:    d.bannerEnabled ?? false,
        bannerImageUrl:   d.bannerImageUrl || null,
        bannerLinkUrl:    d.bannerLinkUrl  || null,
        headerTemplateId: d.headerTemplateId || null,
        footerTemplateId: d.footerTemplateId || null,
      },
    });
    await ensureNavItem({ addToNav: d.addToNav, addToFooter: d.addToFooter, addToShopNav: d.addToShopNav,
                          label: d.navLabel || d.title, slug, order: d.navOrder });
    res.json({ page });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'slug_exists' });
    throw e;
  }
});

adminRouter.put('/pages/:id', requirePermission('pages.edit'), async (req, res) => {
  const parsed = pageSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  // Strip virtual flags before passing to Prisma
  const { addToNav, addToFooter, addToShopNav, navLabel, navOrder,
          headBannerId, footBannerId, headerTemplateId, footerTemplateId, ...rest } = parsed.data;
  const data = {
    ...rest,
    ...(headBannerId       !== undefined ? { headBannerId:       headBannerId       || null } : {}),
    ...(footBannerId       !== undefined ? { footBannerId:       footBannerId       || null } : {}),
    ...(headerTemplateId   !== undefined ? { headerTemplateId:   headerTemplateId   || null } : {}),
    ...(footerTemplateId   !== undefined ? { footerTemplateId:   footerTemplateId   || null } : {}),
  };
  const page = await prisma.page.update({ where: { id: req.params.id }, data });
  await ensureNavItem({ addToNav, addToFooter, addToShopNav,
                        label: navLabel || page.title, slug: page.slug, order: navOrder });
  res.json({ page });
});

// Sync NavItem rows to the checkbox state per location. The checkboxes in
// the page modal represent "is this page currently in this menu?" — ticking
// adds the row, unticking removes it. `undefined` skips that location (legacy
// callers that don't send a flag).
async function ensureNavItem({ addToNav, addToFooter, addToShopNav, label, slug, order }) {
  const href = `/p/${slug}`;
  const map = [
    ['MAIN',   addToNav],
    ['FOOTER', addToFooter],
    ['SHOP',   addToShopNav],
  ];
  for (const [location, want] of map) {
    if (want === undefined) continue;
    const existing = await prisma.navItem.findFirst({ where: { href, location } });
    if (want && !existing) {
      await prisma.navItem.create({ data: { label, href, order: order ?? 100, location } });
    } else if (!want && existing) {
      await prisma.navItem.delete({ where: { id: existing.id } });
    }
  }
}

// ----- Page block editor: list + bulk replace -----
//
// Bulk replace pattern: the admin sends the full ordered array each save.
// Server deletes prior blocks and re-inserts. Simpler than per-block CRUD and
// matches how the editor manages local state.

adminRouter.get('/pages/:id/blocks', requirePermission('pages.view'), async (req, res) => {
  const blocks = await prisma.pageBlock.findMany({
    where: { pageId: req.params.id },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ blocks });
});

adminRouter.put('/pages/:id/blocks', requirePermission('pages.edit'), async (req, res) => {
  const arr = Array.isArray(req.body?.blocks) ? req.body.blocks : null;
  if (!arr) return res.status(400).json({ error: 'invalid_input' });
  for (const b of arr) {
    if (!isValidBlockType(b.type)) return res.status(400).json({ error: 'unknown_block_type', type: b.type });
  }
  await prisma.$transaction(async (tx) => {
    await tx.pageBlock.deleteMany({ where: { pageId: req.params.id } });
    if (arr.length > 0) {
      await tx.pageBlock.createMany({
        data: arr.map((b, i) => ({
          pageId: req.params.id,
          type: b.type,
          sortOrder: i,
          props: typeof b.props === 'string' ? b.props : JSON.stringify(b.props ?? {}),
        })),
      });
    }
  });
  res.json({ ok: true, count: arr.length });
});

adminRouter.delete('/pages/:id', requirePermission('pages.delete'), async (req, res) => {
  const page = await prisma.page.findUnique({ where: { id: req.params.id } });
  if (!page) return res.status(404).json({ error: 'not_found' });
  await prisma.navItem.deleteMany({ where: { href: `/p/${page.slug}` } });
  await prisma.page.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// NavItem CRUD
const NAV_LOCATIONS = ['MAIN', 'FOOTER', 'SHOP'];
const navSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
  order: z.number().int().default(100),
  isActive: z.boolean().default(true),
  location: z.enum(['MAIN', 'FOOTER', 'SHOP']).default('MAIN'),
  footerColumn: z.enum(['SERVICE', 'POLICY']).default('SERVICE'),
});

adminRouter.get('/nav', requirePermission('nav.edit'), async (req, res) => {
  const where = req.query.location && NAV_LOCATIONS.includes(req.query.location)
    ? { location: req.query.location } : undefined;
  const items = await prisma.navItem.findMany({ where, orderBy: { order: 'asc' } });
  res.json({ items });
});

adminRouter.post('/nav', requirePermission('nav.edit'), async (req, res) => {
  const parsed = navSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const item = await prisma.navItem.create({ data: parsed.data });
  res.json({ item });
});

adminRouter.put('/nav/:id', requirePermission('nav.edit'), async (req, res) => {
  const parsed = navSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const item = await prisma.navItem.update({ where: { id: req.params.id }, data: parsed.data });
  res.json({ item });
});

adminRouter.delete('/nav/:id', requirePermission('nav.edit'), async (req, res) => {
  await prisma.navItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ----- PageTemplate (HEADER / FOOTER) CRUD -----
const templateSchema = z.object({
  type: z.enum(['HEADER', 'FOOTER']),
  name: z.string().min(1),
  html: z.string().default(''),
  isDefault: z.boolean().default(false),
});

adminRouter.get('/templates', requirePermission('pages.view'), async (req, res) => {
  const where = ['HEADER','FOOTER'].includes(req.query.type) ? { type: req.query.type } : undefined;
  const templates = await prisma.pageTemplate.findMany({ where, orderBy: { updatedAt: 'desc' } });
  res.json({ templates });
});

adminRouter.post('/templates', requirePermission('pages.edit'), async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const t = await prisma.pageTemplate.create({ data: parsed.data });
  bustDefaultTemplateCache();
  res.json({ template: t });
});

adminRouter.put('/templates/:id', requirePermission('pages.edit'), async (req, res) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  try {
    const t = await prisma.pageTemplate.update({ where: { id: req.params.id }, data: parsed.data });
    bustDefaultTemplateCache();
    res.json({ template: t });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

adminRouter.delete('/templates/:id', requirePermission('pages.delete'), async (req, res) => {
  try {
    await prisma.pageTemplate.delete({ where: { id: req.params.id } });
    bustDefaultTemplateCache();
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

pagesRouter.use('/api/admin/pages-mgmt', adminRouter);

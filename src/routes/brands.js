import express from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { withCache, bustResponseCache } from '../lib/response-cache.js';

export const brandsRouter = express.Router();

// ----- Public -----
// Returns each brand plus up to 4 products for the stacked-section layout
// on /brands. UI uses productCount to render the "查看更多" CTA.
// 60s cache — brand catalog rarely changes during a session.
brandsRouter.get('/', withCache(60, async (req, res) => {
  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      _count: { select: { products: { where: { isActive: true } } } },
      products: {
        where: { isActive: true },
        take: 3,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true, sku: true, nameZh: true, imageUrl: true,
          labels: true, priceA: true, priceOriginal: true,
        },
      },
    },
  });
  res.json({
    brands: brands.map((b) => ({
      id: b.id, slug: b.slug, nameZh: b.nameZh, nameEn: b.nameEn,
      logoUrl: b.logoUrl, wordmarkUrl: b.wordmarkUrl, tagline: b.tagline,
      introHtml: b.introHtml,
      productCount: b._count.products,
      products: b.products.map((p) => ({
        id: p.id, sku: p.sku, nameZh: p.nameZh, imageUrl: p.imageUrl,
        labels: (p.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        priceOriginal: p.priceOriginal ?? p.priceA,
      })),
    })),
  });
}));

brandsRouter.get('/slug/:slug', async (req, res) => {
  const b = await prisma.brand.findUnique({
    where: { slug: req.params.slug },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { category: { select: { slug: true, nameZh: true } } },
      },
    },
  });
  if (!b || !b.isActive) return res.status(404).json({ error: 'not_found' });
  res.json({
    brand: {
      id: b.id, slug: b.slug, nameZh: b.nameZh, nameEn: b.nameEn,
      logoUrl: b.logoUrl, wordmarkUrl: b.wordmarkUrl, tagline: b.tagline,
      introHtml: b.introHtml,
    },
    products: b.products.map((p) => ({
      id: p.id, sku: p.sku, nameZh: p.nameZh, imageUrl: p.imageUrl,
      priceOriginal: p.priceOriginal ?? p.priceA,
      labels: (p.labels ?? '').split(',').filter(Boolean),
      category: p.category,
    })),
  });
});

// ----- Admin -----
const adminRouter = express.Router();

const brandSchema = z.object({
  slug: z.string().optional(),
  nameZh: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  wordmarkUrl: z.string().optional().nullable(),
  tagline: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  introHtml: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminRouter.get('/', requirePermission('catalog.brands.edit', 'catalog.view'), async (req, res) => {
  const brands = await prisma.brand.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: true } } },
  });
  res.json({
    brands: brands.map((b) => ({ ...b, productCount: b._count.products })),
  });
});

adminRouter.post('/', requirePermission('catalog.brands.edit'), async (req, res) => {
  const parsed = brandSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const d = parsed.data;
  const slug = (d.slug || slugify(d.nameEn ?? d.nameZh, { lower: true, strict: true })) || `brand-${Date.now()}`;
  try {
    const brand = await prisma.brand.create({ data: { ...d, slug } });
    res.json({ brand });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'slug_exists' });
    throw e;
  }
});

adminRouter.put('/:id', requirePermission('catalog.brands.edit'), async (req, res) => {
  const parsed = brandSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const brand = await prisma.brand.update({ where: { id: req.params.id }, data: parsed.data });
  res.json({ brand });
});

adminRouter.delete('/:id', requirePermission('catalog.brands.edit'), async (req, res) => {
  const count = await prisma.product.count({ where: { brandId: req.params.id } });
  if (count > 0) return res.status(409).json({ error: 'brand_has_products', count });
  await prisma.brand.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

brandsRouter.use('/admin', adminRouter);

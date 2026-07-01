import express from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { prisma } from '../db.js';
import { requirePermission, requireVerifiedMember } from '../middleware/auth.js';

export const bundlesRouter = express.Router();

// ----- Public (verified members only) -----
// Anonymous users see 401 → shop renders a "登入後查看" placeholder.
bundlesRouter.get('/', requireVerifiedMember, async (req, res) => {
  const now = new Date();
  const where = {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt:   null }, { endsAt:   { gte: now } }] },
    ],
  };
  if (req.query.featured) where.isFeatured = true;

  const bundles = await prisma.bundle.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: {
        include: { product: { select: { id: true, sku: true, nameZh: true, imageUrl: true } } },
      },
    },
  });
  res.json({ bundles });
});

bundlesRouter.get('/slug/:slug', requireVerifiedMember, async (req, res) => {
  const b = await prisma.bundle.findUnique({
    where: { slug: req.params.slug },
    include: {
      items: { include: { product: { select: { id: true, sku: true, nameZh: true, imageUrl: true } } } },
    },
  });
  if (!b || !b.isActive) return res.status(404).json({ error: 'not_found' });
  res.json({ bundle: b });
});

// ----- Admin CRUD -----
const itemInput = z.object({ productId: z.string(), quantity: z.number().int().min(1) });
const bundleSchema = z.object({
  slug: z.string().optional(),
  nameZh: z.string().min(1),
  descriptionZh: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  originalPrice: z.number().int().min(0),
  bundlePrice:   z.number().int().min(0),
  isFeatured: z.boolean().default(false),
  isActive:   z.boolean().default(true),
  sortOrder:  z.number().int().default(0),
  startsAt:   z.string().nullable().optional(),
  endsAt:     z.string().nullable().optional(),
  items: z.array(itemInput).min(1, '至少一個商品'),
});

bundlesRouter.get('/admin', requirePermission('bundles.edit'), async (req, res) => {
  const bundles = await prisma.bundle.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      items: { include: { product: { select: { id: true, sku: true, nameZh: true, priceA: true } } } },
    },
  });
  res.json({ bundles });
});

bundlesRouter.post('/admin', requirePermission('bundles.edit'), async (req, res) => {
  const parsed = bundleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const d = parsed.data;
  const slug = (d.slug || slugify(d.nameZh, { lower: true, strict: true })) || `bundle-${Date.now()}`;
  try {
    const bundle = await prisma.bundle.create({
      data: {
        slug, nameZh: d.nameZh, descriptionZh: d.descriptionZh ?? null,
        imageUrl: d.imageUrl ?? null,
        originalPrice: d.originalPrice, bundlePrice: d.bundlePrice,
        isFeatured: d.isFeatured, isActive: d.isActive, sortOrder: d.sortOrder,
        startsAt: d.startsAt ? new Date(d.startsAt) : null,
        endsAt:   d.endsAt   ? new Date(d.endsAt)   : null,
        items: { create: d.items },
      },
      include: { items: true },
    });
    res.json({ bundle });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'slug_exists' });
    throw e;
  }
});

bundlesRouter.put('/admin/:id', requirePermission('bundles.edit'), async (req, res) => {
  const parsed = bundleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const d = parsed.data;
  const data = { ...d };
  delete data.items;
  if ('startsAt' in data) data.startsAt = data.startsAt ? new Date(data.startsAt) : null;
  if ('endsAt'   in data) data.endsAt   = data.endsAt   ? new Date(data.endsAt)   : null;
  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.bundle.update({ where: { id: req.params.id }, data });
    if (d.items) {
      await tx.bundleItem.deleteMany({ where: { bundleId: b.id } });
      await tx.bundleItem.createMany({
        data: d.items.map((i) => ({ ...i, bundleId: b.id })),
      });
    }
    return b;
  });
  res.json({ bundle: updated });
});

bundlesRouter.delete('/admin/:id', requirePermission('bundles.edit'), async (req, res) => {
  await prisma.bundle.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

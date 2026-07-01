// 檔期優惠 (Seasonal Promotions): page settings + product flags.
// Public endpoint feeds /promotion.html. Admin endpoints feed /admin-promotion.html.
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { withCache, bustResponseCache } from '../lib/response-cache.js';

export const promotionRouter = express.Router();

// Public: one shot of everything /promotion.html needs.
// 30s cache — same trade-off as /api/site.
promotionRouter.get('/', withCache(30, async (_req, res) => {
  const now = new Date();
  // Active-window filter: NULL means "no constraint on that bound".
  const inWindow = {
    AND: [
      { OR: [{ promoStartsAt: null }, { promoStartsAt: { lte: now } }] },
      { OR: [{ promoEndsAt:   null }, { promoEndsAt:   { gte: now } }] },
    ],
  };
  const page = await prisma.promotionPage.findUnique({ where: { id: 'default' } });
  const [groupBuyProducts, monthlyProducts] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, isGroupBuy: true, ...inWindow },
      select: {
        id:true, sku:true, nameZh:true, imageUrl:true, images:true,
        priceA:true, priceOriginal:true,
        groupBuyTarget:true, groupBuyCurrent:true,
        promoStartsAt:true, promoEndsAt:true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.findMany({
      where: { isActive: true, isMonthlySpecial: true, ...inWindow },
      select: {
        id:true, sku:true, nameZh:true, imageUrl:true, images:true,
        priceA:true, priceOriginal:true,
        promoStartsAt:true, promoEndsAt:true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  res.json({ page, groupBuyProducts, monthlyProducts });
}));

// Admin
const adminRouter = express.Router();
adminRouter.use(requirePermission('content.edit'));

const pageSchema = z.object({
  isActive:        z.boolean().optional(),
  mainTitle:       z.string().min(1).optional(),
  subTitle:        z.string().optional().nullable(),
  startDate:       z.string().datetime().optional().nullable(),
  endDate:         z.string().datetime().optional().nullable(),
  monthlyBanner:   z.string().optional().nullable(),
  groupHeading:    z.string().optional(),
  monthlyHeading:  z.string().optional(),
});

adminRouter.get('/', async (_req, res) => {
  const page = await prisma.promotionPage.upsert({
    where: { id: 'default' }, update: {}, create: {},
  });
  res.json({ page });
});

adminRouter.put('/', async (req, res) => {
  const parsed = pageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const data = { ...parsed.data };
  if (data.startDate) data.startDate = new Date(data.startDate);
  if (data.endDate)   data.endDate   = new Date(data.endDate);
  const page = await prisma.promotionPage.upsert({
    where: { id: 'default' }, update: data, create: { id:'default', ...data },
  });
  bustResponseCache('/api/promotion');
  res.json({ page });
});

// Per-product flag toggle (called from /admin-promotion.html product table)
const productFlagsSchema = z.object({
  isGroupBuy:       z.boolean().optional(),
  isMonthlySpecial: z.boolean().optional(),
  groupBuyTarget:   z.number().int().min(0).optional().nullable(),
  groupBuyCurrent:  z.number().int().min(0).optional(),
  priceOriginal:    z.number().int().min(0).optional().nullable(),
  promoStartsAt:    z.string().nullable().optional(),
  promoEndsAt:      z.string().nullable().optional(),
});
adminRouter.put('/products/:id', async (req, res) => {
  const parsed = productFlagsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const data = { ...parsed.data };
  if ('promoStartsAt' in data) data.promoStartsAt = data.promoStartsAt ? new Date(data.promoStartsAt) : null;
  if ('promoEndsAt'   in data) data.promoEndsAt   = data.promoEndsAt   ? new Date(data.promoEndsAt)   : null;
  try {
    const p = await prisma.product.update({ where: { id: req.params.id }, data });
    bustResponseCache('/api/promotion');
    res.json({ product: { id: p.id, sku: p.sku, nameZh: p.nameZh,
      isGroupBuy: p.isGroupBuy, isMonthlySpecial: p.isMonthlySpecial,
      groupBuyTarget: p.groupBuyTarget, groupBuyCurrent: p.groupBuyCurrent,
      priceOriginal: p.priceOriginal,
      promoStartsAt: p.promoStartsAt, promoEndsAt: p.promoEndsAt } });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

// List all products (admin only) so the promo-management page can show toggles.
adminRouter.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id:true, sku:true, nameZh:true, imageUrl:true,
              priceA:true, priceOriginal:true,
              isGroupBuy:true, isMonthlySpecial:true,
              groupBuyTarget:true, groupBuyCurrent:true,
              promoStartsAt:true, promoEndsAt:true },
  });
  res.json({ products });
});

promotionRouter.use('/admin', adminRouter);

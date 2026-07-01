// Shipping region: per-region free-shipping threshold + fee.
// Public GET feeds the checkout dropdown; admin CRUD lives at /admin-shipping.html.
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { withCache, bustResponseCache } from '../lib/response-cache.js';

export const shippingRouter = express.Router();

// 5-min cache — shipping fees change very rarely.
shippingRouter.get('/regions', withCache(300, async (_req, res) => {
  const regions = await prisma.shippingRegion.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { code: true, nameZh: true, freeAtAmount: true, shippingFee: true, isDefault: true },
  });
  res.json({ regions });
}));

// Admin
const schema = z.object({
  code: z.string().min(2).regex(/^[A-Z0-9_-]+$/i),
  nameZh: z.string().min(1),
  freeAtAmount: z.number().int().min(0),
  shippingFee: z.number().int().min(0),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const adminRouter = express.Router();
adminRouter.use(requirePermission('settings.edit'));

adminRouter.get('/', async (_req, res) => {
  const regions = await prisma.shippingRegion.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json({ regions });
});

adminRouter.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  try {
    // Only one default; clear others if this one is marked default.
    if (parsed.data.isDefault) await prisma.shippingRegion.updateMany({ data: { isDefault: false } });
    const r = await prisma.shippingRegion.create({ data: parsed.data });
    res.json({ region: r });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'code_exists' });
    throw e;
  }
});

adminRouter.put('/:id', async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  if (parsed.data.isDefault) {
    await prisma.shippingRegion.updateMany({ where: { id: { not: req.params.id } }, data: { isDefault: false } });
  }
  try {
    const r = await prisma.shippingRegion.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ region: r });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

adminRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.shippingRegion.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

shippingRouter.use('/admin/regions', adminRouter);

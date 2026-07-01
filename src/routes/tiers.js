import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { bustTierCache, listTiers } from '../lib/tiers.js';

export const tiersRouter = express.Router();

// Public — used by landing/account pages to show benefits.
tiersRouter.get('/', async (req, res) => {
  const tiers = await listTiers();
  res.json({
    tiers: tiers
      .filter((t) => t.isActive)
      .map((t) => ({
        code: t.code, nameZh: t.nameZh, benefits: t.benefits,
        discountPercent: t.discountPercent, freeShippingThreshold: t.freeShippingThreshold,
      })),
  });
});

tiersRouter.get('/admin', requirePermission('tiers.edit'), async (req, res) => {
  const tiers = await prisma.tier.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json({ tiers });
});

const tierSchema = z.object({
  code: z.string().regex(/^[A-Z_]+$/),
  nameZh: z.string().min(1),
  priceField: z.enum(['A', 'B', 'C', 'D']),
  discountPercent: z.number().int().min(0).max(80),
  freeShippingThreshold: z.number().int().min(0),
  creditInstallmentMax: z.number().int().min(0).max(36),
  benefits: z.string().optional().default(''),
  description: z.string().optional().default(''),
  yearlyUpgradeThreshold: z.number().int().min(0).optional().nullable(),
  yearlyRetainThreshold:  z.number().int().min(0).optional().nullable(),
  nextTierCode: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

tiersRouter.post('/admin', requirePermission('tiers.edit'), async (req, res) => {
  const parsed = tierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const tier = await prisma.tier.upsert({
    where: { code: parsed.data.code },
    update: parsed.data,
    create: parsed.data,
  });
  bustTierCache();
  await prisma.auditLog.create({
    data: { userId: req.user.id, action: 'TIER_UPSERT', detail: tier.code },
  });
  res.json({ tier });
});

tiersRouter.delete('/admin/:code', requirePermission('tiers.edit'), async (req, res) => {
  const inUse = await prisma.user.count({ where: { tier: req.params.code } });
  if (inUse > 0) return res.status(409).json({ error: 'tier_in_use', userCount: inUse });
  await prisma.tier.deleteMany({ where: { code: req.params.code } });
  bustTierCache();
  res.json({ ok: true });
});

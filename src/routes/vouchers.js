import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission, requireVerifiedMember } from '../middleware/auth.js';
import { evaluateVoucher } from '../lib/voucher.js';

export const vouchersRouter = express.Router();

// Public (verified member) — vouchers this member is eligible to use right now.
vouchersRouter.get('/mine', requireVerifiedMember, async (req, res) => {
  const now = new Date();
  const all = await prisma.voucher.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ validFrom:  null }, { validFrom:  { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    },
    orderBy: [{ validUntil: 'asc' }, { code: 'asc' }],
  });
  // Vouchers may be tier-locked via TierVoucher; resolve which tier(s) each
  // belongs to and only return ones the user qualifies for.
  const userTier = await prisma.tier.findUnique({ where: { code: req.user.tier } });
  const tierLinks = await prisma.tierVoucher.findMany({ select: { tierId: true, voucherId: true } });
  const lockedTo = new Map();
  for (const link of tierLinks) {
    const arr = lockedTo.get(link.voucherId) ?? [];
    arr.push(link.tierId); lockedTo.set(link.voucherId, arr);
  }
  const out = all
    .filter((v) => {
      const tiers = lockedTo.get(v.id);
      if (!tiers || tiers.length === 0) return true;     // open to all
      return userTier && tiers.includes(userTier.id);
    })
    .map((v) => ({
      code: v.code, description: v.description,
      type: v.type, value: v.value,
      minOrderAmount: v.minOrderAmount,
      validUntil: v.validUntil,
      usageLimit: v.usageLimit, usedCount: v.usedCount,
    }));
  res.json({ vouchers: out });
});

// Public (verified member) — validate a code against a hypothetical subtotal.
vouchersRouter.post('/validate', requireVerifiedMember, async (req, res) => {
  const { code, subtotal } = req.body ?? {};
  if (typeof subtotal !== 'number') return res.status(400).json({ error: 'invalid_subtotal' });
  const result = await evaluateVoucher(code, subtotal, req.user.tier, req.user.id);
  if (!result.ok) return res.json({ valid: false, message: result.message });
  res.json({
    valid: true,
    discount: result.discount,
    message: result.message,
    voucher: {
      code: result.voucher.code,
      description: result.voucher.description,
      type: result.voucher.type,
      value: result.voucher.value,
    },
  });
});

// Admin CRUD
const adminRouter = express.Router();

const voucherSchema = z.object({
  code: z.string().min(2).regex(/^[A-Z0-9_-]+$/i),
  description: z.string().optional().nullable(),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().min(1),
  minOrderAmount: z.number().int().min(0).default(0),
  validFrom:  z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  usageLimit: z.number().int().min(1).optional().nullable(),
  isActive: z.boolean().default(true),
  // Per-member monthly use cap (null = unlimited)
  monthlyPerMember: z.number().int().min(1).optional().nullable(),
  // If empty array → available to ALL tiers. Non-empty → restricted.
  allowedTierCodes: z.array(z.string()).optional(),
});

adminRouter.get('/', requirePermission('vouchers.view'), async (req, res) => {
  const vouchers = await prisma.voucher.findMany({
    orderBy: { createdAt: 'desc' },
    include: { tierLinks: { include: { tier: { select: { code: true, nameZh: true } } } } },
  });
  res.json({
    vouchers: vouchers.map((v) => ({
      ...v,
      allowedTierCodes: v.tierLinks.map((l) => l.tier.code),
    })),
  });
});

async function syncTierLinks(voucherId, allowedTierCodes) {
  await prisma.tierVoucher.deleteMany({ where: { voucherId } });
  if (!allowedTierCodes?.length) return;
  const tiers = await prisma.tier.findMany({ where: { code: { in: allowedTierCodes } } });
  await prisma.tierVoucher.createMany({
    data: tiers.map((t) => ({ tierId: t.id, voucherId })),
  });
}

adminRouter.post('/', requirePermission('vouchers.create'), async (req, res) => {
  const parsed = voucherSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const { allowedTierCodes, ...d } = parsed.data;
  try {
    const voucher = await prisma.voucher.create({
      data: {
        ...d,
        code: d.code.toUpperCase(),
        validFrom:  d.validFrom  ? new Date(d.validFrom)  : null,
        validUntil: d.validUntil ? new Date(d.validUntil) : null,
      },
    });
    await syncTierLinks(voucher.id, allowedTierCodes);
    res.json({ voucher });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'code_exists' });
    throw e;
  }
});

adminRouter.put('/:id', requirePermission('vouchers.edit'), async (req, res) => {
  const parsed = voucherSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { allowedTierCodes, ...d } = parsed.data;
  const voucher = await prisma.voucher.update({
    where: { id: req.params.id },
    data: {
      ...d,
      code: d.code ? d.code.toUpperCase() : undefined,
      validFrom:  d.validFrom  !== undefined ? (d.validFrom  ? new Date(d.validFrom)  : null) : undefined,
      validUntil: d.validUntil !== undefined ? (d.validUntil ? new Date(d.validUntil) : null) : undefined,
    },
  });
  if (allowedTierCodes !== undefined) await syncTierLinks(voucher.id, allowedTierCodes);
  res.json({ voucher });
});

adminRouter.delete('/:id', requirePermission('vouchers.delete'), async (req, res) => {
  await prisma.voucher.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

vouchersRouter.use('/admin', adminRouter);

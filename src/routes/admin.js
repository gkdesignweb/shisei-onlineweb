import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { notifyOrder } from '../lib/notify.js';

export const adminRouter = express.Router();

adminRouter.get('/members/pending', requirePermission('members.view'), async (req, res) => {
  const users = await prisma.user.findMany({
    where: { verificationStatus: 'PENDING', role: 'MEMBER' },
    select: {
      id: true, email: true, name: true, clinicName: true,
      medicalLicenseNo: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ users });
});

const verifySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  tier: z.enum(['BRONZE', 'GOLD']).optional(),
});

adminRouter.post('/members/:id/verify', requirePermission('members.verify'), async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { decision, tier } = parsed.data;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      verificationStatus: decision,
      ...(decision === 'APPROVED' && tier ? { tier } : {}),
    },
  });
  await prisma.auditLog.create({
    data: { userId: req.user.id, action: `MEMBER_${decision}`, detail: `target=${user.id} tier=${tier ?? ''}` },
  });
  res.json({ ok: true });
});

// Finance: see all orders + payment status
adminRouter.get('/orders', requirePermission('orders.view'), async (req, res) => {
  const status = req.query.status;
  const orders = await prisma.order.findMany({
    where: status ? { status } : undefined,
    include: { items: true, user: { select: { name: true, clinicName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ orders });
});

// Warehouse: mark shipped
const shipSchema = z.object({ trackingNumber: z.string().min(1) });
// Update tracking number any time, no status change. Used by warehouse to
// correct typos or add it before/after marking shipped.
adminRouter.patch('/orders/:id/tracking', requirePermission('orders.ship', 'orders.view'), async (req, res) => {
  const trackingNumber = String(req.body?.trackingNumber ?? '').trim();
  try {
    await prisma.order.update({
      where: { id: req.params.id },
      data: { trackingNumber: trackingNumber || null },
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

adminRouter.post('/orders/:id/ship', requirePermission('orders.ship'), async (req, res) => {
  const parsed = shipSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: 'SHIPPED',
      trackingNumber: parsed.data.trackingNumber,
      shippedAt: new Date(),
    },
    include: { user: true },
  });
  await notifyOrder('ORDER_SHIPPED', order, order.user);
  res.json({ ok: true });
});

import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const leadsRouter = express.Router();

const leadSchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().optional().nullable(),
  source: z.string().optional().default('callback'),
});

leadsRouter.post('/', async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  await prisma.lead.create({
    data: { phone: d.phone, name: d.name ?? null, source: d.source },
  });
  res.json({ ok: true, message: '已收到您的來電請求，業務專員將盡快與您聯繫。' });
});

// Admin
leadsRouter.get('/admin', requirePermission('leads.view'), async (req, res) => {
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ leads });
});

leadsRouter.post('/admin/:id/handle', requirePermission('leads.view'), async (req, res) => {
  await prisma.lead.update({
    where: { id: req.params.id },
    data: { handled: true, handledById: req.user.id, note: req.body?.note ?? null },
  });
  res.json({ ok: true });
});

leadsRouter.delete('/admin/:id', requirePermission('leads.view'), async (req, res) => {
  await prisma.lead.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

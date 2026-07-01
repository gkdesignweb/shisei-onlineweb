import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const bannersRouter = express.Router();

const PLACEMENTS = ['CAROUSEL', 'PAGE'];

// Public — landing carousel only ever wants CAROUSEL
bannersRouter.get('/', async (req, res) => {
  const placement = PLACEMENTS.includes(req.query.placement) ? req.query.placement : 'CAROUSEL';
  const banners = await prisma.heroBanner.findMany({
    where: { isActive: true, placement },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ banners });
});

// Admin
const schema = z.object({
  name: z.string().optional().nullable(),
  imageUrl: z.string().min(1),
  linkUrl: z.string().optional().nullable(),
  captionHtml: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  placement: z.enum(['CAROUSEL', 'PAGE']).optional(),
});

bannersRouter.get('/admin', requirePermission('banners.edit'), async (req, res) => {
  const where = PLACEMENTS.includes(req.query.placement) ? { placement: req.query.placement } : undefined;
  const banners = await prisma.heroBanner.findMany({ where, orderBy: { sortOrder: 'asc' } });
  res.json({ banners });
});

bannersRouter.post('/admin', requirePermission('banners.edit'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const banner = await prisma.heroBanner.create({
    data: { ...parsed.data, placement: parsed.data.placement || 'CAROUSEL' },
  });
  res.json({ banner });
});

bannersRouter.put('/admin/:id', requirePermission('banners.edit'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const banner = await prisma.heroBanner.update({ where: { id: req.params.id }, data: parsed.data });
  res.json({ banner });
});

bannersRouter.delete('/admin/:id', requirePermission('banners.edit'), async (req, res) => {
  await prisma.heroBanner.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

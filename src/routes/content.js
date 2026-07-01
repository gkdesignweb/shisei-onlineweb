import express from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { withCache, bustResponseCache } from '../lib/response-cache.js';

export const contentRouter = express.Router();

// 30s cache — admin edits surface within half a minute.
// Bust on writes (see admin POST/DELETE below).
contentRouter.get('/', withCache(30, async (req, res) => {
  const blocks = await prisma.contentBlock.findMany({ orderBy: { sortOrder: 'asc' } });
  const map = {};
  for (const b of blocks) map[b.key] = b.valueZh;
  res.json({ content: map });
}));

// Admin — full block records grouped for the editor.
contentRouter.get('/admin', requirePermission('content.edit'), async (req, res) => {
  const blocks = await prisma.contentBlock.findMany({
    orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
  });
  res.json({ blocks });
});

const upsertSchema = z.object({
  // Key is optional on create — auto-generated from group + label.
  key: z.string().regex(/^[a-z0-9._-]+$/i).optional(),
  group: z.string().min(1).default('misc'),
  label: z.string().optional(),
  valueZh: z.string(),
  kind: z.enum(['text', 'richtext', 'image', 'url']).default('text'),
});

async function autoKey(group, label) {
  const slugged = slugify(label || 'block', { lower: true, strict: true }) || 'block';
  const base = `${group}.${slugged}`;
  let key = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.contentBlock.findUnique({ where: { key } })) {
    n += 1;
    key = `${base}-${n}`;
  }
  return key;
}

contentRouter.post('/admin', requirePermission('content.edit'), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const data = parsed.data;
  const key = data.key || await autoKey(data.group, data.label);
  const block = await prisma.contentBlock.upsert({
    where: { key },
    update: { ...data, key },
    create: { ...data, key },
  });
  await prisma.auditLog.create({
    data: { userId: req.user.id, action: 'CONTENT_UPDATE', detail: key },
  });
  bustResponseCache('/api/content');
  bustResponseCache('/api/site'); // marquee lives in contentBlock
  res.json({ block });
});

contentRouter.delete('/admin/:key', requirePermission('content.edit'), async (req, res) => {
  await prisma.contentBlock.deleteMany({ where: { key: req.params.key } });
  bustResponseCache('/api/content');
  bustResponseCache('/api/site');
  res.json({ ok: true });
});

import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const mediaRouter = express.Router();

const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const MAX_BYTES_IMAGE = 5  * 1024 * 1024;   // 5 MB
const MAX_BYTES_VIDEO = 100 * 1024 * 1024;  // 100 MB

const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    const d = new Date();
    const dir = path.join(
      process.cwd(), 'public', 'uploads',
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
    );
    await fs.mkdir(dir, { recursive: true });
    req._uploadDir = dir;
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(12).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  // Outer cap is the video limit; we enforce the tighter image cap per-file below.
  limits: { fileSize: MAX_BYTES_VIDEO },
  fileFilter: (_req, file, cb) => {
    const isImg = ALLOWED_IMAGE.has(file.mimetype);
    const isVid = ALLOWED_VIDEO.has(file.mimetype);
    if (!isImg && !isVid) {
      return cb(Object.assign(new Error('unsupported_type'), { http: 415 }));
    }
    cb(null, true);
  },
});

mediaRouter.post('/', requirePermission('media.upload'), upload.array('files', 12), async (req, res) => {
  const out = [];
  const rejected = [];
  for (const file of req.files ?? []) {
    // Enforce the tighter per-type cap: images must be <= 5 MB, videos <= 100 MB.
    const isImg = ALLOWED_IMAGE.has(file.mimetype);
    const cap = isImg ? MAX_BYTES_IMAGE : MAX_BYTES_VIDEO;
    if (file.size > cap) {
      await fs.unlink(file.path).catch(() => {});
      rejected.push({ name: file.originalname, reason: 'file_too_large', limitMb: cap / 1024 / 1024 });
      continue;
    }
    const relDir = path.relative(path.join(process.cwd(), 'public'), req._uploadDir);
    const url = '/' + path.join(relDir, file.filename).replace(/\\/g, '/');
    const m = await prisma.media.create({
      data: {
        filename:     file.filename,
        originalName: file.originalname,
        mimeType:     file.mimetype,
        sizeBytes:    file.size,
        url,
        uploadedById: req.user.id,
      },
    });
    out.push(m);
  }
  res.json({ uploaded: out, rejected });
});

mediaRouter.get('/', requirePermission('media.view'), async (req, res) => {
  const take = Math.min(parseInt(req.query.limit ?? '100', 10), 200);
  const items = await prisma.media.findMany({
    orderBy: { createdAt: 'desc' },
    take,
  });
  res.json({ items });
});

mediaRouter.delete('/:id', requirePermission('media.delete'), async (req, res) => {
  const m = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).json({ error: 'not_found' });
  // Best-effort file deletion — DB row is the source of truth for the UI.
  const diskPath = path.join(process.cwd(), 'public', m.url.replace(/^\//, ''));
  await fs.unlink(diskPath).catch(() => {});
  await prisma.media.delete({ where: { id: m.id } });
  res.json({ ok: true });
});

import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { uploadToStorage, deleteFromStorage, isStorageAvailable, BUCKET } from '../lib/storage.js';

export const mediaRouter = express.Router();

const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const MAX_BYTES_IMAGE = 5  * 1024 * 1024;   // 5 MB
const MAX_BYTES_VIDEO = 100 * 1024 * 1024;  // 100 MB

// Buffer files in memory. Supabase Storage upload streams from the buffer;
// local-dev fallback writes to disk from the buffer. Serverless-safe.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES_VIDEO },
  fileFilter: (_req, file, cb) => {
    const isImg = ALLOWED_IMAGE.has(file.mimetype);
    const isVid = ALLOWED_VIDEO.has(file.mimetype);
    if (!isImg && !isVid) return cb(Object.assign(new Error('unsupported_type'), { http: 415 }));
    cb(null, true);
  },
});

function pathForFile(filename) {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${filename}`;
}

async function persistToLocalDisk(buffer, relPath) {
  const abs = path.join(process.cwd(), 'public', 'uploads', relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return '/uploads/' + relPath;
}

mediaRouter.post('/', requirePermission('media.upload'), upload.array('files', 12), async (req, res) => {
  const useStorage = isStorageAvailable();
  const out = [];
  const rejected = [];

  for (const file of req.files ?? []) {
    const isImg = ALLOWED_IMAGE.has(file.mimetype);
    const cap = isImg ? MAX_BYTES_IMAGE : MAX_BYTES_VIDEO;
    if (file.size > cap) {
      rejected.push({ name: file.originalname, reason: 'file_too_large', limitMb: cap / 1024 / 1024 });
      continue;
    }

    // Random filename + preserve extension. Same convention as the old disk writer.
    const id = crypto.randomBytes(12).toString('hex');
    const ext = (path.extname(file.originalname).toLowerCase() || '.bin').replace(/[^a-z0-9.]/g, '');
    const filename = `${id}${ext}`;
    const relPath = pathForFile(filename);

    let publicUrl;
    try {
      publicUrl = useStorage
        ? await uploadToStorage({ buffer: file.buffer, path: relPath, contentType: file.mimetype })
        : await persistToLocalDisk(file.buffer, relPath);
    } catch (e) {
      console.error('[media/upload]', e);
      rejected.push({ name: file.originalname, reason: 'upload_failed', detail: e.message });
      continue;
    }

    const m = await prisma.media.create({
      data: {
        filename,
        originalName: file.originalname,
        mimeType:     file.mimetype,
        sizeBytes:    file.size,
        url:          publicUrl,
        uploadedById: req.user.id,
      },
    });
    out.push(m);
  }
  res.json({ uploaded: out, rejected, backend: useStorage ? 'supabase' : 'local' });
});

mediaRouter.get('/', requirePermission('media.view'), async (req, res) => {
  const take = Math.min(parseInt(req.query.limit ?? '100', 10), 200);
  const items = await prisma.media.findMany({ orderBy: { createdAt: 'desc' }, take });
  res.json({ items });
});

mediaRouter.delete('/:id', requirePermission('media.delete'), async (req, res) => {
  const m = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).json({ error: 'not_found' });

  // Route the delete to whichever backend the URL belongs to.
  const isRemote = m.url.includes(`/storage/v1/object/public/${BUCKET}/`);
  if (isRemote) {
    await deleteFromStorage(m.url);
  } else {
    // Legacy local file — best-effort disk delete. On Vercel this is a no-op
    // because the file lives in the read-only git-shipped bundle.
    const diskPath = path.join(process.cwd(), 'public', m.url.replace(/^\//, ''));
    await fs.unlink(diskPath).catch(() => {});
  }
  await prisma.media.delete({ where: { id: m.id } });
  res.json({ ok: true });
});

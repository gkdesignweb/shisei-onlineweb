import express from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const catalogRouter = express.Router();

// Per-endpoint granular checks (no router-wide gate).

// ----- Categories -----
const categorySchema = z.object({
  slug: z.string().min(1).optional(),
  nameZh: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  iconUrl: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
});

catalogRouter.get('/categories', requirePermission('catalog.view'), async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: true } } },
  });
  res.json({ categories });
});

catalogRouter.post('/categories', requirePermission('catalog.categories.edit'), async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const data = parsed.data;
  const slug = (data.slug || slugify(data.nameEn ?? data.nameZh, { lower: true, strict: true })) || `cat-${Date.now()}`;
  const category = await prisma.category.create({
    data: {
      slug, nameZh: data.nameZh, nameEn: data.nameEn ?? null,
      iconUrl: data.iconUrl ?? null, sortOrder: data.sortOrder,
    },
  });
  res.json({ category });
});

catalogRouter.put('/categories/:id', requirePermission('catalog.categories.edit'), async (req, res) => {
  const parsed = categorySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ category });
});

catalogRouter.delete('/categories/:id', requirePermission('catalog.categories.edit'), async (req, res) => {
  const count = await prisma.product.count({ where: { categoryId: req.params.id } });
  if (count > 0) return res.status(409).json({ error: 'category_has_products', count });
  await prisma.category.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ----- Products -----
const productSchema = z.object({
  sku: z.string().min(1),
  nameZh: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  descriptionZh: z.string().optional().nullable(),
  longDescriptionHtml: z.string().optional().nullable(),
  accordionsJson: z.string().default('[]'),
  videoUrl: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  images: z.string().default(''),
  categoryId: z.string().min(1),
  brandId: z.string().optional().nullable(),
  priceA: z.number().int().min(0),
  priceB: z.number().int().min(0),
  priceC: z.number().int().min(0).optional().nullable(),
  priceD: z.number().int().min(0).optional().nullable(),
  priceOriginal: z.number().int().min(0).optional().nullable(),
  priceBulk: z.number().int().min(0).optional().nullable(),
  bulkMinQty: z.number().int().min(0).optional().nullable(),
  labels: z.string().default(''),
  stock: z.number().int().min(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isGroupBuy: z.boolean().default(false),
  isMonthlySpecial: z.boolean().default(false),
  groupBuyTarget: z.number().int().min(0).optional().nullable(),
});

catalogRouter.get('/products', requirePermission('catalog.view'), async (req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { id: true, nameZh: true } },
      brand:    { select: { id: true, nameZh: true } },
      variants: { orderBy: { sortOrder: 'asc' } },
    },
  });
  res.json({ products });
});

// ----- CSV import / export -----

const CSV_COLUMNS = [
  'sku', 'nameZh', 'nameEn',
  'categorySlug', 'brandSlug',
  'descriptionZh',
  'priceA', 'priceB', 'priceC', 'priceD',
  'priceOriginal', 'priceBulk', 'bulkMinQty',
  'stock',
  'labels',         // pipe-separated: NEW|HOT|SALE
  'isActive', 'isFeatured', 'isGroupBuy', 'isMonthlySpecial',
  'imageUrl',
];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// RFC-4180-ish parser, handles quoted fields + embedded commas + escaped quotes.
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.length));
}

function parseBool(v, fallback = false) {
  if (v == null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 't';
}
function parseIntOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

catalogRouter.get('/products/export.csv', requirePermission('catalog.view'), async (_req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { slug: true } },
      brand:    { select: { slug: true } },
    },
  });
  const lines = [CSV_COLUMNS.join(',')];
  for (const p of products) {
    const row = {
      sku: p.sku, nameZh: p.nameZh, nameEn: p.nameEn,
      categorySlug: p.category?.slug || '',
      brandSlug: p.brand?.slug || '',
      descriptionZh: p.descriptionZh,
      priceA: p.priceA, priceB: p.priceB, priceC: p.priceC, priceD: p.priceD,
      priceOriginal: p.priceOriginal, priceBulk: p.priceBulk, bulkMinQty: p.bulkMinQty,
      stock: p.stock,
      labels: (p.labels || '').split(',').map((s) => s.trim()).filter(Boolean).join('|'),
      isActive: p.isActive ? 1 : 0,
      isFeatured: p.isFeatured ? 1 : 0,
      isGroupBuy: p.isGroupBuy ? 1 : 0,
      isMonthlySpecial: p.isMonthlySpecial ? 1 : 0,
      imageUrl: p.imageUrl,
    };
    lines.push(CSV_COLUMNS.map((k) => csvCell(row[k])).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="products-${new Date().toISOString().slice(0,10)}.csv"`);
  // BOM for Excel UTF-8.
  res.send('﻿' + lines.join('\n'));
});

// Accepts JSON { csv: "..." } so the browser FileReader can post text directly.
catalogRouter.post('/products/import',
  requirePermission('catalog.products.edit'),
  express.json({ limit: '5mb' }),
  async (req, res) => {
    const csvText = String(req.body?.csv || '');
    if (!csvText.trim()) return res.status(400).json({ error: 'empty_csv' });

    const rows = parseCSV(csvText);
    if (rows.length < 2) return res.status(400).json({ error: 'no_data_rows' });

    const header = rows[0].map((s) => s.trim());
    const required = ['sku', 'nameZh', 'categorySlug', 'priceA'];
    for (const r of required) {
      if (!header.includes(r)) return res.status(400).json({ error: 'missing_required_column', column: r });
    }

    // Build slug → id maps in one pass each (cheaper than per-row lookups).
    const [cats, brands] = await Promise.all([
      prisma.category.findMany({ select: { id: true, slug: true } }),
      prisma.brand.findMany({    select: { id: true, slug: true } }),
    ]);
    const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));
    const brandBySlug = new Map(brands.map((b) => [b.slug, b.id]));

    const results = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      const row = Object.fromEntries(header.map((h, idx) => [h, (cells[idx] ?? '').trim()]));
      const lineNo = i + 1; // human-readable: 1=header, data starts at 2

      try {
        if (!row.sku) throw new Error('missing sku');
        if (!row.nameZh) throw new Error('missing nameZh');

        const categoryId = catBySlug.get(row.categorySlug);
        if (!categoryId) throw new Error(`unknown categorySlug "${row.categorySlug}"`);

        let brandId = null;
        if (row.brandSlug) {
          brandId = brandBySlug.get(row.brandSlug);
          if (!brandId) throw new Error(`unknown brandSlug "${row.brandSlug}"`);
        }

        const priceA = parseIntOrNull(row.priceA);
        if (priceA == null) throw new Error('priceA must be a number');

        const labels = (row.labels || '')
          .split('|').map((s) => s.trim()).filter(Boolean).join(',');

        const data = {
          sku: row.sku,
          nameZh: row.nameZh,
          nameEn: row.nameEn || null,
          descriptionZh: row.descriptionZh || null,
          categoryId,
          brandId,
          priceA,
          priceB:        parseIntOrNull(row.priceB)        ?? priceA,
          priceC:        parseIntOrNull(row.priceC),
          priceD:        parseIntOrNull(row.priceD),
          priceOriginal: parseIntOrNull(row.priceOriginal),
          priceBulk:     parseIntOrNull(row.priceBulk),
          bulkMinQty:    parseIntOrNull(row.bulkMinQty),
          stock:         parseIntOrNull(row.stock) ?? 0,
          labels,
          isActive:         parseBool(row.isActive, true),
          isFeatured:       parseBool(row.isFeatured),
          isGroupBuy:       parseBool(row.isGroupBuy),
          isMonthlySpecial: parseBool(row.isMonthlySpecial),
          imageUrl:         row.imageUrl || null,
        };

        const existing = await prisma.product.findFirst({ where: { sku: data.sku }, select: { id: true } });
        if (existing) {
          await prisma.product.update({ where: { id: existing.id }, data });
          results.updated += 1;
        } else {
          await prisma.product.create({ data });
          results.created += 1;
        }
      } catch (e) {
        results.errors.push({ line: lineNo, sku: row.sku || '', error: e.message });
      }
    }

    res.json({ ok: results.errors.length === 0, ...results });
  }
);

// ----- Variants nested under product -----
const variantSchema = z.object({
  name: z.string().min(1),
  optionType: z.enum(['size', 'color', 'spec', 'option']).default('option'),
  sku: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  priceA: z.number().int().min(0).optional().nullable(),
  priceB: z.number().int().min(0).optional().nullable(),
  priceC: z.number().int().min(0).optional().nullable(),
  priceD: z.number().int().min(0).optional().nullable(),
  stock: z.number().int().min(0).default(0),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

catalogRouter.get('/products/:id/variants', requirePermission('catalog.view'), async (req, res) => {
  const variants = await prisma.productVariant.findMany({
    where: { productId: req.params.id },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ variants });
});

catalogRouter.post('/products/:id/variants', requirePermission('catalog.products.edit'), async (req, res) => {
  const parsed = variantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const v = await prisma.productVariant.create({
    data: { ...parsed.data, productId: req.params.id },
  });
  res.json({ variant: v });
});

catalogRouter.put('/variants/:id', requirePermission('catalog.products.edit'), async (req, res) => {
  const parsed = variantSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const v = await prisma.productVariant.update({ where: { id: req.params.id }, data: parsed.data });
  res.json({ variant: v });
});

catalogRouter.delete('/variants/:id', requirePermission('catalog.products.edit'), async (req, res) => {
  await prisma.productVariant.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

catalogRouter.post('/products', requirePermission('catalog.products.edit'), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  try {
    const product = await prisma.product.create({ data: parsed.data });
    res.json({ product });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'sku_exists' });
    throw e;
  }
});

catalogRouter.put('/products/:id', requirePermission('catalog.products.edit'), async (req, res) => {
  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ product });
});

catalogRouter.delete('/products/:id', requirePermission('catalog.products.edit'), async (req, res) => {
  // Soft delete: mark inactive — keeps order history intact.
  await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
});

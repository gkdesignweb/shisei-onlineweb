import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireVerifiedMember } from '../middleware/auth.js';
import { getTier, priceForTier } from '../lib/tiers.js';

export const cartRouter = express.Router();

cartRouter.use(requireVerifiedMember);

cartRouter.get('/', async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.id },
    include: { product: true, variant: true, bundle: true },
  });
  const tier = await getTier(req.user.tier);
  const detailed = items.map((it) => {
    if (it.bundle) {
      const unit = it.bundle.bundlePrice;
      return {
        id: it.id,
        bundleId: it.bundle.id,
        sku: 'BUNDLE-' + it.bundle.slug,
        nameZh: '【團購】' + it.bundle.nameZh,
        imageUrl: it.bundle.imageUrl,
        quantity: it.quantity,
        unitPrice: unit,
        lineTotal: unit * it.quantity,
        originalLineTotal: it.bundle.originalPrice * it.quantity,
      };
    }
    // Regular product line
    const overlay = it.variant ? {
      priceA: it.variant.priceA ?? it.product.priceA,
      priceB: it.variant.priceB ?? it.product.priceB,
      priceC: it.variant.priceC ?? it.product.priceC,
      priceD: it.variant.priceD ?? it.product.priceD,
    } : it.product;
    const unit = priceForTier(overlay, tier);
    return {
      id: it.id,
      productId: it.product.id,
      variantId: it.variant?.id ?? null,
      variantName: it.variant?.name ?? null,
      sku: it.product.sku,
      nameZh: it.product.nameZh,
      imageUrl: it.variant?.imageUrl ?? it.product.imageUrl,
      quantity: it.quantity,
      unitPrice: unit,
      lineTotal: unit * it.quantity,
    };
  });
  const subtotal = detailed.reduce((s, x) => s + x.lineTotal, 0);
  res.json({ items: detailed, subtotal, tier: tier ? { code: tier.code, nameZh: tier.nameZh } : null });
});

const upsertSchema = z.object({
  productId: z.string().optional().nullable(),
  variantId: z.string().optional().nullable(),
  bundleId:  z.string().optional().nullable(),
  quantity: z.number().int().min(1).max(999),
});

cartRouter.post('/', async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { productId, variantId, bundleId, quantity } = parsed.data;

  if (bundleId) {
    const bundle = await prisma.bundle.findUnique({ where: { id: bundleId } });
    if (!bundle || !bundle.isActive) return res.status(404).json({ error: 'bundle_not_found' });
    // findFirst+update/create instead of upsert to avoid Prisma 5 strict-null
    // semantics on the composite key (variantId/productId being null).
    const existing = await prisma.cartItem.findFirst({
      where: { userId: req.user.id, bundleId, productId: null, variantId: null },
    });
    if (existing) await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity } });
    else          await prisma.cartItem.create({ data: { userId: req.user.id, bundleId, quantity } });
    return res.json({ ok: true });
  }

  if (!productId) return res.status(400).json({ error: 'productId_or_bundleId_required' });
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: true },
  });
  if (!product || !product.isActive) return res.status(404).json({ error: 'product_not_found' });
  if (product.variants.length > 0 && !variantId) {
    return res.status(400).json({ error: 'variant_required' });
  }
  if (variantId && !product.variants.find((v) => v.id === variantId)) {
    return res.status(400).json({ error: 'invalid_variant' });
  }

  const existing = await prisma.cartItem.findFirst({
    where: {
      userId: req.user.id, productId,
      variantId: variantId ?? null, bundleId: null,
    },
  });
  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity } });
  } else {
    const data = { userId: req.user.id, productId, quantity };
    if (variantId) data.variantId = variantId;
    await prisma.cartItem.create({ data });
  }
  res.json({ ok: true });
});

cartRouter.delete('/:id', async (req, res) => {
  await prisma.cartItem.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  res.json({ ok: true });
});

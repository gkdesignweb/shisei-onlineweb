import express from 'express';
import { prisma } from '../db.js';
import { requireVerifiedMember } from '../middleware/auth.js';

export const wishlistRouter = express.Router();

wishlistRouter.use(requireVerifiedMember);

wishlistRouter.get('/', async (req, res) => {
  const items = await prisma.wishlist.findMany({
    where: { userId: req.user.id },
    include: { product: { include: { category: true, brand: { select: { slug: true, nameZh: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    items: items.map((w) => ({
      id: w.id,
      product: {
        id: w.product.id, sku: w.product.sku, nameZh: w.product.nameZh,
        imageUrl: w.product.imageUrl,
        priceOriginal: w.product.priceOriginal ?? w.product.priceA,
        labels: (w.product.labels ?? '').split(',').filter(Boolean),
        category: { slug: w.product.category.slug, nameZh: w.product.category.nameZh },
        brand: w.product.brand ? { slug: w.product.brand.slug, nameZh: w.product.brand.nameZh } : null,
      },
    })),
  });
});

wishlistRouter.post('/:productId', async (req, res) => {
  try {
    await prisma.wishlist.create({
      data: { userId: req.user.id, productId: req.params.productId },
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2002') return res.json({ ok: true }); // already saved
    throw e;
  }
});

wishlistRouter.delete('/:productId', async (req, res) => {
  await prisma.wishlist.deleteMany({
    where: { userId: req.user.id, productId: req.params.productId },
  });
  res.json({ ok: true });
});

import express from 'express';
import { prisma } from '../db.js';
import { getTier, priceForTier } from '../lib/tiers.js';

export const productsRouter = express.Router();

function parseLabels(s) {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

function parseImages(p) {
  const fromCsv = (p.images ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fromCsv.length) return fromCsv;
  return p.imageUrl ? [p.imageUrl] : [];
}

// 1. Optimized Product List with Pagination and Caching
productsRouter.get('/', async (req, res) => {
  // Cache this response for 60 seconds on Vercel's Edge Network.
  // This makes it feel "Instant" for users in Malaysia after the first load.
  res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');

  const { category, sort, label, featured, brand, q } = req.query;
  
  // PAGINATION: Only load 12 products at a time to save speed
  const limit = parseInt(req.query.limit) || 12;
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  const where = { isActive: true };
  if (category) where.category = { slug: String(category) };
  if (brand) {
    const slugs = String(brand).split(',').map((s) => s.trim()).filter(Boolean);
    where.brand = slugs.length > 1 ? { slug: { in: slugs } } : { slug: slugs[0] };
  }
  if (featured) where.isFeatured = true;
  if (q) {
    const term = String(q).trim();
    if (term) where.OR = [
      { sku:    { contains: term } },
      { nameZh: { contains: term } },
      { nameEn: { contains: term } },
    ];
  }

  let orderBy = { createdAt: 'desc' };
  if (sort === 'price_asc')  orderBy = { priceA: 'asc' };
  if (sort === 'price_desc') orderBy = { priceA: 'desc' };
  if (sort === 'newest')     orderBy = { createdAt: 'desc' };
  if (sort === 'stock')      orderBy = { stock: 'desc' };

  // Optimized query with take/skip
  let products = await prisma.product.findMany({
    where,
    include: {
      category: true,
      brand: { select: { id: true, slug: true, nameZh: true } },
      // Include active variants so the shop card can pop up a spec picker
      // when the user clicks 加入購物車 on a product that has options.
      variants: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, optionType: true, sku: true, imageUrl: true, stock: true,
                  priceA: true, priceB: true, priceC: true, priceD: true },
      },
    },
    orderBy,
    take: limit,
    skip: skip,
  });

  if (label) {
    const wanted = String(label).toUpperCase();
    products = products.filter((p) => parseLabels(p.labels).includes(wanted));
  }

  const verified = req.user?.verificationStatus === 'APPROVED';
  // Use Promise.all to fetch Tier and Data in parallel
  const tier = verified ? await getTier(req.user.tier) : null;

  res.json({
    verified,
    tier: tier ? { code: tier.code, nameZh: tier.nameZh } : null,
    products: products.map((p) => {
      const discountPrice = verified ? priceForTier(p, tier) : null;
      const images = parseImages(p);
      const variants = (p.variants || []).map((v) => ({
        id: v.id, name: v.name, optionType: v.optionType, sku: v.sku,
        imageUrl: v.imageUrl, stock: v.stock,
        priceDiscount: verified ? priceForTier({
          priceA: v.priceA ?? p.priceA, priceB: v.priceB ?? p.priceB,
          priceC: v.priceC ?? p.priceC, priceD: v.priceD ?? p.priceD,
          priceOriginal: p.priceOriginal,
        }, tier) : null,
      }));
      return {
        id: p.id,
        sku: p.sku,
        nameZh: p.nameZh,
        descriptionZh: p.descriptionZh,
        imageUrl: images[0] ?? p.imageUrl,
        images,
        stock: p.stock,
        labels: parseLabels(p.labels),
        isFeatured: p.isFeatured,
        isGroupBuy: p.isGroupBuy,
        isMonthlySpecial: p.isMonthlySpecial,
        groupBuyTarget: p.groupBuyTarget,
        groupBuyCurrent: p.groupBuyCurrent,
        category: { slug: p.category.slug, nameZh: p.category.nameZh },
        brand: p.brand ? { slug: p.brand.slug, nameZh: p.brand.nameZh } : null,
        priceOriginal: p.priceOriginal ?? p.priceA,
        priceBulk:     p.priceBulk,
        bulkMinQty:    p.bulkMinQty,
        priceDiscount: discountPrice,
        price: discountPrice,
        prices: { A: p.priceA, B: p.priceB, C: p.priceC, D: p.priceD },
        variants,
      };
    }),
  });
});

// 2. Optimized Detail view (added caching)
productsRouter.get('/sku/:sku', async (req, res) => {
  res.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5');

  // Accept either product id (immutable) or sku (mutable). Try id first so
  // freshly-renamed products don't 404 on /products/:id links.
  const key = String(req.params.sku);
  const p = await prisma.product.findFirst({
    where: { OR: [{ id: key }, { sku: key }, { sku: key.toUpperCase() }], isActive: true },
    include: {
      category: true,
      brand: true,
      variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!p) return res.status(404).json({ error: 'not_found' });
  
  const verified = req.user?.verificationStatus === 'APPROVED';
  const tierPromise = verified ? getTier(req.user.tier) : Promise.resolve(null);
  
  // Parallel check for Wishlist and Tier
  const [tier, wishlistEntry] = await Promise.all([
    tierPromise,
    verified ? prisma.wishlist.findUnique({
      where: { userId_productId: { userId: req.user.id, productId: p.id } },
    }).catch(() => null) : Promise.resolve(null)
  ]);

  const images = parseImages(p);
  const discountPrice = verified ? priceForTier(p, tier) : null;

  let accordions = [];
  try { accordions = JSON.parse(p.accordionsJson || '[]'); } catch { accordions = []; }

  const variants = p.variants.map((v) => {
    const overlay = {
      priceA: v.priceA ?? p.priceA,
      priceB: v.priceB ?? p.priceB,
      priceC: v.priceC ?? p.priceC,
      priceD: v.priceD ?? p.priceD,
    };
    return {
      id: v.id, name: v.name, optionType: v.optionType, sku: v.sku,
      imageUrl: v.imageUrl, stock: v.stock,
      priceDiscount: verified ? priceForTier({ ...overlay, priceOriginal: p.priceOriginal }, tier) : null,
    };
  });

  res.json({
    verified,
    tier: tier ? { code: tier.code, nameZh: tier.nameZh } : null,
    product: {
      id: p.id, sku: p.sku, nameZh: p.nameZh,
      descriptionZh: p.descriptionZh,
      longDescriptionHtml: p.longDescriptionHtml,
      videoUrl: p.videoUrl,
      accordions,
      imageUrl: images[0] ?? p.imageUrl, images,
      labels: parseLabels(p.labels), stock: p.stock,
      category: { slug: p.category.slug, nameZh: p.category.nameZh },
      brand: p.brand ? { slug: p.brand.slug, nameZh: p.brand.nameZh, logoUrl: p.brand.logoUrl } : null,
      priceOriginal: p.priceOriginal ?? p.priceA,
      priceBulk: p.priceBulk, bulkMinQty: p.bulkMinQty,
      priceDiscount: discountPrice,
      variants,
      inWishlist: !!wishlistEntry,
    },
  });
});

productsRouter.get('/categories', async (req, res) => {
  // Categories change very rarely, cache them for 1 hour
  res.set('Cache-Control', 'public, s-maxage=3600');
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json({ categories });
});
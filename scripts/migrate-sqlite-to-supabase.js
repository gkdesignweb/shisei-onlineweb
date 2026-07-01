// One-shot migration: SQLite (prisma/dev.db) → Supabase (current Prisma client).
//
// Strategy: walks each table in FK-dependency order, upserts by natural key
// when one exists, and builds id-maps so child rows resolve to the new
// Supabase parent IDs. Skips ephemeral (CartItem) and noisy (AuditLog) data.
import Database from 'better-sqlite3';
import { prisma } from '../src/db.js';

const sqlite = new Database('./prisma/dev.db', { readonly: true });
const ALL = (sql, params = []) => sqlite.prepare(sql).all(...params);

const maps = {
  staffRole: new Map(),
  category:  new Map(),
  brand:     new Map(),
  user:      new Map(),
  product:   new Map(),
  variant:   new Map(),
  bundle:    new Map(),
  heroBanner:new Map(),
  template:  new Map(),
  page:      new Map(),
  voucher:   new Map(),
  tier:      new Map(),
  order:     new Map(),
};

let totals = {};
const tally = (k, n = 1) => { totals[k] = (totals[k] || 0) + n; };

function clean(row, drop = []) {
  // Strip foreign-key id columns the caller will replace, plus the SQLite id
  // (we let Prisma generate fresh cuids in Supabase to dodge collisions).
  const out = { ...row };
  for (const k of [...drop, 'id']) delete out[k];
  // SQLite stores booleans as 0/1; Postgres expects real bool. Exhaustive
  // list of every boolean column across the schema — more reliable than a
  // regex when columns like `handled` don't fit the is/can/has prefix.
  const BOOL_COLS = new Set([
    'isSuperAdmin', 'isActive', 'canMonthlyPay', 'isSystem',
    'isFeatured', 'handled', 'isPublished', 'bannerEnabled',
    'isDefault', 'isSecret',
  ]);
  for (const k of Object.keys(out)) {
    if (BOOL_COLS.has(k) && (out[k] === 0 || out[k] === 1)) out[k] = out[k] === 1;
  }
  // SQLite stores Prisma DateTime as epoch ms (Int) — sometimes as ISO string.
  // Postgres wants real Date. Convert any *At / *From / *Until / *Date column
  // that contains a numeric epoch or an ISO-8601 string.
  for (const [k, v] of Object.entries(out)) {
    if (v == null) continue;
    if (!/(At|From|Until|Date)$/.test(k)) continue;
    if (v instanceof Date) continue;
    if (typeof v === 'number') {
      // SQLite returns ms-precision epoch ints from Prisma datetime columns.
      out[k] = new Date(v);
    } else if (typeof v === 'bigint') {
      out[k] = new Date(Number(v));
    } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      out[k] = new Date(v);
    } else if (typeof v === 'string' && /^\d{10,13}$/.test(v)) {
      out[k] = new Date(parseInt(v, 10));
    }
  }
  return out;
}

async function migrate() {
  console.log('Reading SQLite → upserting into Supabase\n');

  // 1. StaffRole (name unique)
  for (const r of ALL('SELECT * FROM StaffRole')) {
    const data = clean(r);
    const row = await prisma.staffRole.upsert({
      where: { name: r.name },
      update: { permissions: data.permissions, description: data.description },
      create: data,
    });
    maps.staffRole.set(r.id, row.id); tally('StaffRole');
  }

  // 2. Tier (code unique)
  for (const r of ALL('SELECT * FROM Tier')) {
    const data = clean(r);
    const row = await prisma.tier.upsert({
      where: { code: r.code }, update: data, create: data,
    });
    maps.tier.set(r.id, row.id); tally('Tier');
  }

  // 3. Category (slug unique)
  for (const r of ALL('SELECT * FROM Category')) {
    const data = clean(r);
    const row = await prisma.category.upsert({
      where: { slug: r.slug }, update: data, create: data,
    });
    maps.category.set(r.id, row.id); tally('Category');
  }

  // 4. Brand (slug unique)
  for (const r of ALL('SELECT * FROM Brand')) {
    const data = clean(r);
    const row = await prisma.brand.upsert({
      where: { slug: r.slug }, update: data, create: data,
    });
    maps.brand.set(r.id, row.id); tally('Brand');
  }

  // 5. User (email unique) — FK to StaffRole
  for (const r of ALL('SELECT * FROM User')) {
    const data = clean(r, ['staffRoleId']);
    if (r.staffRoleId) data.staffRoleId = maps.staffRole.get(r.staffRoleId) ?? null;
    const row = await prisma.user.upsert({
      where: { email: r.email }, update: data, create: data,
    });
    maps.user.set(r.id, row.id); tally('User');
  }

  // 6. Product (sku unique) — FK to Category, Brand
  for (const r of ALL('SELECT * FROM Product')) {
    const data = clean(r, ['categoryId', 'brandId']);
    data.categoryId = maps.category.get(r.categoryId);
    if (!data.categoryId) { console.warn('  skip Product', r.sku, '(category missing)'); continue; }
    if (r.brandId) data.brandId = maps.brand.get(r.brandId) ?? null;
    const row = await prisma.product.upsert({
      where: { sku: r.sku }, update: data, create: data,
    });
    maps.product.set(r.id, row.id); tally('Product');
  }

  // 7. ProductVariant — FK to Product, no natural key. We dedupe by (productId, name).
  for (const r of ALL('SELECT * FROM ProductVariant')) {
    const productId = maps.product.get(r.productId);
    if (!productId) continue;
    const data = clean(r, ['productId']);
    data.productId = productId;
    const existing = await prisma.productVariant.findFirst({ where: { productId, name: r.name } });
    const row = existing
      ? await prisma.productVariant.update({ where: { id: existing.id }, data })
      : await prisma.productVariant.create({ data });
    maps.variant.set(r.id, row.id); tally('ProductVariant');
  }

  // 8. Bundle (slug unique)
  for (const r of ALL('SELECT * FROM Bundle')) {
    const data = clean(r);
    const row = await prisma.bundle.upsert({
      where: { slug: r.slug }, update: data, create: data,
    });
    maps.bundle.set(r.id, row.id); tally('Bundle');
  }

  // 9. BundleItem — FK to Bundle, Product. No natural key; create fresh.
  for (const r of ALL('SELECT * FROM BundleItem')) {
    const bundleId = maps.bundle.get(r.bundleId);
    const productId = maps.product.get(r.productId);
    if (!bundleId || !productId) continue;
    const existing = await prisma.bundleItem.findFirst({ where: { bundleId, productId } });
    if (existing) {
      await prisma.bundleItem.update({ where: { id: existing.id }, data: { quantity: r.quantity } });
    } else {
      await prisma.bundleItem.create({ data: { bundleId, productId, quantity: r.quantity } });
    }
    tally('BundleItem');
  }

  // 10. HeroBanner — dedupe by imageUrl + placement.
  for (const r of ALL('SELECT * FROM HeroBanner')) {
    const data = clean(r);
    const existing = await prisma.heroBanner.findFirst({ where: { imageUrl: r.imageUrl, placement: r.placement || 'CAROUSEL' } });
    const row = existing
      ? await prisma.heroBanner.update({ where: { id: existing.id }, data })
      : await prisma.heroBanner.create({ data });
    maps.heroBanner.set(r.id, row.id); tally('HeroBanner');
  }

  // 11. PageTemplate — dedupe by (type, name)
  for (const r of ALL('SELECT * FROM PageTemplate')) {
    const data = clean(r);
    const existing = await prisma.pageTemplate.findFirst({ where: { type: r.type, name: r.name } });
    const row = existing
      ? await prisma.pageTemplate.update({ where: { id: existing.id }, data })
      : await prisma.pageTemplate.create({ data });
    maps.template.set(r.id, row.id); tally('PageTemplate');
  }

  // 12. Page (slug unique) — FK to HeroBanner, PageTemplate
  for (const r of ALL('SELECT * FROM Page')) {
    const data = clean(r, ['headBannerId', 'footBannerId', 'headerTemplateId', 'footerTemplateId']);
    if (r.headBannerId)     data.headBannerId     = maps.heroBanner.get(r.headBannerId) ?? null;
    if (r.footBannerId)     data.footBannerId     = maps.heroBanner.get(r.footBannerId) ?? null;
    if (r.headerTemplateId) data.headerTemplateId = maps.template.get(r.headerTemplateId) ?? null;
    if (r.footerTemplateId) data.footerTemplateId = maps.template.get(r.footerTemplateId) ?? null;
    const row = await prisma.page.upsert({
      where: { slug: r.slug }, update: data, create: data,
    });
    maps.page.set(r.id, row.id); tally('Page');
  }

  // 13. PageBlock — FK to Page. Drop & re-insert per page to preserve order.
  for (const r of ALL('SELECT * FROM PageBlock')) {
    const pageId = maps.page.get(r.pageId);
    if (!pageId) continue;
    const data = clean(r, ['pageId']); data.pageId = pageId;
    await prisma.pageBlock.create({ data });
    tally('PageBlock');
  }

  // 14. NavItem — dedupe by (href, location)
  for (const r of ALL('SELECT * FROM NavItem')) {
    const data = clean(r);
    const existing = await prisma.navItem.findFirst({ where: { href: r.href, location: r.location || 'MAIN' } });
    if (existing) {
      await prisma.navItem.update({ where: { id: existing.id }, data });
    } else {
      await prisma.navItem.create({ data });
    }
    tally('NavItem');
  }

  // 15. ContentBlock (key unique)
  for (const r of ALL('SELECT * FROM ContentBlock')) {
    const data = clean(r);
    await prisma.contentBlock.upsert({
      where: { key: r.key }, update: data, create: data,
    });
    tally('ContentBlock');
  }

  // 16. Voucher (code unique)
  for (const r of ALL('SELECT * FROM Voucher')) {
    const data = clean(r);
    const row = await prisma.voucher.upsert({
      where: { code: r.code }, update: data, create: data,
    });
    maps.voucher.set(r.id, row.id); tally('Voucher');
  }

  // 17. TierVoucher (tierId+voucherId unique)
  for (const r of ALL('SELECT * FROM TierVoucher')) {
    const tierId = maps.tier.get(r.tierId);
    const voucherId = maps.voucher.get(r.voucherId);
    if (!tierId || !voucherId) continue;
    await prisma.tierVoucher.upsert({
      where: { tierId_voucherId: { tierId, voucherId } },
      update: {}, create: { tierId, voucherId },
    });
    tally('TierVoucher');
  }

  // 18. Setting (key unique)
  for (const r of ALL('SELECT * FROM Setting')) {
    // Don't overwrite DB connection strings — they're correct in Supabase already.
    if (['DATABASE_URL', 'DIRECT_URL'].includes(r.key)) continue;
    const data = clean(r);
    await prisma.setting.upsert({
      where: { key: r.key }, update: data, create: data,
    });
    tally('Setting');
  }

  // 19. Media — copy by id; filename unique
  for (const r of ALL('SELECT * FROM Media')) {
    const data = clean(r, ['uploadedById']);
    if (r.uploadedById) data.uploadedById = maps.user.get(r.uploadedById) ?? null;
    const existing = await prisma.media.findUnique({ where: { filename: r.filename } });
    if (existing) {
      await prisma.media.update({ where: { id: existing.id }, data });
    } else {
      await prisma.media.create({ data });
    }
    tally('Media');
  }

  // 20. Order (merchantTradeNo unique) — FK to User
  for (const r of ALL('SELECT * FROM "Order"')) {
    const userId = maps.user.get(r.userId);
    if (!userId) continue;
    const data = clean(r, ['userId']); data.userId = userId;
    const row = await prisma.order.upsert({
      where: { merchantTradeNo: r.merchantTradeNo }, update: data, create: data,
    });
    maps.order.set(r.id, row.id); tally('Order');
  }

  // 21. OrderItem — FK to Order, Product, Variant, Bundle
  for (const r of ALL('SELECT * FROM OrderItem')) {
    const orderId = maps.order.get(r.orderId);
    if (!orderId) continue;
    const data = clean(r, ['orderId', 'productId', 'variantId', 'bundleId']);
    data.orderId = orderId;
    if (r.productId) data.productId = maps.product.get(r.productId) ?? null;
    if (r.variantId) data.variantId = maps.variant.get(r.variantId) ?? null;
    if (r.bundleId)  data.bundleId  = maps.bundle.get(r.bundleId) ?? null;
    // Skip if this orderItem was already migrated (idempotent by SKU + orderId).
    const existing = await prisma.orderItem.findFirst({ where: { orderId, sku: r.sku, quantity: r.quantity } });
    if (existing) continue;
    await prisma.orderItem.create({ data });
    tally('OrderItem');
  }

  // 22. Wishlist (userId+productId unique)
  for (const r of ALL('SELECT * FROM Wishlist')) {
    const userId = maps.user.get(r.userId);
    const productId = maps.product.get(r.productId);
    if (!userId || !productId) continue;
    await prisma.wishlist.upsert({
      where: { userId_productId: { userId, productId } },
      update: {}, create: { userId, productId },
    });
    tally('Wishlist');
  }

  // 23. Lead — no dedupe key; create.
  for (const r of ALL('SELECT * FROM Lead')) {
    const data = clean(r, ['handledById']);
    if (r.handledById) data.handledById = maps.user.get(r.handledById) ?? null;
    await prisma.lead.create({ data });
    tally('Lead');
  }

  // Skipped on purpose: CartItem (ephemeral), AuditLog (test noise).
  console.log('\nMigrated counts:');
  for (const [k, v] of Object.entries(totals)) console.log(' ', k.padEnd(18), v);
}

migrate()
  .catch((e) => { console.error('Migration failed:', e); process.exit(1); })
  .finally(() => { sqlite.close(); process.exit(0); });

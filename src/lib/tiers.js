import { prisma } from '../db.js';

// Tiers change rarely; cache in-memory and bust on admin write.
let cache = null;
async function loadAll() {
  if (cache) return cache;
  const rows = await prisma.tier.findMany({ orderBy: { sortOrder: 'asc' } });
  cache = new Map(rows.map((t) => [t.code, t]));
  return cache;
}
export function bustTierCache() { cache = null; }

export async function getTier(code) {
  const m = await loadAll();
  return m.get(code) ?? m.get('BRONZE') ?? null;
}

export async function listTiers() {
  const m = await loadAll();
  return [...m.values()];
}

// Resolve unit price for one product given a tier record.
// Supports priceField A/B/C/D — falls back to priceA when the chosen column is null.
export function priceForTier(product, tier) {
  if (!tier) return product.priceA;
  const field = tier.priceField ?? 'A';
  const base = (field === 'D' && product.priceD != null) ? product.priceD
             : (field === 'C' && product.priceC != null) ? product.priceC
             : (field === 'B') ? product.priceB
             : product.priceA;
  if (!tier.discountPercent) return base;
  return Math.round(base * (1 - tier.discountPercent / 100));
}

export function shippingFeeForTier(subtotal, tier) {
  const threshold = tier?.freeShippingThreshold ?? 3000;
  return subtotal >= threshold ? 0 : 120;
}

// Region-aware fee: region rules win over tier (different shipping cost zones).
// Free-ship threshold = max(region.freeAtAmount, tier.freeShippingThreshold)
// so a strict tier rule isn't accidentally loosened by an easier region.
export function shippingFeeForRegion(subtotal, region, tier) {
  if (!region) return shippingFeeForTier(subtotal, tier);
  const regionThreshold = region.freeAtAmount ?? 3000;
  const tierThreshold   = tier?.freeShippingThreshold ?? 0;
  const threshold = Math.max(regionThreshold, tierThreshold);
  return subtotal >= threshold ? 0 : (region.shippingFee ?? 120);
}

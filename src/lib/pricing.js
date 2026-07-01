// Single source of truth for tier→price lookup.
export function priceFor(product, tier) {
  return tier === 'GOLD' ? product.priceB : product.priceA;
}

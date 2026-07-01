import { prisma } from '../db.js';

// Returns { ok, voucher, discount, message }. discount is the TWD amount
// to subtract from subtotal. Pass userTierCode to enforce tier eligibility
// and userId to enforce monthlyPerMember.
export async function evaluateVoucher(code, subtotal, userTierCode = null, userId = null) {
  if (!code) return { ok: false, message: 'missing_code' };
  const v = await prisma.voucher.findUnique({
    where: { code: code.toUpperCase() },
    include: { tierLinks: { include: { tier: true } } },
  });
  if (!v || !v.isActive) return { ok: false, message: '優惠碼無效' };

  // Tier gate: if any tierLinks exist, voucher is restricted to those tiers.
  if (v.tierLinks.length > 0) {
    const allowed = v.tierLinks.map((l) => l.tier.code);
    if (!userTierCode || !allowed.includes(userTierCode)) {
      return { ok: false, message: `此優惠碼僅限 ${allowed.join(' / ')} 會員使用` };
    }
  }

  const now = new Date();
  if (v.validFrom  && v.validFrom  > now) return { ok: false, message: '優惠碼尚未開始' };
  if (v.validUntil && v.validUntil < now) return { ok: false, message: '優惠碼已過期' };
  if (v.usageLimit != null && v.usedCount >= v.usageLimit) {
    return { ok: false, message: '優惠碼已達使用上限' };
  }
  if (subtotal < v.minOrderAmount) {
    return { ok: false, message: `訂單需滿 NT$ ${v.minOrderAmount} 才能使用此優惠碼` };
  }

  // Per-user monthly cap: count orders this month with this voucher code
  if (v.monthlyPerMember != null && userId) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const used = await prisma.order.count({
      where: {
        userId,
        voucherCode: v.code,
        createdAt: { gte: monthStart },
      },
    });
    if (used >= v.monthlyPerMember) {
      return { ok: false, message: `此優惠碼每位會員每月限用 ${v.monthlyPerMember} 次，本月已達上限` };
    }
  }

  let discount = 0;
  if (v.type === 'PERCENT') discount = Math.floor(subtotal * (v.value / 100));
  else                       discount = v.value;
  discount = Math.min(discount, subtotal);

  return { ok: true, voucher: v, discount, message: `折抵 NT$ ${discount}` };
}

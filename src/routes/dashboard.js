import express from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const dashboardRouter = express.Router();

// One round-trip for the home screen. The boss opens this daily, so payload
// stays modest (top-N lists capped at 10 each) and queries lean on indexes
// that already exist (Order.userId / OrderItem.productId / Product.stock).
dashboardRouter.get('/', requirePermission('orders.view'), async (req, res) => {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearStart      = new Date(now.getFullYear(), 0, 1);
  const last30Start    = new Date(Date.now() - 30 * 86400_000);
  const abandonedCutoff= new Date(Date.now() - 24 * 3600_000); // items in cart > 24h
  const LOW_STOCK = 10;

  // Average-spend-per-order trend over the last 30 days, bucketed by day.
  // Computed in app code so we stay vendor-agnostic (no date_trunc dialect issues).
  const dailyOrders = await prisma.order.findMany({
    where: { createdAt: { gte: last30Start }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } },
    select: { createdAt: true, total: true, userId: true },
  });
  const dayKey = (d) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  };
  const daily = new Map();
  for (const o of dailyOrders) {
    const k = dayKey(o.createdAt);
    const cur = daily.get(k) || { sum: 0, count: 0 };
    cur.sum += o.total; cur.count += 1;
    daily.set(k, cur);
  }
  const avgSpendSeries = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const k = dayKey(d);
    const row = daily.get(k);
    avgSpendSeries.push({
      date: k,
      avg: row ? Math.round(row.sum / row.count) : 0,
      orders: row?.count || 0,
    });
  }

  // Top-10 spending customers — current month and current year.
  const sumByUser = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.userId, (m.get(r.userId) || 0) + r.total);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  };
  const monthOrders = dailyOrders.filter((o) => o.createdAt >= thisMonthStart);
  const yearOrdersRows = await prisma.order.findMany({
    where: { createdAt: { gte: yearStart }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } },
    select: { userId: true, total: true },
  });
  const topMonth = sumByUser(monthOrders);
  const topYear  = sumByUser(yearOrdersRows);
  const userIds = [...new Set([...topMonth.map(([id]) => id), ...topYear.map(([id]) => id)])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id:true, name:true, clinicName:true } })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const decorate = (pairs) => pairs.map(([id, total]) => ({
    userId: id, total,
    name: userMap[id]?.clinicName || userMap[id]?.name || '已刪除會員',
  }));
  const topCustomersMonth = decorate(topMonth);
  const topCustomersYear  = decorate(topYear);

  const [thisMonthOrders, lastMonthOrders, pendingPayCount, pendingMemberCount,
         shippedThisMonth, last30Items, lowStockProducts, abandonedCartUsers, recentOrders] =
    await Promise.all([
      // This-month revenue (only count PAID/SHIPPED/COMPLETED)
      prisma.order.aggregate({
        where: { createdAt: { gte: thisMonthStart }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } },
        _sum:  { total: true },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: lastMonthStart, lt: thisMonthStart }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } },
        _sum:  { total: true },
        _count: { _all: true },
      }),
      prisma.order.count({ where: { status: 'PENDING_PAYMENT' } }),
      prisma.user.count({  where: { verificationStatus: 'PENDING', role: 'MEMBER' } }),
      prisma.order.count({ where: { createdAt: { gte: thisMonthStart }, status: 'SHIPPED' } }),
      // Top SKUs by qty (last 30 days, paid+)
      prisma.orderItem.groupBy({
        by: ['sku', 'nameZh'],
        where: { order: { createdAt: { gte: last30Start }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      prisma.product.findMany({
        where: { isActive: true, stock: { lte: LOW_STOCK } },
        orderBy: { stock: 'asc' },
        take: 10,
        select: { id: true, sku: true, nameZh: true, stock: true, imageUrl: true },
      }),
      // Abandoned: distinct users with cart items older than cutoff
      prisma.cartItem.findMany({
        where: { createdAt: { lt: abandonedCutoff } },
        distinct: ['userId'],
        select: { userId: true, user: { select: { name: true, clinicName: true, email: true } } },
        take: 10,
      }),
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, merchantTradeNo: true, status: true, total: true, createdAt: true,
          user: { select: { name: true, clinicName: true } },
        },
      }),
    ]);

  const revenueThis = thisMonthOrders._sum.total || 0;
  const revenueLast = lastMonthOrders._sum.total || 0;
  const revenueDelta = revenueLast > 0 ? ((revenueThis - revenueLast) / revenueLast) * 100 : null;

  res.json({
    revenue: {
      thisMonth: revenueThis,
      lastMonth: revenueLast,
      deltaPct:  revenueDelta,
    },
    orderCounts: {
      thisMonth: thisMonthOrders._count._all || 0,
      lastMonth: lastMonthOrders._count._all || 0,
      pendingPayment: pendingPayCount,
      shippedThisMonth,
    },
    pendingMembers: pendingMemberCount,
    topSkus: last30Items.map((r) => ({
      sku: r.sku, nameZh: r.nameZh,
      qty: r._sum.quantity || 0,
      revenue: r._sum.lineTotal || 0,
    })),
    lowStock: lowStockProducts,
    abandonedCarts: abandonedCartUsers,
    recentOrders,
    avgSpendSeries,
    topCustomersMonth,
    topCustomersYear,
  });
});

// Per-member analytics: monthly/yearly spend + product breakdown ratio.
// Used by /admin-customer-detail.html (drill-down from /admin-customers.html).
dashboardRouter.get('/customer/:id', requirePermission('members.view'), async (req, res) => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id:true, name:true, email:true, clinicName:true, tier:true, verificationStatus:true, createdAt:true },
  });
  if (!user) return res.status(404).json({ error: 'not_found' });

  // Orders from the last 13 months for monthly trend; year totals.
  const start13 = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const orders = await prisma.order.findMany({
    where: { userId: req.params.id, createdAt: { gte: start13 }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } },
    select: { id:true, createdAt:true, total:true, items: { select: { nameZh:true, lineTotal:true, quantity:true } } },
  });
  const monthly = new Map();
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    monthly.set(k, { month: k, total: 0, orders: 0 });
  }
  for (const o of orders) {
    const k = `${o.createdAt.getFullYear()}-${String(o.createdAt.getMonth()+1).padStart(2,'0')}`;
    const row = monthly.get(k);
    if (row) { row.total += o.total; row.orders += 1; }
  }
  const monthlySeries = [...monthly.values()];

  // Yearly totals (this & last) + product breakdown (top 10 by qty).
  let thisYearTotal = 0, lastYearTotal = 0, allTimeTotal = 0;
  const productAgg = new Map();
  for (const o of orders) {
    allTimeTotal += o.total;
    if (o.createdAt >= yearStart) thisYearTotal += o.total;
    else if (o.createdAt >= lastYearStart) lastYearTotal += o.total;
    for (const it of o.items) {
      const cur = productAgg.get(it.nameZh) || { nameZh: it.nameZh, qty: 0, revenue: 0 };
      cur.qty += it.quantity; cur.revenue += it.lineTotal;
      productAgg.set(it.nameZh, cur);
    }
  }
  const productBreakdown = [...productAgg.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
  const productBreakdownTotal = productBreakdown.reduce((s, p) => s + p.revenue, 0);

  res.json({
    user,
    monthlySeries,
    yearTotals: { thisYear: thisYearTotal, lastYear: lastYearTotal, allTime: allTimeTotal },
    productBreakdown: productBreakdown.map((p) => ({
      ...p,
      ratioPct: productBreakdownTotal ? Math.round((p.revenue / productBreakdownTotal) * 1000) / 10 : 0,
    })),
  });
});

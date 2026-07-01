// Monthly statement (月結對帳單) — preview a single month's orders for a
// specific customer, render an HTML statement (printable). Bills using
// MONTHLY payment method are surfaced together with regular paid orders.
import express from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const statementsRouter = express.Router();

// List customers who placed a MONTHLY-billed order in the given year+month.
// Powers the customer dropdown on /admin-statements.html so the admin only
// sees relevant clinics for that month, not the entire member list.
statementsRouter.get('/customers', requirePermission('orders.view'), async (req, res) => {
  const ym = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'invalid_month' });
  const [y, m] = ym.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m,     1);
  const rows = await prisma.order.findMany({
    where: {
      paymentMethod: 'MONTHLY',
      createdAt: { gte: monthStart, lt: monthEnd },
      status: { in: ['PAID', 'SHIPPED', 'COMPLETED', 'DELIVERED'] },
    },
    distinct: ['userId'],
    select: { user: { select: { id:true, name:true, email:true, clinicName:true } } },
  });
  const customers = rows.map((r) => r.user).filter(Boolean);
  customers.sort((a, b) => (a.clinicName || a.name).localeCompare(b.clinicName || b.name, 'zh-Hant'));
  res.json({ customers });
});

// JSON preview: drives /admin-statements.html
statementsRouter.get('/preview', requirePermission('orders.view'), async (req, res) => {
  const userId = String(req.query.userId || '');
  const ym     = String(req.query.month || ''); // "YYYY-MM"
  if (!userId || !/^\d{4}-\d{2}$/.test(ym)) {
    return res.status(400).json({ error: 'invalid_input', hint: 'userId + month=YYYY-MM required' });
  }
  const [y, m] = ym.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m,     1);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id:true, name:true, email:true, clinicName:true, taxId:true, companyTitle:true, phone:true, clinicAddress:true },
  });
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const orders = await prisma.order.findMany({
    where: { userId, createdAt: { gte: monthStart, lt: monthEnd }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED', 'DELIVERED'] } },
    orderBy: { createdAt: 'asc' },
    include: { items: true },
  });

  const totalAmount = orders.reduce((s, o) => s + o.total, 0);
  const monthlyCount = orders.filter((o) => o.paymentMethod === 'MONTHLY').length;

  res.json({
    user, month: ym,
    summary: {
      orderCount: orders.length,
      monthlyBilledCount: monthlyCount,
      totalAmount,
    },
    orders: orders.map((o) => ({
      id: o.id,
      merchantTradeNo: o.merchantTradeNo,
      createdAt: o.createdAt,
      paymentMethod: o.paymentMethod,
      status: o.status,
      subtotal: o.subtotal, shippingFee: o.shippingFee,
      voucherCode: o.voucherCode, voucherDiscount: o.voucherDiscount,
      total: o.total,
      items: o.items.map((i) => ({
        nameZh: i.nameZh, sku: i.sku, variantName: i.variantName,
        quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal,
      })),
    })),
  });
});

// Printable HTML statement — opens in a new tab; admin can Cmd+P → save as PDF.
statementsRouter.get('/print', requirePermission('orders.view'), async (req, res) => {
  const userId = String(req.query.userId || '');
  const ym     = String(req.query.month || '');
  if (!userId || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).send('invalid input');
  const [y, m] = ym.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m,     1);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).send('user not found');

  const orders = await prisma.order.findMany({
    where: { userId, createdAt: { gte: monthStart, lt: monthEnd }, status: { in: ['PAID', 'SHIPPED', 'COMPLETED', 'DELIVERED'] } },
    orderBy: { createdAt: 'asc' },
    include: { items: true },
  });
  const total = orders.reduce((s, o) => s + o.total, 0);
  const fmt = (n) => 'NT$ ' + (n ?? 0).toLocaleString();
  const dt  = (d) => new Date(d).toLocaleDateString('zh-TW');
  const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

  const html = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"/>
    <title>月結對帳單 ${ym} · ${esc(user.clinicName || user.name)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
    <style>
      body { font-family:'Noto Sans TC',system-ui,sans-serif; color:#0f172a; margin:32px; }
      h1 { font-size:1.8rem; margin:0 0 4px; }
      .meta { display:flex; justify-content:space-between; flex-wrap:wrap; gap:24px; margin:16px 0 24px; padding:16px; background:#f8fafc; border-radius:12px; }
      .meta dt { color:#64748b; font-size:.8rem; }
      .meta dd { margin:2px 0 10px; font-weight:600; }
      table { width:100%; border-collapse:collapse; font-size:.9rem; margin-top:8px; }
      th, td { border:1px solid #e2e8f0; padding:8px 10px; text-align:left; }
      th { background:#f1f5f9; font-weight:700; }
      .right { text-align:right; }
      .order-head { background:#0f766e; color:#fff; padding:8px 12px; margin:24px 0 0; border-radius:8px 8px 0 0; display:flex; justify-content:space-between; }
      .summary { margin-top:32px; padding:16px; background:#ecfdf5; border:1px solid #d1fae5; border-radius:12px; text-align:right; font-size:1.1rem; }
      .summary strong { font-size:1.6rem; color:#0f766e; }
      @media print { body { margin:12mm; } .no-print { display:none; } }
      .no-print { text-align:center; margin-bottom:20px; }
      .no-print button { background:#0f766e; color:#fff; border:0; padding:10px 24px; border-radius:8px; font-weight:700; cursor:pointer; }
    </style>
  </head><body>
    <div class="no-print"><button onclick="window.print()">🖨 列印 / 另存為 PDF</button></div>
    <h1>月結對帳單</h1>
    <p style="color:#64748b">統計期間：${y}年 ${m}月（${dt(monthStart)} ~ ${dt(new Date(monthEnd.getTime()-1))}）</p>
    <div class="meta">
      <div>
        <dt>客戶</dt><dd>${esc(user.clinicName || user.name)}</dd>
        <dt>聯絡人</dt><dd>${esc(user.name)}</dd>
      </div>
      <div>
        <dt>聯絡電話</dt><dd>${esc(user.phone || '-')}</dd>
        <dt>Email</dt><dd>${esc(user.email)}</dd>
      </div>
      <div>
        <dt>統一編號</dt><dd>${esc(user.taxId || '-')}</dd>
        <dt>發票抬頭</dt><dd>${esc(user.companyTitle || user.clinicName || '-')}</dd>
      </div>
    </div>

    ${orders.length === 0 ? '<p style="text-align:center;color:#64748b;padding:40px;">此月份無付款訂單。</p>' : orders.map((o) => `
      <div class="order-head">
        <span><b>訂單 ${esc(o.merchantTradeNo)}</b> · ${dt(o.createdAt)} · ${esc(o.paymentMethod)}${o.status === 'SHIPPED' ? ' · 已出貨' : ''}</span>
        <span>${fmt(o.total)}</span>
      </div>
      <table>
        <thead><tr><th>商品</th><th>SKU</th><th class="right">單價</th><th class="right">數量</th><th class="right">小計</th></tr></thead>
        <tbody>${o.items.map((i) => `
          <tr><td>${esc(i.nameZh)}${i.variantName ? ` <span style="color:#64748b;font-size:.85em">(${esc(i.variantName)})</span>` : ''}</td>
              <td>${esc(i.sku)}</td>
              <td class="right">${fmt(i.unitPrice)}</td>
              <td class="right">${i.quantity}</td>
              <td class="right">${fmt(i.lineTotal)}</td></tr>`).join('')}
          ${o.voucherDiscount > 0 ? `<tr><td colspan="4" class="right" style="color:#0f766e">優惠折抵 (${esc(o.voucherCode || '')})</td><td class="right" style="color:#0f766e">- ${fmt(o.voucherDiscount)}</td></tr>` : ''}
          ${o.shippingFee > 0 ? `<tr><td colspan="4" class="right">運費</td><td class="right">${fmt(o.shippingFee)}</td></tr>` : ''}
        </tbody>
      </table>
    `).join('')}

    <div class="summary">
      ${y}年 ${m}月 共 ${orders.length} 筆訂單，總計 <strong>${fmt(total)}</strong>
    </div>
  </body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

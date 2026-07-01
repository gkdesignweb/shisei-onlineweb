// Daily picking list (提貨單). For a given date, aggregate all that day's
// active orders into:
//   - product totals (qty summed across orders, ready-to-pick from the warehouse)
//   - per-order line items (so the picker knows which order each box goes to)
// Both preview JSON, printable HTML, and CSV download are supported.
import express from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

export const pickingRouter = express.Router();

// Active orders to include: anything except cancelled / failed. PENDING_PAYMENT
// is intentionally excluded — those haven't been confirmed yet.
const ACTIVE_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];

function dayRange(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end   = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}

async function loadDay(dateStr) {
  const range = dayRange(dateStr);
  if (!range) return null;

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.start, lt: range.end },
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { name: true, clinicName: true, phone: true } },
      items: {
        include: {
          product: { select: { sku: true, nameZh: true, brand: { select: { nameZh: true } } } },
          variant: { select: { name: true, sku: true } },
        },
      },
    },
  });

  // Aggregate product totals across the day. Group key = productId+variantId
  // so each variant gets its own row (since the picker may grab different shelves).
  const totalsMap = new Map();
  for (const o of orders) {
    for (const it of o.items) {
      const key = `${it.productId}::${it.variantId ?? ''}`;
      const existing = totalsMap.get(key);
      if (existing) {
        existing.quantity += it.quantity;
        existing.orderCount += 1;
      } else {
        totalsMap.set(key, {
          productId: it.productId,
          variantId: it.variantId,
          sku: it.variant?.sku || it.product?.sku || '',
          nameZh: it.product?.nameZh || it.nameZhSnapshot || '',
          brandZh: it.product?.brand?.nameZh || '',
          variantName: it.variant?.name || '',
          quantity: it.quantity,
          orderCount: 1,
        });
      }
    }
  }
  const totals = Array.from(totalsMap.values())
    .sort((a, b) => (a.brandZh || '').localeCompare(b.brandZh || '', 'zh-Hant')
                 || a.nameZh.localeCompare(b.nameZh, 'zh-Hant'));

  const orderList = orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo || o.id.slice(-8).toUpperCase(),
    createdAt: o.createdAt,
    status: o.status,
    recipientName: o.recipientName,
    recipientPhone: o.recipientPhone,
    shippingAddress: o.shippingAddress,
    clinic: o.user?.clinicName || '',
    customerName: o.user?.name || '',
    items: o.items.map((it) => ({
      sku: it.variant?.sku || it.product?.sku || '',
      nameZh: it.product?.nameZh || it.nameZhSnapshot || '',
      variantName: it.variant?.name || '',
      quantity: it.quantity,
    })),
  }));

  return { date: dateStr, totals, orders: orderList };
}

// JSON for browser preview.
pickingRouter.get('/preview', requirePermission('orders.view'), async (req, res) => {
  const data = await loadDay(String(req.query.date || ''));
  if (!data) return res.status(400).json({ error: 'invalid_date', hint: 'date=YYYY-MM-DD required' });
  res.set('Cache-Control', 'no-store');
  res.json(data);
});

// Printable HTML — opens in a new tab, window.print() ready.
pickingRouter.get('/print', requirePermission('orders.view'), async (req, res) => {
  const data = await loadDay(String(req.query.date || ''));
  if (!data) return res.status(400).send('invalid date');

  const totalUnits = data.totals.reduce((s, t) => s + t.quantity, 0);
  const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) =>
    ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' })[c]);

  const totalsRows = data.totals.length
    ? data.totals.map((t, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="sku">${esc(t.sku)}</td>
          <td>${esc(t.brandZh)}</td>
          <td>${esc(t.nameZh)}${t.variantName ? ` <span class="vname">(${esc(t.variantName)})</span>` : ''}</td>
          <td class="num qty">${t.quantity}</td>
          <td class="num small">${t.orderCount}</td>
          <td class="check"></td>
        </tr>`).join('')
    : `<tr><td colspan="7" class="empty">當日無訂單</td></tr>`;

  const orderBlocks = data.orders.map((o) => `
    <section class="order">
      <div class="ohead">
        <div><span class="ono">#${esc(o.orderNo)}</span> <span class="otime">${new Date(o.createdAt).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' })}</span></div>
        <div class="oship">${esc(o.clinic || o.customerName)} · ${esc(o.recipientName)} · ${esc(o.recipientPhone)}</div>
        <div class="oaddr">${esc(o.shippingAddress || '')}</div>
      </div>
      <table class="otable">
        <thead><tr><th>SKU</th><th>商品</th><th class="num">數量</th><th class="check">✓</th></tr></thead>
        <tbody>
          ${o.items.map((it) => `
            <tr>
              <td class="sku">${esc(it.sku)}</td>
              <td>${esc(it.nameZh)}${it.variantName ? ` <span class="vname">(${esc(it.variantName)})</span>` : ''}</td>
              <td class="num qty">${it.quantity}</td>
              <td class="check"></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`).join('');

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<title>提貨單 ${esc(data.date)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans TC', system-ui, -apple-system, sans-serif; margin: 18mm; color: #0f172a; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color:#64748b; font-size: 12px; margin-bottom: 18px; }
  .meta b { color:#0f172a; }
  table { width:100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background:#f1f5f9; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .qty { font-weight: 700; }
  .check { width: 26px; text-align: center; }
  .small { color:#64748b; }
  .sku { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .vname { color:#7c3aed; font-size: 11px; }
  .empty { text-align:center; padding: 28px; color:#94a3b8; }

  h2.section { font-size:15px; margin: 24px 0 8px; border-left: 4px solid #0d9488; padding-left:10px; }

  section.order { margin-top: 14px; page-break-inside: avoid; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; }
  .ohead { background:#f8fafc; padding:8px 12px; border-bottom:1px solid #e2e8f0; }
  .ono { font-weight:800; font-size:13px; }
  .otime { color:#64748b; font-size:11px; margin-left:6px; }
  .oship { font-size:12px; color:#334155; margin-top:2px; }
  .oaddr { font-size:11px; color:#64748b; margin-top:2px; }
  .otable th, .otable td { border-color:#e2e8f0; }
  .otable thead th { background:#f8fafc; }

  .toolbar { text-align:center; margin-bottom: 16px; }
  .toolbar button { background:#0d9488; color:#fff; border:0; padding:10px 24px; border-radius:8px; font-weight:700; cursor:pointer; }

  @media print {
    body { margin: 12mm; }
    .toolbar { display:none; }
    section.order { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨 列印 / 另存為 PDF</button></div>

  <h1>提貨單 / Picking List</h1>
  <p class="meta">日期 <b>${esc(data.date)}</b> · 訂單數 <b>${data.orders.length}</b> · 商品品項 <b>${data.totals.length}</b> · 總件數 <b>${totalUnits}</b></p>

  <h2 class="section">當日提貨總表</h2>
  <table>
    <thead>
      <tr>
        <th class="num" style="width:34px">#</th>
        <th style="width:120px">SKU</th>
        <th style="width:90px">品牌</th>
        <th>商品名稱</th>
        <th class="num" style="width:60px">合計</th>
        <th class="num small" style="width:60px">訂單數</th>
        <th class="check">✓</th>
      </tr>
    </thead>
    <tbody>${totalsRows}</tbody>
  </table>

  <h2 class="section">逐單明細</h2>
  ${orderBlocks || '<p class="empty">當日無訂單</p>'}
</body>
</html>`);
});

// CSV — flat rows for spreadsheet import.
pickingRouter.get('/csv', requirePermission('orders.view'), async (req, res) => {
  const data = await loadDay(String(req.query.date || ''));
  if (!data) return res.status(400).send('invalid date');

  const lines = ['Section,OrderNo,SKU,Brand,Product,Variant,Quantity,Recipient,Clinic'];
  for (const t of data.totals) {
    lines.push(['TOTAL', '', t.sku, t.brandZh, t.nameZh, t.variantName, t.quantity, '', '']
      .map(csvCell).join(','));
  }
  for (const o of data.orders) {
    for (const it of o.items) {
      lines.push(['ORDER', o.orderNo, it.sku, '', it.nameZh, it.variantName, it.quantity, o.recipientName, o.clinic]
        .map(csvCell).join(','));
    }
  }
  // BOM so Excel opens UTF-8 correctly.
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="picking-${data.date}.csv"`);
  res.send('﻿' + lines.join('\n'));
});

function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

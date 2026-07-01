import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireVerifiedMember } from '../middleware/auth.js';
import { getTier, priceForTier, shippingFeeForTier, shippingFeeForRegion } from '../lib/tiers.js';
import { evaluateVoucher } from '../lib/voucher.js';
import {
  buildAioCheckoutForm,
  verifyCallback,
  decodePaymentType,
} from '../lib/ecpay.js';
import { issueInvoice } from '../lib/invoice.js';
import { notifyOrder } from '../lib/notify.js';

export const ordersRouter = express.Router();

// MerchantTradeNo format: YYYYMMDD + 4-digit per-day sequence (e.g. 202606140001).
// Within ECPay's 20-char alphanumeric constraint. If today has >= 9999 orders,
// falls back to a 5-digit sequence — still within the 20-char cap.
async function makeTradeNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const last = await prisma.order.findFirst({
    where: { merchantTradeNo: { startsWith: ymd } },
    orderBy: { merchantTradeNo: 'desc' },
    select: { merchantTradeNo: true },
  });
  let seq = 1;
  if (last?.merchantTradeNo) {
    const parsed = parseInt(last.merchantTradeNo.slice(8), 10);
    if (Number.isFinite(parsed)) seq = parsed + 1;
  }
  const width = seq > 9999 ? 5 : 4;
  return ymd + String(seq).padStart(width, '0');
}

const checkoutSchema = z.object({
  paymentMethod: z.enum(['CREDIT', 'CREDIT_INSTALLMENT', 'ATM', 'CVS', 'MONTHLY']),
  installments: z.string().optional(),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(8),
  shippingAddress: z.string().min(5),
  invoiceTaxId: z.string().regex(/^\d{8}$/).optional().or(z.literal('')),
  invoiceTitle: z.string().optional().or(z.literal('')),
  voucherCode: z.string().optional().or(z.literal('')),
  recipientRegion: z.string().optional().or(z.literal('')),
});

// POST /api/orders/checkout — creates order, returns ECPay redirect form fields
ordersRouter.post('/checkout', requireVerifiedMember, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const data = parsed.data;

  // Monthly payment gate
  if (data.paymentMethod === 'MONTHLY' && !req.user.canMonthlyPay) {
    return res.status(403).json({ error: 'monthly_pay_not_enabled' });
  }

  const cart = await prisma.cartItem.findMany({
    where: { userId: req.user.id },
    include: {
      product: true,
      variant: true,
      bundle: { include: { items: { include: { product: true } } } },
    },
  });
  if (cart.length === 0) return res.status(400).json({ error: 'empty_cart' });

  const tier = await getTier(req.user.tier);

  // Stock check + price snapshot. Each cart entry is either a Product
  // (possibly with a variant) or a Bundle (with its own component qtys).
  const items = cart.map((it) => {
    if (it.bundle) {
      for (const bi of it.bundle.items) {
        if (bi.product.stock < bi.quantity * it.quantity) {
          throw Object.assign(new Error('insufficient_stock'), { http: 409, sku: bi.product.sku });
        }
      }
      return {
        productId: null,
        bundleId: it.bundle.id,
        variantId: null,
        sku: 'BUNDLE-' + it.bundle.slug,
        nameZh: '【團購】' + it.bundle.nameZh,
        variantName: null,
        unitPrice: it.bundle.bundlePrice,
        quantity: it.quantity,
        lineTotal: it.bundle.bundlePrice * it.quantity,
      };
    }
    const stock = it.variant ? it.variant.stock : it.product.stock;
    if (it.quantity > stock) {
      throw Object.assign(new Error('insufficient_stock'), { http: 409, sku: it.product.sku });
    }
    const overlay = it.variant ? {
      priceA: it.variant.priceA ?? it.product.priceA,
      priceB: it.variant.priceB ?? it.product.priceB,
      priceC: it.variant.priceC ?? it.product.priceC,
      priceD: it.variant.priceD ?? it.product.priceD,
    } : it.product;
    const tierUnit = priceForTier(overlay, tier);
    const useBulk = it.product.priceBulk != null
                 && it.product.bulkMinQty != null
                 && it.quantity >= it.product.bulkMinQty
                 && it.product.priceBulk < tierUnit;
    const unit = useBulk ? it.product.priceBulk : tierUnit;
    return {
      productId: it.product.id,
      bundleId: null,
      variantId: it.variant?.id ?? null,
      sku: it.product.sku,
      nameZh: it.product.nameZh,
      variantName: it.variant?.name ?? null,
      unitPrice: unit,
      quantity: it.quantity,
      lineTotal: unit * it.quantity,
    };
  });

  // Build a parallel array of stock-decrement instructions for the tx
  const stockOps = [];
  for (const it of cart) {
    if (it.bundle) {
      for (const bi of it.bundle.items) {
        stockOps.push({ productId: bi.productId, qty: bi.quantity * it.quantity });
      }
    } else if (it.variant) {
      stockOps.push({ variantId: it.variant.id, qty: it.quantity });
    } else {
      stockOps.push({ productId: it.product.id, qty: it.quantity });
    }
  }

  const subtotal = items.reduce((s, x) => s + x.lineTotal, 0);

  let voucherCode = null;
  let voucherDiscount = 0;
  if (data.voucherCode) {
    const evalResult = await evaluateVoucher(data.voucherCode, subtotal, req.user.tier, req.user.id);
    if (!evalResult.ok) return res.status(400).json({ error: 'invalid_voucher', message: evalResult.message });
    voucherCode = evalResult.voucher.code;
    voucherDiscount = evalResult.discount;
  }

  const subtotalAfterVoucher = subtotal - voucherDiscount;
  // Region-aware shipping. Falls back to tier-only fee if no region picked or
  // the picked code is unknown / inactive.
  let region = null;
  if (data.recipientRegion) {
    region = await prisma.shippingRegion.findFirst({
      where: { code: data.recipientRegion, isActive: true },
    });
  }
  const shippingFee = region
    ? shippingFeeForRegion(subtotalAfterVoucher, region, tier)
    : shippingFeeForTier(subtotalAfterVoucher, tier);
  const total = subtotalAfterVoucher + shippingFee;

  const merchantTradeNo = await makeTradeNo();

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        merchantTradeNo,
        userId: req.user.id,
        status: 'PENDING_PAYMENT',
        paymentMethod: data.paymentMethod,
        subtotal, shippingFee, total,
        voucherCode, voucherDiscount,
        recipientName: data.recipientName,
        recipientPhone: data.recipientPhone,
        shippingAddress: data.shippingAddress,
        recipientRegion: region?.code || (data.recipientRegion || null),
        invoiceTaxId: data.invoiceTaxId || null,
        invoiceTitle: data.invoiceTitle || null,
        items: { create: items },
      },
      include: { items: true },
    });
    if (voucherCode) {
      await tx.voucher.update({
        where: { code: voucherCode },
        data: { usedCount: { increment: 1 } },
      });
    }
    // Reserve stock (bundle = decrement each component)
    for (const op of stockOps) {
      if (op.variantId) {
        await tx.productVariant.update({ where: { id: op.variantId }, data: { stock: { decrement: op.qty } } });
      } else {
        await tx.product.update({ where: { id: op.productId }, data: { stock: { decrement: op.qty } } });
      }
    }
    // Clear cart
    await tx.cartItem.deleteMany({ where: { userId: req.user.id } });
    return created;
  });

  await notifyOrder('ORDER_PLACED', order, req.user);

  // Monthly payment: no payment gateway redirect — bill on the monthly statement.
  // Mark PAID immediately so it flows through to fulfillment; receipt to email + LINE.
  if (data.paymentMethod === 'MONTHLY') {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'PAID', ecpayPaymentDate: new Date(), ecpayRtnMsg: 'monthly_billing' },
      include: { items: true, user: true },
    });
    await notifyOrder('ORDER_RECEIPT', updated, updated.user);
    return res.json({ orderId: order.id, monthly: true });
  }

  const { actionUrl, fields } = await buildAioCheckoutForm({
    merchantTradeNo,
    totalAmount: total,
    itemNames: items.map((i) => `${i.nameZh} x${i.quantity}`),
    paymentMethod: data.paymentMethod,
    installments: data.installments,
  });

  res.json({ orderId: order.id, ecpay: { actionUrl, fields } });
});

// ECPay server-to-server notification (ReturnURL + PaymentInfoURL).
// Must respond with literal "1|OK" on success or ECPay will retry.
ordersRouter.post('/ecpay/notify', express.urlencoded({ extended: false }), async (req, res) => {
  const body = req.body;
  if (!(await verifyCallback(body))) {
    console.warn('[ecpay] CheckMacValue mismatch', body);
    return res.send('0|CheckMacValue mismatch');
  }

  const merchantTradeNo = body.MerchantTradeNo;
  const order = await prisma.order.findUnique({
    where: { merchantTradeNo },
    include: { items: true, user: true },
  });
  if (!order) return res.send('0|OrderNotFound');

  const rtnCode = parseInt(body.RtnCode ?? '0', 10);
  const paymentMethod = decodePaymentType(body.PaymentType);

  // ATM virtual account / CVS code notifications (RtnCode = 2 for ATM info,
  // 10100073 for CVS info — kept simple here)
  if (body.BankCode || body.vAccount) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        atmBankCode: body.BankCode ?? null,
        atmVAccount: body.vAccount ?? null,
        paymentExpireAt: body.ExpireDate ? new Date(body.ExpireDate) : null,
      },
    });
    return res.send('1|OK');
  }
  if (body.PaymentNo) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        cvsPaymentNo: body.PaymentNo,
        paymentExpireAt: body.ExpireDate ? new Date(body.ExpireDate) : null,
      },
    });
    return res.send('1|OK');
  }

  if (rtnCode === 1 && order.status === 'PENDING_PAYMENT') {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        ecpayTradeNo: body.TradeNo,
        ecpayPaymentDate: body.PaymentDate ? new Date(body.PaymentDate) : new Date(),
        ecpayRtnMsg: body.RtnMsg,
        paymentMethod: paymentMethod ?? order.paymentMethod,
      },
      include: { items: true, user: true },
    });

    // Issue E-Invoice (best-effort — failure shouldn't block the callback ACK)
    try {
      const result = await issueInvoice({
        merchantTradeNo: order.merchantTradeNo,
        totalAmount: order.total,
        itemNames: order.items.map((i) => i.nameZh),
        itemPrices: order.items.map((i) => i.unitPrice),
        itemCounts: order.items.map((i) => i.quantity),
        customerEmail: order.user.email,
        customerName: order.invoiceTitle || order.user.companyTitle || order.user.name,
        customerIdentifier: order.invoiceTaxId || order.user.taxId || '',
      });
      if (result.InvoiceNo) {
        await prisma.order.update({
          where: { id: order.id },
          data: { invoiceNumber: result.InvoiceNo, invoiceIssuedAt: new Date() },
        });
      }
    } catch (err) {
      console.error('[invoice] issue failed:', err.message);
    }

    await notifyOrder('ORDER_PAID', updated, updated.user);
  }

  res.send('1|OK');
});

// User-facing return after payment
ordersRouter.post('/ecpay/result', express.urlencoded({ extended: false }), (req, res) => {
  res.redirect('/account.html?paid=1&trade=' + encodeURIComponent(req.body.MerchantTradeNo ?? ''));
});

// One order: customer accesses own; staff with orders.view accesses any.
// Regex constraint so this doesn't shadow more specific paths like /mine.
ordersRouter.get('/:id([a-z0-9]{20,})', async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      user: { select: { id: true, name: true, email: true, phone: true, clinicName: true, taxId: true, companyTitle: true } },
    },
  });
  if (!order) return res.status(404).json({ error: 'not_found' });
  const { getUserPermissions } = await import('../lib/permissions.js');
  const perms = await getUserPermissions(req.user);
  const isStaff = perms.has('orders.view');
  if (order.userId !== req.user.id && !isStaff) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Hide internal notes from the customer
  if (!isStaff) {
    delete order.staffNotes;
    delete order.staffNotesUpdatedAt;
    delete order.staffNotesUpdatedBy;
  }
  res.json({ order });
});

// Staff edit internal notes on an order
ordersRouter.patch('/:id([a-z0-9]{20,})/notes', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  const { getUserPermissions } = await import('../lib/permissions.js');
  const perms = await getUserPermissions(req.user);
  if (!perms.has('orders.view')) return res.status(403).json({ error: 'forbidden' });
  const notes = typeof req.body?.staffNotes === 'string' ? req.body.staffNotes : null;
  await prisma.order.update({
    where: { id: req.params.id },
    data: {
      staffNotes: notes ?? null,
      staffNotesUpdatedAt: new Date(),
      staffNotesUpdatedBy: req.user.id,
    },
  });
  res.json({ ok: true });
});

// Printable invoice — opens in new tab; users press Cmd/Ctrl+P → Save as PDF.
ordersRouter.get('/:id([a-z0-9]{20,})/invoice', async (req, res, next) => {
  if (!req.user) return res.status(401).send('Please log in');
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      user: { select: { id: true, name: true, email: true, phone: true, clinicName: true, clinicAddress: true, taxId: true, companyTitle: true } },
    },
  });
  if (!order) return res.status(404).send('Not found');
  if (order.userId !== req.user.id) {
    const { getUserPermissions } = await import('../lib/permissions.js');
    const perms = await getUserPermissions(req.user);
    if (!perms.has('orders.view')) return res.status(403).send('Forbidden');
  }

  const { getSetting } = await import('../lib/settings.js');
  const siteName = await getSetting('SITE_NAME');
  const appUrl   = await getSetting('APP_URL');
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderInvoice(order, { siteName, appUrl }));
});

function renderInvoice(o, ctx) {
  const fmt = (n) => 'NT$ ' + (n ?? 0).toLocaleString();
  const itemRows = o.items.map((it) => `
    <tr>
      <td>${it.sku}</td>
      <td>${it.nameZh}${it.variantName ? `<br><span style="font-size:11px;color:#64748b">${it.variantName}</span>` : ''}</td>
      <td style="text-align:right">${it.quantity}</td>
      <td style="text-align:right">${fmt(it.unitPrice)}</td>
      <td style="text-align:right">${fmt(it.lineTotal)}</td>
    </tr>`).join('');
  const statusZh = ({
    PENDING_PAYMENT: '待付款', PAID: '已付款', PROCESSING: '處理中',
    SHIPPED: '已出貨', DELIVERED: '已送達', CANCELLED: '已取消', REFUNDED: '已退款',
  })[o.status] ?? o.status;
  const payMethodZh = ({
    CREDIT: '信用卡', CREDIT_INSTALLMENT: '信用卡分期',
    ATM: 'ATM 轉帳', CVS: '超商代碼', MONTHLY: '月結對帳單',
  })[o.paymentMethod] ?? o.paymentMethod;
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8"/>
  <title>發票 ${o.merchantTradeNo}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Noto Sans TC', sans-serif; color:#0f172a; margin:0; padding:32px; background:#f1f5f9; }
    .paper { max-width:780px; margin:0 auto; background:#fff; padding:48px; border:1px solid #e2e8f0; box-shadow:0 4px 16px rgba(0,0,0,.05); }
    h1 { margin:0 0 4px; font-size:28px; }
    h2 { margin:32px 0 12px; font-size:16px; color:#475569; text-transform:uppercase; letter-spacing:.05em; border-bottom:2px solid #0f766e; padding-bottom:6px; }
    .top { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:32px; }
    .brand { font-size:14px; color:#64748b; }
    .meta { font-size:13px; text-align:right; }
    .meta div { margin:2px 0; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:32px; font-size:13px; }
    .grid h3 { font-size:13px; color:#64748b; margin:0 0 8px; font-weight:600; }
    .grid p { margin:2px 0; line-height:1.6; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:left; vertical-align:top; }
    th { background:#f8fafc; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; }
    .totals { margin-left:auto; width:280px; font-size:14px; }
    .totals .row { display:flex; justify-content:space-between; padding:6px 0; }
    .totals .row.grand { font-size:18px; font-weight:800; color:#0f766e; border-top:2px solid #0f172a; padding-top:10px; margin-top:6px; }
    .pill { display:inline-block; font-size:12px; padding:2px 10px; border-radius:999px; background:#dcfce7; color:#166534; font-weight:600; }
    .actions { text-align:center; margin-top:24px; }
    .actions button { background:#0f766e; color:#fff; border:none; padding:10px 24px; border-radius:8px; font-weight:600; cursor:pointer; font-size:14px; }
    @media print {
      body { background:#fff; padding:0; }
      .paper { border:none; box-shadow:none; padding:24px; }
      .actions { display:none; }
    }
  </style>
</head>
<body>
  <div class="paper">
    <div class="top">
      <div>
        <h1>採購單據</h1>
        <p class="brand">${ctx.siteName ?? '資生國際 Shisei Dental'} · 醫療耗材專業通路</p>
      </div>
      <div class="meta">
        <div><b>單據編號：</b>${o.merchantTradeNo}</div>
        <div><b>狀態：</b><span class="pill">${statusZh}</span></div>
        <div><b>建立日期：</b>${new Date(o.createdAt).toLocaleString('zh-TW')}</div>
        ${o.invoiceNumber ? `<div><b>電子發票號碼：</b>${o.invoiceNumber}</div>` : ''}
      </div>
    </div>

    <h2>客戶資訊</h2>
    <div class="grid">
      <div>
        <h3>收件人</h3>
        <p><b>${o.recipientName}</b></p>
        <p>${o.recipientPhone}</p>
        <p>${o.shippingAddress}</p>
      </div>
      <div>
        <h3>發票資訊</h3>
        ${o.invoiceTaxId ? `<p>統一編號：${o.invoiceTaxId}</p>` : '<p>個人 (二聯式)</p>'}
        ${o.invoiceTitle ? `<p>抬頭：${o.invoiceTitle}</p>` : ''}
        ${o.user?.email ? `<p>Email：${o.user.email}</p>` : ''}
      </div>
    </div>

    <h2>商品明細</h2>
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>品名</th>
          <th style="text-align:right">數量</th>
          <th style="text-align:right">單價</th>
          <th style="text-align:right">小計</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="totals">
      <div class="row"><span>商品小計</span><span>${fmt(o.subtotal)}</span></div>
      ${o.voucherDiscount ? `<div class="row" style="color:#16a34a"><span>優惠折抵 ${o.voucherCode ? '(' + o.voucherCode + ')' : ''}</span><span>- ${fmt(o.voucherDiscount)}</span></div>` : ''}
      <div class="row"><span>運費</span><span>${o.shippingFee === 0 ? '免運' : fmt(o.shippingFee)}</span></div>
      <div class="row grand"><span>總計</span><span>${fmt(o.total)}</span></div>
    </div>

    <h2>付款方式</h2>
    <p style="font-size:13px">${payMethodZh}${o.ecpayTradeNo ? `　·　ECPay 交易序號：${o.ecpayTradeNo}` : ''}${o.atmVAccount ? `　·　ATM 帳號：${o.atmBankCode}-${o.atmVAccount}` : ''}${o.cvsPaymentNo ? `　·　超商繳款碼：${o.cvsPaymentNo}` : ''}</p>

    ${o.trackingNumber ? `<h2>物流</h2><p style="font-size:13px">追蹤號：${o.trackingNumber}　·　出貨日：${new Date(o.shippedAt).toLocaleString('zh-TW')}</p>` : ''}

    <div class="actions">
      <button onclick="window.print()">🖨 列印 / 儲存 PDF</button>
    </div>
  </div>
</body>
</html>`;
}

// Customer changes the payment method on a pending order before paying.
ordersRouter.patch('/:id([a-z0-9]{20,})/payment-method', requireVerifiedMember, async (req, res) => {
  const ALLOWED = ['CREDIT', 'CREDIT_INSTALLMENT', 'ATM', 'CVS'];
  const next = req.body?.paymentMethod;
  if (!ALLOWED.includes(next)) return res.status(400).json({ error: 'invalid_payment_method' });
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (order.status !== 'PENDING_PAYMENT') {
    return res.status(409).json({ error: 'not_pending', status: order.status });
  }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentMethod: next,
      // Clear any stale payment-channel info from the previous method
      atmBankCode: null, atmVAccount: null, cvsPaymentNo: null, paymentExpireAt: null,
    },
  });
  res.json({ ok: true });
});

// Customer re-pays a PENDING_PAYMENT order: re-builds the ECPay AIO form
// using the order's saved totals/items/payment method. The same
// merchantTradeNo is reused so ECPay can correlate.
ordersRouter.post('/:id([a-z0-9]{20,})/pay-again', requireVerifiedMember, async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (order.status !== 'PENDING_PAYMENT') {
    return res.status(409).json({ error: 'not_pending', status: order.status });
  }
  if (order.paymentMethod === 'MONTHLY') {
    return res.status(400).json({ error: 'monthly_billing_no_redirect' });
  }
  const { actionUrl, fields } = await buildAioCheckoutForm({
    merchantTradeNo: order.merchantTradeNo,
    totalAmount: order.total,
    itemNames: order.items.map((i) => `${i.nameZh} x${i.quantity}`),
    paymentMethod: order.paymentMethod,
  });
  res.json({ ecpay: { actionUrl, fields } });
});

// Reorder: copy a past order's items back into the cart. Skips items whose
// product/variant/bundle is no longer active or out of stock. Returns a
// summary so the customer knows what landed and what was skipped.
ordersRouter.post('/:id([a-z0-9]{20,})/reorder', requireVerifiedMember, async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });

  const added = [];
  const skipped = [];

  for (const it of order.items) {
    // Bundle line items: re-check the bundle is still active and add as-is.
    if (it.bundleId) {
      const bundle = await prisma.bundle.findUnique({ where: { id: it.bundleId } });
      if (!bundle || !bundle.isActive) {
        skipped.push({ nameZh: it.nameZh, reason: 'bundle_inactive' });
        continue;
      }
      const existing = await prisma.cartItem.findFirst({
        where: { userId: req.user.id, bundleId: it.bundleId, productId: null, variantId: null },
      });
      if (existing) {
        await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + it.quantity } });
      } else {
        await prisma.cartItem.create({ data: { userId: req.user.id, bundleId: it.bundleId, quantity: it.quantity } });
      }
      added.push({ nameZh: it.nameZh, quantity: it.quantity });
      continue;
    }
    // Product line: confirm the product (and variant, if any) still exists & has stock.
    if (!it.productId) { skipped.push({ nameZh: it.nameZh, reason: 'missing_product' }); continue; }
    const product = await prisma.product.findUnique({ where: { id: it.productId } });
    if (!product || !product.isActive) {
      skipped.push({ nameZh: it.nameZh, reason: 'product_inactive' }); continue;
    }
    let stock = product.stock;
    if (it.variantId) {
      const v = await prisma.productVariant.findUnique({ where: { id: it.variantId } });
      if (!v || !v.isActive) { skipped.push({ nameZh: it.nameZh, reason: 'variant_inactive' }); continue; }
      stock = v.stock;
    }
    if (stock <= 0) { skipped.push({ nameZh: it.nameZh, reason: 'out_of_stock' }); continue; }
    const qty = Math.min(it.quantity, stock);
    const existing = await prisma.cartItem.findFirst({
      where: { userId: req.user.id, productId: it.productId, variantId: it.variantId ?? null, bundleId: null },
    });
    if (existing) {
      await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + qty } });
    } else {
      await prisma.cartItem.create({
        data: {
          userId: req.user.id,
          productId: it.productId,
          ...(it.variantId ? { variantId: it.variantId } : {}),
          quantity: qty,
        },
      });
    }
    added.push({ nameZh: it.nameZh, quantity: qty, clampedFrom: qty < it.quantity ? it.quantity : null });
  }

  res.json({ ok: true, added, skipped });
});

// List a member's own orders
ordersRouter.get('/mine', requireVerifiedMember, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  res.json({ orders });
});

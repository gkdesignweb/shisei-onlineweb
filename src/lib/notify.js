import { pushLineMessage } from './line.js';
import { sendMail } from './mailer.js';

const TEMPLATES = {
  ORDER_PLACED: (o) => ({
    subject: `【訂單成立】${o.merchantTradeNo}`,
    body: `您的訂單 ${o.merchantTradeNo} 已成立，金額 NT$${o.total}。請依付款方式於期限內完成繳款。`,
  }),
  ORDER_PAID: (o) => ({
    subject: `【付款完成】${o.merchantTradeNo}`,
    body: `訂單 ${o.merchantTradeNo} 已成功收款 NT$${o.total}，我們將盡快出貨。`,
  }),
  ORDER_SHIPPED: (o) => ({
    subject: `【商品已出貨】${o.merchantTradeNo}`,
    body: `訂單 ${o.merchantTradeNo} 已出貨。${o.trackingNumber ? `物流追蹤號: ${o.trackingNumber}` : ''}`,
  }),
  ORDER_RECEIPT: (o) => {
    const lines = (o.items ?? []).map((i) => `  · ${i.nameZh}  ×${i.quantity}  NT$${i.lineTotal}`).join('\n');
    return {
      subject: `【收據】${o.merchantTradeNo} · 月繳對帳單`,
      body: `感謝您的訂購！\n\n訂單編號：${o.merchantTradeNo}\n${lines}\n\n小計 NT$${o.subtotal}\n${o.voucherDiscount ? `優惠折抵 -NT$${o.voucherDiscount}\n` : ''}運費 NT$${o.shippingFee}\n總計 NT$${o.total}\n\n付款方式：月繳對帳單，月底結算。`,
    };
  },
};

export async function notifyOrder(event, order, user) {
  const tpl = TEMPLATES[event];
  if (!tpl) return;
  const { subject, body } = tpl(order);
  await Promise.allSettled([
    sendMail({ to: user.email, subject, text: body }),
    user.lineUserId ? pushLineMessage(user.lineUserId, `${subject}\n${body}`) : null,
  ].filter(Boolean));
}

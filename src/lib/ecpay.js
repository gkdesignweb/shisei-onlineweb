import crypto from 'node:crypto';
import { getSetting } from './settings.js';

// ECPay-style URL encoding: .NET-flavored uppercase hex, then map back the
// seven punctuation exceptions per the AIO spec.
function ecpayUrlEncode(str) {
  return encodeURIComponent(str)
    .replace(/'/g, '%27')
    .replace(/%20/g, '+')
    .replace(/%2D/g, '-')
    .replace(/%5F/g, '_')
    .replace(/%2E/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2A/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

export function generateCheckMacValue(params, hashKey, hashIv) {
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const pairs = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${pairs}&HashIV=${hashIv}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

async function loadCreds() {
  return {
    merchantId:     await getSetting('ECPAY_MERCHANT_ID'),
    hashKey:        await getSetting('ECPAY_HASH_KEY'),
    hashIv:         await getSetting('ECPAY_HASH_IV'),
    paymentUrl:     await getSetting('ECPAY_PAYMENT_URL'),
    returnUrl:      await getSetting('ECPAY_RETURN_URL'),
    clientBackUrl:  await getSetting('ECPAY_CLIENT_BACK_URL'),
    orderResultUrl: await getSetting('ECPAY_ORDER_RESULT_URL'),
  };
}

export async function buildAioCheckoutForm({
  merchantTradeNo,
  totalAmount,
  itemNames,
  tradeDesc = '醫療耗材訂購',
  paymentMethod,
  installments,
}) {
  const c = await loadCreds();
  const choosePayment = {
    CREDIT: 'Credit',
    CREDIT_INSTALLMENT: 'Credit',
    ATM: 'ATM',
    CVS: 'CVS',
  }[paymentMethod] ?? 'ALL';

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const merchantTradeDate =
    `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const fields = {
    MerchantID: c.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: merchantTradeDate,
    PaymentType: 'aio',
    TotalAmount: String(totalAmount),
    TradeDesc: tradeDesc,
    ItemName: itemNames.join('#'),
    ReturnURL: c.returnUrl,
    ClientBackURL: c.clientBackUrl,
    OrderResultURL: c.orderResultUrl,
    ChoosePayment: choosePayment,
    EncryptType: '1',
  };

  if (paymentMethod === 'CREDIT_INSTALLMENT' && installments) {
    fields.CreditInstallment = installments;
  }
  if (paymentMethod === 'ATM') {
    fields.ExpireDate = '3';
    fields.PaymentInfoURL = c.returnUrl;
  }
  if (paymentMethod === 'CVS') {
    fields.StoreExpireDate = '10080';
    fields.PaymentInfoURL = c.returnUrl;
  }

  fields.CheckMacValue = generateCheckMacValue(fields, c.hashKey, c.hashIv);

  return { actionUrl: c.paymentUrl, fields };
}

export async function verifyCallback(body) {
  const c = await loadCreds();
  const received = body.CheckMacValue;
  const expected = generateCheckMacValue(body, c.hashKey, c.hashIv);
  return received === expected;
}

export function decodePaymentType(paymentType) {
  if (!paymentType) return null;
  if (paymentType.startsWith('Credit_')) return 'CREDIT';
  if (paymentType.startsWith('ATM_')) return 'ATM';
  if (paymentType.startsWith('CVS_')) return 'CVS';
  return paymentType;
}

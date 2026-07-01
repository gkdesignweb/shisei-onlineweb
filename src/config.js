import 'dotenv/config';

const required = (key, fallback) => {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') {
    console.warn(`[config] ${key} is not set`);
  }
  return v;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: required('APP_URL', 'http://localhost:3000'),
  jwtSecret: required('JWT_SECRET', 'dev-only-jwt-secret'),

  ecpay: {
    merchantId:    required('ECPAY_MERCHANT_ID', '2000132'),
    hashKey:       required('ECPAY_HASH_KEY', '5294y06JbISpM5x9'),
    hashIv:        required('ECPAY_HASH_IV', 'v77hoKGq4kWxNNIS'),
    paymentUrl:    required('ECPAY_PAYMENT_URL', 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'),
    returnUrl:     required('ECPAY_RETURN_URL', 'http://localhost:3000/api/orders/ecpay/notify'),
    clientBackUrl: required('ECPAY_CLIENT_BACK_URL', 'http://localhost:3000/account/orders'),
    orderResultUrl:required('ECPAY_ORDER_RESULT_URL', 'http://localhost:3000/account/orders/result'),
  },

  invoice: {
    merchantId: required('ECPAY_INVOICE_MERCHANT_ID', '2000132'),
    hashKey:    required('ECPAY_INVOICE_HASH_KEY', 'ejCk326UnaZWKisg'),
    hashIv:     required('ECPAY_INVOICE_HASH_IV', 'q9jcZX8Ib9LM8wYk'),
    url:        required('ECPAY_INVOICE_URL', 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/Issue'),
  },

  line: {
    loginChannelId:     process.env.LINE_LOGIN_CHANNEL_ID ?? '',
    loginChannelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? '',
    loginCallbackUrl:   process.env.LINE_LOGIN_CALLBACK_URL ?? 'http://localhost:3000/api/auth/line/callback',
    messagingToken:     process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ?? '',
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '醫療耗材平台 <no-reply@example.com>',
  },
};

import { prisma } from '../db.js';

// Schema-of-known-settings drives both backend defaults and the admin form.
// `key` doubles as the env-var name so .env still works as a fallback.
export const SETTINGS_SCHEMA = [
  // ----- App -----
  { key: 'APP_URL', group: 'app',
    label: '應用程式公開網址',
    help: 'ECPay ReturnURL 必須能從外部 HTTPS 連到此網址。',
    type: 'url', isSecret: false,
    default: 'http://localhost:3100' },
  { key: 'SITE_NAME', group: 'app', label: '網站名稱',
    type: 'text', isSecret: false, default: '資生國際 Shisei Dental' },
  { key: 'SITE_TAGLINE', group: 'app', label: '網站標語 (SEO description 預設)',
    type: 'text', isSecret: false,
    default: '專為診所與醫療機構打造的封閉式 B2B 採購平台。' },
  { key: 'SITE_OG_IMAGE', group: 'app', label: '預設 OG 分享圖 URL',
    type: 'url', isSecret: false, default: '',
    help: '社群分享 (Facebook / LINE / X) 預覽圖；可從媒體庫取得 URL。' },
  { key: 'SOCIAL_LINE_URL', group: 'app', label: 'LINE 官方帳號 URL',
    type: 'url', isSecret: false, default: '',
    help: '顯示於頁尾。例：https://lin.ee/xxxx' },
  { key: 'SOCIAL_FB_URL', group: 'app', label: 'Facebook 粉絲頁 URL',
    type: 'url', isSecret: false, default: '' },
  { key: 'SITE_THEME_COLOR', group: 'app', label: '網站主題色 (HEX)',
    type: 'text', isSecret: false, default: '#0d9488',
    help: '影響主要按鈕、連結、Logo 圓底色。例：#0d9488 / #ef4444 / #2563eb' },
  { key: 'FOOTER_PAGE_SLUGS', group: 'app', label: '頁尾額外連結 (slug CSV)',
    type: 'text', isSecret: false, default: '',
    help: '例：faq,warranty,terms — 對應 /p/faq, /p/warranty…' },
  { key: 'SHOP_NAV_PAGE_SLUGS', group: 'app', label: '網購主選單頁面 (shop.html slug CSV)',
    type: 'text', isSecret: false, default: '' },

  // ----- 醫療專業人員確認彈窗 (gate) -----
  { key: 'PROF_GATE_ENABLED', group: 'app',
    label: '啟用「醫療專業人員確認」彈窗',
    help: '訪客首次瀏覽時跳出彈窗，需確認自己為醫療專業人員方可繼續。',
    type: 'select',
    options: [
      { value: 'false', label: '關閉' },
      { value: 'true',  label: '啟用' },
    ],
    isSecret: false, default: 'false' },
  { key: 'PROF_GATE_TITLE', group: 'app', label: '彈窗標題',
    type: 'text', isSecret: false, default: '醫療專業人員確認' },
  { key: 'PROF_GATE_BODY', group: 'app', label: '彈窗內容',
    help: '可使用 HTML。例：本平台僅對通過審核之醫療專業人員開放。',
    type: 'text', isSecret: false,
    default: '本平台僅對通過審核之醫療專業人員開放。請確認您具備相關專業資格後再行瀏覽。' },
  { key: 'PROF_GATE_CONFIRM_LABEL', group: 'app', label: '確認按鈕文字',
    type: 'text', isSecret: false, default: '我是醫療專業人員，繼續瀏覽' },
  { key: 'PROF_GATE_DECLINE_LABEL', group: 'app', label: '拒絕按鈕文字',
    type: 'text', isSecret: false, default: '離開' },

  // ----- ECPay 金流 -----
  { key: 'ECPAY_MODE', group: 'ecpay',
    label: '環境模式',
    help: '切換時系統會自動帶入對應的付款 / 發票 URL。',
    type: 'select',
    options: [
      { value: 'sandbox',    label: '測試環境 (Sandbox)' },
      { value: 'production', label: '正式環境' },
    ],
    default: 'sandbox',
    isSecret: false,
    derived: true,            // virtual: not used by libs directly, drives URL fields
  },
  { key: 'ECPAY_MERCHANT_ID', group: 'ecpay', label: '特店編號 MerchantID',
    type: 'text', isSecret: false, default: '2000132',
    help: '由 ECPay 後台取得。Sandbox 預設為 2000132。' },
  { key: 'ECPAY_HASH_KEY',    group: 'ecpay', label: 'HashKey',
    type: 'text', isSecret: true, default: '5294y06JbISpM5x9' },
  { key: 'ECPAY_HASH_IV',     group: 'ecpay', label: 'HashIV',
    type: 'text', isSecret: true, default: 'v77hoKGq4kWxNNIS' },
  { key: 'ECPAY_PAYMENT_URL', group: 'ecpay', label: 'AIO 付款 URL',
    type: 'url', isSecret: false,
    default: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5' },
  { key: 'ECPAY_RETURN_URL', group: 'ecpay', label: 'ReturnURL (server-to-server)',
    type: 'url', isSecret: false,
    help: '必須為公開 HTTPS 網址，ECPay 會 POST 付款結果到此。',
    default: 'http://localhost:3100/api/orders/ecpay/notify' },
  { key: 'ECPAY_CLIENT_BACK_URL', group: 'ecpay', label: 'ClientBackURL (用戶返回)',
    type: 'url', isSecret: false,
    default: 'http://localhost:3100/account.html' },
  { key: 'ECPAY_ORDER_RESULT_URL', group: 'ecpay', label: 'OrderResultURL',
    type: 'url', isSecret: false,
    default: 'http://localhost:3100/api/orders/ecpay/result' },

  // ----- ECPay 電子發票 -----
  { key: 'ECPAY_INVOICE_MERCHANT_ID', group: 'invoice', label: '電子發票 MerchantID',
    type: 'text', isSecret: false, default: '2000132' },
  { key: 'ECPAY_INVOICE_HASH_KEY', group: 'invoice', label: '發票 HashKey',
    type: 'text', isSecret: true, default: 'ejCk326UnaZWKisg' },
  { key: 'ECPAY_INVOICE_HASH_IV', group: 'invoice', label: '發票 HashIV',
    type: 'text', isSecret: true, default: 'q9jcZX8Ib9LM8wYk' },
  { key: 'ECPAY_INVOICE_URL', group: 'invoice', label: '發票 API URL',
    type: 'url', isSecret: false,
    default: 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/Issue' },

  // ----- LINE -----
  { key: 'LINE_LOGIN_CHANNEL_ID', group: 'line', label: 'LINE Login Channel ID',
    type: 'text', isSecret: false, default: '',
    help: '從 https://developers.line.biz/console/ 的 LINE Login channel 取得。' },
  { key: 'LINE_LOGIN_CHANNEL_SECRET', group: 'line', label: 'Channel Secret',
    type: 'text', isSecret: true, default: '' },
  { key: 'LINE_LOGIN_CALLBACK_URL', group: 'line', label: 'Callback URL',
    type: 'url', isSecret: false,
    default: 'http://localhost:3100/api/auth/line/callback',
    help: '須與 LINE Developers Console 中設定的 Callback URL 完全一致。' },
  { key: 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', group: 'line',
    label: 'Messaging API Access Token (取代 LINE Notify)',
    type: 'text', isSecret: true, default: '',
    help: 'LINE Notify 已於 2025-03-31 停止服務；改用 Messaging API push 發送訂單通知。' },

  // ----- Google OAuth -----
  { key: 'GOOGLE_CLIENT_ID', group: 'google', label: 'Google OAuth Client ID',
    type: 'text', isSecret: false, default: '',
    help: 'Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID。' },
  { key: 'GOOGLE_CLIENT_SECRET', group: 'google', label: 'Client Secret',
    type: 'text', isSecret: true, default: '' },
  { key: 'GOOGLE_CALLBACK_URL', group: 'google', label: 'Callback URL',
    type: 'url', isSecret: false,
    default: 'http://localhost:3100/api/auth/google/callback',
    help: '須與 Google Cloud Console 中設定的 Authorized redirect URI 完全一致。' },

  // ----- SMTP -----
  { key: 'SMTP_HOST', group: 'smtp', label: 'SMTP 主機', type: 'text', isSecret: false, default: '' },
  { key: 'SMTP_PORT', group: 'smtp', label: 'SMTP Port', type: 'number', isSecret: false, default: '587' },
  { key: 'SMTP_USER', group: 'smtp', label: '帳號',     type: 'text', isSecret: false, default: '' },
  { key: 'SMTP_PASS', group: 'smtp', label: '密碼',     type: 'text', isSecret: true,  default: '' },
  { key: 'SMTP_FROM', group: 'smtp', label: '寄件人',   type: 'text', isSecret: false,
    default: '醫療耗材平台 <no-reply@example.com>' },

  // ----- Database (Supabase) -----
  // These values are mirrored to .env on save — Prisma reads .env at process
  // start (chicken-and-egg: can't bootstrap settings store without DB URL).
  { key: 'DATABASE_URL', group: 'database', label: 'DATABASE_URL (Transaction Pooler, port 6543)',
    type: 'text', isSecret: true,
    default: '',
    requiresRestart: true,
    help: 'Supabase Dashboard → Project Settings → Database → Connection string → Transaction Pooler。範例：postgresql://postgres.<ref>:<pwd>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1' },
  { key: 'DIRECT_URL', group: 'database', label: 'DIRECT_URL (Session / Direct, port 5432)',
    type: 'text', isSecret: true,
    default: '',
    requiresRestart: true,
    help: 'Prisma migration 用的直連字串（port 5432，無 pgbouncer 參數）。' },
  { key: 'SUPABASE_URL', group: 'database', label: 'Supabase 專案 URL',
    type: 'url', isSecret: false,
    default: '',
    help: '例：https://xxxxxxxxxxxxxxxxxxxx.supabase.co — 供 Phase 2 Storage / Phase 3 Auth 使用。' },
  { key: 'SUPABASE_PUBLISHABLE_KEY', group: 'database', label: 'Supabase Publishable Key',
    type: 'text', isSecret: false,
    default: '',
    help: 'Project Settings → API → Publishable key（sb_publishable_…）。前端可使用，無資料庫權限。' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', group: 'database', label: 'Supabase Service Role Key',
    type: 'text', isSecret: true,
    default: '',
    help: 'Project Settings → API → service_role key。伺服器端上傳檔案到 Storage 使用（繞過 RLS）。切勿暴露於前端。' },
];

const ECPAY_URL_PAIRS = {
  sandbox: {
    ECPAY_PAYMENT_URL: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
    ECPAY_INVOICE_URL: 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/Issue',
  },
  production: {
    ECPAY_PAYMENT_URL: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
    ECPAY_INVOICE_URL: 'https://einvoice.ecpay.com.tw/B2CInvoice/Issue',
  },
};

export function urlsForMode(mode) {
  return ECPAY_URL_PAIRS[mode] ?? ECPAY_URL_PAIRS.sandbox;
}

const META = new Map(SETTINGS_SCHEMA.map((s) => [s.key, s]));
export function getMeta(key) { return META.get(key); }

// In-memory cache. 60s TTL works because admin writes call bustSettingsCache()
// synchronously, so DB and cache never drift. The longer TTL matters under
// remote DB (Supabase) where a cache miss costs a ~500ms round-trip and many
// settings are read per request (e.g. /api/site).
let cache = null;
let cacheTime = 0;
const TTL_MS = 60_000;

// Pre-warm at server boot so the first request doesn't eat the cache miss.
export async function warmSettingsCache() {
  await loadCache();
}

async function loadCache() {
  if (cache && Date.now() - cacheTime < TTL_MS) return cache;
  const rows = await prisma.setting.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
  cacheTime = Date.now();
  return cache;
}

export function bustSettingsCache() {
  cache = null;
  cacheTime = 0;
}

// Resolution order: DB row → env var → schema default → '' .
export async function getSetting(key) {
  const m = await loadCache();
  if (m.has(key) && m.get(key) !== '') return m.get(key);
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') return envVal;
  const meta = META.get(key);
  return meta?.default ?? '';
}

export async function getMany(keys) {
  const out = {};
  for (const k of keys) out[k] = await getSetting(k);
  return out;
}

export async function setSetting(key, value) {
  const meta = META.get(key);
  await prisma.setting.upsert({
    where: { key },
    update: { value, group: meta?.group ?? 'misc', isSecret: meta?.isSecret ?? false },
    create: {
      key, value,
      group: meta?.group ?? 'misc',
      isSecret: meta?.isSecret ?? false,
    },
  });
  bustSettingsCache();
}

// Returns { source: 'db'|'env'|'default', hasValue, masked? } for the admin UI.
export async function describeSetting(key) {
  const meta = META.get(key);
  if (!meta) return null;
  const m = await loadCache();
  let source = 'default';
  let value = meta.default ?? '';
  if (m.has(key) && m.get(key) !== '') { source = 'db'; value = m.get(key); }
  else if (process.env[key]) { source = 'env'; value = process.env[key]; }
  return {
    key: meta.key, group: meta.group, label: meta.label, help: meta.help,
    type: meta.type, options: meta.options, isSecret: meta.isSecret,
    requiresRestart: meta.requiresRestart ?? false,
    derived: meta.derived ?? false,
    source,
    hasValue: value !== '',
    // For secrets: return masked. The reveal endpoint exposes the plain value.
    value: meta.isSecret ? maskSecret(value) : value,
  };
}

function maskSecret(v) {
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(v.length);
  return v.slice(0, 2) + '•'.repeat(v.length - 4) + v.slice(-2);
}

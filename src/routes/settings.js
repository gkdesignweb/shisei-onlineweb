import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import {
  SETTINGS_SCHEMA, describeSetting, setSetting, getSetting,
  urlsForMode, bustSettingsCache, getMeta,
} from '../lib/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH    = path.join(__dirname, '..', '..', '.env');
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');

// Keys that must also live in process.env (because Prisma reads them at boot,
// before the DB-backed settings store is reachable).
const ENV_MIRROR_KEYS = new Set(['DATABASE_URL', 'DIRECT_URL']);

// Flip prisma schema datasource provider to match the saved DATABASE_URL.
// SQLite → "sqlite"; postgresql:// or postgres:// → "postgresql".
function syncSchemaProvider(url) {
  if (!fs.existsSync(SCHEMA_PATH)) return;
  const wantsPg = /^postgres(ql)?:\/\//.test(String(url || ''));
  const next = wantsPg ? 'postgresql' : 'sqlite';
  let schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const provRe = /(datasource\s+db\s*\{[^}]*?provider\s*=\s*")[a-z]+(")/i;
  if (!provRe.test(schema)) return;
  schema = schema.replace(provRe, `$1${next}$2`);
  // Postgres needs a directUrl line; SQLite shouldn't have one.
  if (wantsPg && !/directUrl\s*=/.test(schema)) {
    schema = schema.replace(
      /(url\s*=\s*env\(\s*"DATABASE_URL"\s*\)\s*)/,
      '$1\n  directUrl = env("DIRECT_URL")',
    );
  } else if (!wantsPg) {
    schema = schema.replace(/\s*directUrl\s*=\s*env\(\s*"DIRECT_URL"\s*\)\s*/g, '\n  ');
  }
  fs.writeFileSync(SCHEMA_PATH, schema);
}

// Idempotently upsert a key into the .env file, quoting the value.
function upsertEnvKey(key, value) {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const quoted = JSON.stringify(value ?? '');
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let replaced = false;
  const next = lines.map((ln) => {
    if (re.test(ln)) { replaced = true; return `${key}=${quoted}`; }
    return ln;
  });
  if (!replaced) next.push(`${key}=${quoted}`);
  fs.writeFileSync(ENV_PATH, next.join('\n'));
}

// Probe a TCP host:port with a short timeout. Used by SMTP and LINE health
// checks where we only want to confirm reachability, not exchange a handshake.
async function probeTcp(host, port, timeoutMs = 1500) {
  const { Socket } = await import('net');
  return await new Promise((resolve) => {
    const sock = new Socket();
    let settled = false;
    const done = (ok, error) => {
      if (settled) return; settled = true;
      sock.destroy();
      resolve({ ok, error });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('error', (e) => done(false, e.code || e.message));
    sock.once('timeout', () => done(false, 'timeout'));
    sock.connect(port, host);
  });
}

export const settingsRouter = express.Router();

// Health probe — returns one row per group. Statuses:
//   ok     = link verified live
//   warn   = configured but only credentials checked (no network probe)
//   missing= required keys absent
//   error  = probe failed
settingsRouter.get('/health', requirePermission('settings.edit'), async (req, res) => {
  const groups = {};
  const need = async (keys) => Promise.all(keys.map((k) => getSetting(k)));

  // ---- app: required identity keys are present ----
  {
    const [appUrl, siteName] = await need(['APP_URL', 'SITE_NAME']);
    groups.app = appUrl && siteName
      ? { status: 'ok', detail: `${siteName} @ ${appUrl}` }
      : { status: 'missing', detail: '請填入 APP_URL / SITE_NAME' };
  }

  // ---- ecpay: merchant + hash key + iv ----
  {
    const [mid, hk, iv, mode] = await need(['ECPAY_MERCHANT_ID', 'ECPAY_HASH_KEY', 'ECPAY_HASH_IV', 'ECPAY_MODE']);
    if (mid && hk && iv) {
      groups.ecpay = { status: 'warn', detail: `${mode || 'sandbox'} · MerchantID ${mid}（憑證已設定，未實際呼叫 API）` };
    } else groups.ecpay = { status: 'missing', detail: '尚未填入 MerchantID / HashKey / HashIV' };
  }

  // ---- invoice: shares ECPay sandbox pattern ----
  {
    const [mid, hk, iv] = await need(['ECPAY_INVOICE_MERCHANT_ID', 'ECPAY_INVOICE_HASH_KEY', 'ECPAY_INVOICE_HASH_IV']);
    if (mid && hk && iv) {
      groups.invoice = { status: 'warn', detail: `MerchantID ${mid}（憑證已設定）` };
    } else groups.invoice = { status: 'missing', detail: '尚未填入發票憑證' };
  }

  // ---- line: probe the Messaging API endpoint reachability ----
  {
    const [cid, secret, token] = await need(['LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN']);
    if (!cid || !secret) {
      groups.line = { status: 'missing', detail: '尚未填入 LINE Channel ID / Secret' };
    } else if (token) {
      // Verify the access token against LINE's bot info endpoint.
      try {
        const r = await fetch('https://api.line.me/v2/bot/info', {
          headers: { Authorization: `Bearer ${token}` },
        });
        groups.line = r.ok
          ? { status: 'ok', detail: 'Messaging API 已驗證' }
          : { status: 'error', detail: `LINE API ${r.status}` };
      } catch (e) {
        groups.line = { status: 'error', detail: e.message };
      }
    } else groups.line = { status: 'warn', detail: 'Login 已設定，Messaging Token 未設' };
  }

  // ---- google: OAuth 2.0 client credentials + discovery reachability ----
  {
    const [id, secret, cb] = await need(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']);
    if (!id || !secret || !cb) {
      groups.google = { status: 'missing', detail: '尚未填入 Client ID / Secret / Callback URL' };
    } else {
      try {
        const r = await fetch('https://accounts.google.com/.well-known/openid-configuration');
        groups.google = r.ok
          ? { status: 'ok', detail: `Client ${id.slice(0, 12)}… 已設定，Google 可連線` }
          : { status: 'error', detail: `Google discovery ${r.status}` };
      } catch (e) {
        groups.google = { status: 'error', detail: e.message };
      }
    }
  }

  // ---- smtp: TCP probe to host:port ----
  {
    const [host, port, user] = await need(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER']);
    if (!host) {
      groups.smtp = { status: 'missing', detail: '尚未填入 SMTP_HOST' };
    } else {
      const probe = await probeTcp(host, parseInt(port, 10) || 587, 1500);
      if (probe.ok) {
        groups.smtp = user
          ? { status: 'ok', detail: `${host}:${port || 587} 可連線（${user}）` }
          : { status: 'warn', detail: `${host}:${port || 587} 可連線（未設帳號）` };
      } else groups.smtp = { status: 'error', detail: `無法連線 ${host}:${port || 587}（${probe.error}）` };
    }
  }

  // ---- database: live SELECT 1 ----
  {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      const dbUrl = process.env.DATABASE_URL || '';
      const isSupabase = /supabase\.com/.test(dbUrl);
      groups.database = {
        status: 'ok',
        detail: isSupabase ? 'Supabase Postgres · 連線正常' : '已連線到資料庫',
      };
    } catch (e) {
      groups.database = { status: 'error', detail: e.message.slice(0, 200) };
    }
  }

  res.json({ groups });
});

settingsRouter.use(requirePermission('settings.edit'));

settingsRouter.get('/', async (req, res) => {
  const items = [];
  for (const meta of SETTINGS_SCHEMA) {
    items.push(await describeSetting(meta.key));
  }
  const grouped = {};
  for (const it of items) (grouped[it.group] ??= []).push(it);
  res.json({ groups: grouped });
});

const revealSchema = z.object({ key: z.string() });
settingsRouter.post('/reveal', async (req, res) => {
  const parsed = revealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const meta = getMeta(parsed.data.key);
  if (!meta) return res.status(404).json({ error: 'unknown_key' });
  const value = await getSetting(parsed.data.key);
  await prisma.auditLog.create({
    data: { userId: req.user.id, action: 'SETTING_REVEAL', detail: parsed.data.key },
  });
  res.json({ key: parsed.data.key, value });
});

const updateSchema = z.object({
  settings: z.record(z.string(), z.string()),
});

settingsRouter.post('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });

  const incoming = { ...parsed.data.settings };

  // Virtual: ECPAY_MODE drives the URL pair. If admin set it, expand URLs
  // unless they explicitly also provided their own URLs in the same payload.
  if (incoming.ECPAY_MODE) {
    const pair = urlsForMode(incoming.ECPAY_MODE);
    for (const [k, v] of Object.entries(pair)) {
      if (incoming[k] === undefined || incoming[k] === '') incoming[k] = v;
    }
  }

  const written = [];
  const skipped = [];
  for (const [key, value] of Object.entries(incoming)) {
    const meta = getMeta(key);
    if (!meta) { skipped.push(key); continue; }
    if (meta.derived) {
      // store the mode itself so the form can show last selection
      await setSetting(key, value);
      written.push(key);
      continue;
    }
    await setSetting(key, value);
    written.push(key);
    // Mirror DB connection strings to .env so Prisma picks them up after restart.
    if (ENV_MIRROR_KEYS.has(key)) {
      upsertEnvKey(key, value);
      if (key === 'DATABASE_URL') syncSchemaProvider(value);
    }
  }

  bustSettingsCache();
  await prisma.auditLog.create({
    data: { userId: req.user.id, action: 'SETTINGS_UPDATE',
            detail: written.join(',') },
  });

  res.json({ ok: true, written, skipped });
});

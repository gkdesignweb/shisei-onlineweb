# MediSupply — Taiwan B2B 醫療耗材封閉式採購平台

Node.js + Express + Prisma + Tailwind. Three-layer architecture (public landing /
member portal / role-based backend), tiered pricing (Bronze/Gold), and full
ECPay 綠界 integration: AIO checkout (Credit / Credit Installment / ATM / CVS),
ReturnURL/OrderResultURL callbacks, and B2C/B2B electronic invoicing with
統一編號 + 抬頭.

## Quick start

```bash
cp .env.example .env          # then fill in your secrets
npm install
npx prisma db push            # creates SQLite dev.db with full schema
npm run db:seed               # categories, sample products, demo accounts
npm run dev                   # http://localhost:3000
```

Seeded accounts (password is in `prisma/seed.js`):

| Email | Role | Tier | Password |
|---|---|---|---|
| `manager@example.com` | MANAGER | GOLD | `admin1234` |
| `goldclinic@example.com` | MEMBER (verified) | GOLD | `clinic1234` |
| `bronzeclinic@example.com` | MEMBER (verified) | BRONZE | `clinic1234` |

Visit `/admin.html` while logged in as the manager. Newly registered members
land in PENDING and only see SKUs/names, not prices — exactly the "closed"
model spec'd.

## Switching to PostgreSQL for production

1. In `prisma/schema.prisma`, change `provider = "postgresql"`.
2. In `.env`, set `DATABASE_URL="postgresql://user:pass@host:5432/medsupply"`.
3. `npx prisma migrate deploy`.

## ECPay integration notes

The defaults in `.env.example` are **ECPay's published sandbox credentials**
(MerchantID `2000132`). Replace them with your production keys when going live
and flip the URLs to `payment.ecpay.com.tw` and `einvoice.ecpay.com.tw`.

- **CheckMacValue** is generated in [src/lib/ecpay.js](src/lib/ecpay.js) using
  ECPay's exact URL-encoding rules (lowercase, `+` for space, plus the seven
  punctuation exceptions). Sort → prepend `HashKey=` → append `&HashIV=` →
  encode → lowercase → SHA256 → uppercase.
- **ReturnURL** (`POST /api/orders/ecpay/notify`) verifies the MAC, flips
  the order to `PAID`, kicks off E-Invoice issuance, and replies with the
  literal `1|OK` body ECPay requires.
- **OrderResultURL** (`POST /api/orders/ecpay/result`) is the user-facing
  bounce-back; we redirect them to `/account.html`.
- **ATM / CVS** payment info (virtual account / code) is captured from the
  `PaymentInfoURL` callback and surfaced in the member's order list.
- **E-Invoice**: [src/lib/invoice.js](src/lib/invoice.js) implements ECPay's
  AES-128-CBC envelope. When `customerIdentifier` (統編) is non-empty, it
  issues a triplicate B2B invoice with `Print=1`; otherwise a B2C duplicate.

## LINE integration

- **LINE Login** (OAuth 2.0): users click "使用 LINE 登入" on `/login.html`;
  see [src/routes/auth.js](src/routes/auth.js) `/line/start` and
  `/line/callback`.
- **Notifications**: `LINE Notify` shut down 2025-03-31. We use the LINE
  Messaging API push endpoint instead. Members must add the channel's
  Official Account as a friend for pushes to arrive — see
  [src/lib/line.js](src/lib/line.js) `pushLineMessage`.

## What you need to plug in before going live

- ECPay production MerchantID/HashKey/HashIV (payments + invoicing — these
  are two different credentials)
- LINE Login channel credentials (`LINE_LOGIN_CHANNEL_ID`/`_SECRET`) from
  https://developers.line.biz/console/
- LINE Messaging API channel access token for push notifications
- SMTP credentials (or swap `nodemailer` for SES/Mailgun)
- Replace `localhost:3000` URLs in `.env` with your real domain; ECPay must
  be able to reach your `ReturnURL` over HTTPS.

## RBAC

| Role | Capabilities |
|---|---|
| GUEST | Browse landing & SKU list (no prices) |
| MEMBER (PENDING) | Can log in; sees own profile only |
| MEMBER (APPROVED) | Sees tier-appropriate prices, places orders |
| SALES | Approve/reject member verifications, set tier |
| FINANCE | View all orders + payment status |
| WAREHOUSE | Mark orders shipped, attach tracking numbers |
| MANAGER | All of the above |

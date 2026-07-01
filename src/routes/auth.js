import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { signSession, setSessionCookie, SESSION_MAX_AGE_MS, requireAuth } from '../middleware/auth.js';
import { getUserPermissions } from '../lib/permissions.js';
import { sendMail } from '../lib/mailer.js';
import { getSetting } from '../lib/settings.js';
import { buildLineLoginUrl, exchangeLineCode, fetchLineProfile } from '../lib/line.js';
import { buildGoogleLoginUrl, exchangeGoogleCode, fetchGoogleProfile } from '../lib/google.js';

export const authRouter = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().optional(),
  medicalLicenseNo: z.string().min(3),
  clinicName: z.string().min(1),
  clinicAddress: z.string().optional(),
  taxId: z.string().regex(/^\d{8}$/).optional(),
  companyTitle: z.string().optional(),
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return res.status(409).json({ error: 'email_exists' });

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 10),
      name: data.name,
      phone: data.phone,
      role: 'MEMBER',
      tier: 'BRONZE',
      // New accounts are inactive until an admin ticks 審核已通過.
      // Login endpoint returns account_disabled while isActive=false.
      isActive: false,
      verificationStatus: 'PENDING',
      medicalLicenseNo: data.medicalLicenseNo,
      clinicName: data.clinicName,
      clinicAddress: data.clinicAddress,
      taxId: data.taxId,
      companyTitle: data.companyTitle,
    },
  });

  res.json({ ok: true, message: '註冊成功，等待身份審核', userId: user.id });
});

// OAuth completion: Google callback lands NEW users on /register.html?flow=google
// where they fill in 負責人姓名 and submit here. Account is created inactive.
const oauthRegisterSchema = z.object({
  provider: z.enum(['google', 'line']),
  sub: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
});
authRouter.post('/register/oauth', async (req, res) => {
  const parsed = oauthRegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const { provider, sub, email, name } = parsed.data;

  // Reject if the sub or email is already claimed by another account.
  const byOauth = await prisma.user.findFirst({ where: provider === 'google' ? { googleId: sub } : { lineUserId: sub } });
  if (byOauth) return res.status(409).json({ error: 'account_exists' });
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) return res.status(409).json({ error: 'email_exists' });

  const user = await prisma.user.create({
    data: {
      email, name,
      role: 'MEMBER', tier: 'BRONZE',
      isActive: false, verificationStatus: 'PENDING',
      ...(provider === 'google' ? { googleId: sub } : { lineUserId: sub }),
    },
  });
  res.json({ ok: true, userId: user.id, message: '申請已送出，等待審核' });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!user.isActive) return res.status(403).json({ error: 'account_disabled' });
  setSessionCookie(res, signSession(user));
  res.json({
    ok: true,
    user: {
      id: user.id, email: user.email, name: user.name,
      role: user.role, tier: user.tier,
      verificationStatus: user.verificationStatus,
      isSuperAdmin: user.isSuperAdmin,
      staffRoleId: user.staffRoleId,
    },
  });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie('session').json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const { id, email, name, phone, role, tier, verificationStatus,
          medicalLicenseNo, clinicName, clinicAddress,
          taxId, companyTitle, lineUserId, pendingEmail,
          canMonthlyPay,
          isSuperAdmin, isActive, staffRoleId, staffRole } = req.user;
  const permissions = [...await getUserPermissions(req.user)];
  res.json({
    user: { id, email, name, phone, role, tier, verificationStatus,
            medicalLicenseNo, clinicName, clinicAddress, taxId, companyTitle,
            lineLinked: !!lineUserId,
            pendingEmail, canMonthlyPay,
            isSuperAdmin, isActive, staffRoleId,
            staffRoleName: staffRole?.name ?? null,
            permissions },
  });
});

// LINE Login — supports a "link" mode that associates the LINE account with
// the currently signed-in user instead of finding/creating one.
authRouter.get('/line/start', async (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('line_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  if (req.query.link === '1' && req.user) {
    res.cookie('line_link_user_id', req.user.id, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  }
  res.redirect(await buildLineLoginUrl(state));
});

authRouter.get('/line/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.cookies?.line_state) {
      return res.status(400).send('Invalid LINE state.');
    }
    const tokenResp = await exchangeLineCode(code);
    const profile = await fetchLineProfile(tokenResp.access_token);

    const linkUserId = req.cookies?.line_link_user_id;
    if (linkUserId) {
      const conflict = await prisma.user.findUnique({ where: { lineUserId: profile.userId } });
      if (conflict && conflict.id !== linkUserId) {
        res.clearCookie('line_link_user_id').clearCookie('line_state');
        return res.redirect('/account.html?lineErr=already_linked');
      }
      await prisma.user.update({
        where: { id: linkUserId },
        data: { lineUserId: profile.userId },
      });
      return res.clearCookie('line_link_user_id').clearCookie('line_state')
                .redirect('/account.html?lineOk=1');
    }

    let user = await prisma.user.findUnique({ where: { lineUserId: profile.userId } });
    if (!user) {
      // NEW LINE user: send to completion form; account created on submit.
      res.clearCookie('line_state');
      const params = new URLSearchParams({
        flow: 'line',
        sub: profile.userId,
        email: `${profile.userId}@line.local`,
        name: profile.displayName || '',
      });
      return res.redirect('/register.html?' + params.toString());
    }
    if (!user.isActive) {
      res.clearCookie('line_state');
      return res.redirect('/login.html?pending=1');
    }
    setSessionCookie(res, signSession(user));
    res.clearCookie('line_state')
       .redirect(user.verificationStatus === 'APPROVED' ? '/shop.html' : '/account.html?verify=1');
  } catch (err) {
    console.error(err);
    res.status(500).send('LINE login failed.');
  }
});

// ----- Google OAuth -----
authRouter.get('/google/start', async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('google_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
    if (req.query.link === '1' && req.user) {
      res.cookie('google_link_user_id', req.user.id, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
    }
    res.redirect(await buildGoogleLoginUrl(state));
  } catch (e) {
    res.status(500).send('Google login not configured. 請聯絡管理員設定 Google OAuth。');
  }
});

authRouter.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.cookies?.google_state) {
      return res.status(400).send('Invalid Google state.');
    }
    const tokenResp = await exchangeGoogleCode(code);
    const profile = await fetchGoogleProfile(tokenResp.access_token);
    if (!profile?.sub) return res.status(400).send('Google profile missing sub.');

    const linkUserId = req.cookies?.google_link_user_id;
    if (linkUserId) {
      const conflict = await prisma.user.findUnique({ where: { googleId: profile.sub } });
      if (conflict && conflict.id !== linkUserId) {
        res.clearCookie('google_link_user_id').clearCookie('google_state');
        return res.redirect('/account.html?googleErr=already_linked');
      }
      await prisma.user.update({ where: { id: linkUserId }, data: { googleId: profile.sub } });
      return res.clearCookie('google_link_user_id').clearCookie('google_state')
                .redirect('/account.html?googleOk=1');
    }

    // Find by googleId first, fall back to matching email (auto-link existing accounts).
    let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user && profile.email) {
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: profile.sub },
        });
      }
    }
    if (!user) {
      // NEW user: send them to the completion form. Account is not created
      // yet — /api/auth/register/oauth handles creation once they submit 姓名.
      res.clearCookie('google_state');
      const params = new URLSearchParams({
        flow: 'google',
        sub: profile.sub,
        email: profile.email || `${profile.sub}@google.local`,
        name: profile.name || profile.email?.split('@')[0] || '',
      });
      return res.redirect('/register.html?' + params.toString());
    }
    // Existing user — sign in if active, else block.
    if (!user.isActive) {
      res.clearCookie('google_state');
      return res.redirect('/login.html?pending=1');
    }
    setSessionCookie(res, signSession(user));
    res.clearCookie('google_state')
       .redirect(user.verificationStatus === 'APPROVED' ? '/shop.html' : '/account.html?verify=1');
  } catch (err) {
    console.error('[google/callback]', err);
    res.status(500).send('Google login failed.');
  }
});

// ----- Forgot password (email OTP) -----
// Flow: POST /password/forgot → 6-digit OTP emailed; POST /password/reset → verify + set.
// Security:
//   - Always returns 200 so attackers can't enumerate registered emails.
//   - OTP is 6 digits, 15-min expiry, hashed in DB (bcrypt).
//   - Max 5 verification attempts before invalidating the OTP.

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema  = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8),
});

authRouter.post('/password/forgot', async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Return success even if no user — don't leak account existence.
  if (!user || !user.isActive) return res.json({ ok: true });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetOtpHash: await bcrypt.hash(otp, 10),
      resetOtpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      resetOtpAttempts: 0,
    },
  });

  try {
    await sendMail({
      to: email,
      subject: '【資生國際 Shisei Dental】密碼重設驗證碼',
      text: `您正在重設密碼。\n\n驗證碼：${otp}\n\n此驗證碼 15 分鐘內有效。若非您本人操作請忽略此郵件並考慮變更密碼。`,
      html: `<p>您正在重設 資生國際 Shisei Dental 會員密碼。</p>
             <p style="font-size:28px;font-weight:800;letter-spacing:.4em;background:#f1f5f9;padding:16px 24px;border-radius:8px;display:inline-block;">${otp}</p>
             <p style="color:#64748b;font-size:13px;">此驗證碼 <b>15 分鐘</b>內有效。若非您本人操作請忽略此郵件並考慮變更密碼。</p>`,
    });
  } catch (err) {
    console.error('[password/forgot] mail send failed:', err);
  }
  res.json({ ok: true });
});

authRouter.post('/password/reset', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { email, otp, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt) {
    return res.status(400).json({ error: 'invalid_or_expired' });
  }
  if (user.resetOtpExpiresAt < new Date()) {
    await prisma.user.update({ where: { id: user.id },
      data: { resetOtpHash: null, resetOtpExpiresAt: null, resetOtpAttempts: 0 } });
    return res.status(400).json({ error: 'invalid_or_expired' });
  }
  if (user.resetOtpAttempts >= 5) {
    await prisma.user.update({ where: { id: user.id },
      data: { resetOtpHash: null, resetOtpExpiresAt: null, resetOtpAttempts: 0 } });
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const ok = await bcrypt.compare(otp, user.resetOtpHash);
  if (!ok) {
    await prisma.user.update({ where: { id: user.id },
      data: { resetOtpAttempts: { increment: 1 } } });
    return res.status(400).json({ error: 'invalid_or_expired' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      resetOtpHash: null, resetOtpExpiresAt: null, resetOtpAttempts: 0,
    },
  });
  res.json({ ok: true });
});

// ----- Self-service profile -----

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  clinicName: z.string().optional().nullable(),
  clinicAddress: z.string().optional().nullable(),
  taxId: z.string().regex(/^\d{8}$/).optional().or(z.literal('')).nullable(),
  companyTitle: z.string().optional().nullable(),
});

authRouter.put('/me/profile', requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const d = parsed.data;
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
      ...(d.clinicName !== undefined ? { clinicName: d.clinicName || null } : {}),
      ...(d.clinicAddress !== undefined ? { clinicAddress: d.clinicAddress || null } : {}),
      ...(d.taxId !== undefined ? { taxId: d.taxId || null } : {}),
      ...(d.companyTitle !== undefined ? { companyTitle: d.companyTitle || null } : {}),
    },
  });
  res.json({ ok: true });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post('/me/password', requireAuth, async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { currentPassword, newPassword } = parsed.data;
  if (!req.user.passwordHash || !(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
    return res.status(401).json({ error: 'current_password_wrong' });
  }
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  res.json({ ok: true });
});

// Email change: request → email with link → verify
const emailReqSchema = z.object({
  newEmail: z.string().email(),
  currentPassword: z.string().optional(),
});

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

authRouter.post('/me/email/request', requireAuth, async (req, res) => {
  const parsed = emailReqSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { newEmail, currentPassword } = parsed.data;

  // Password not required for LINE-only users without one
  if (req.user.passwordHash) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
      return res.status(401).json({ error: 'current_password_wrong' });
    }
  }
  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing && existing.id !== req.user.id) {
    return res.status(409).json({ error: 'email_in_use' });
  }

  const tokenPlain = crypto.randomBytes(32).toString('hex');
  const tokenHash  = sha256(tokenPlain);
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      pendingEmail: newEmail,
      pendingEmailTokenHash: tokenHash,
      pendingEmailExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const appUrl = await getSetting('APP_URL');
  const link = `${appUrl.replace(/\/$/, '')}/api/auth/me/email/verify?token=${tokenPlain}`;
  try {
    await sendMail({
      to: newEmail,
      subject: '【資生國際 Shisei Dental】請驗證您的新 Email',
      text: `您正在變更 資生國際 Shisei Dental 會員 Email。\n\n請點擊下方連結完成驗證 (24 小時內有效)：\n\n${link}\n\n若非您本人操作請忽略此郵件。`,
      html: `<p>您正在變更 資生國際 Shisei Dental 會員 Email。請點擊下方連結完成驗證 (24 小時內有效)：</p>
             <p><a href="${link}">${link}</a></p><p>若非您本人操作請忽略此郵件。</p>`,
    });
  } catch (err) {
    console.error('[email/request] mail send failed:', err);
  }
  res.json({ ok: true, message: '驗證信已寄至新 Email' });
});

authRouter.get('/me/email/verify', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('連結無效');
  const hash = sha256(String(token));
  const user = await prisma.user.findFirst({
    where: {
      pendingEmailTokenHash: hash,
      pendingEmailExpiresAt: { gt: new Date() },
    },
  });
  if (!user || !user.pendingEmail) {
    return res.status(400).send('連結無效或已過期。');
  }
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: user.pendingEmail,
        pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpiresAt: null,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).send('此 Email 已被其他帳號使用。');
    throw e;
  }
  res.redirect('/account.html?emailUpdated=1');
});

// Yearly spend + progress toward next tier / retention
authRouter.get('/me/tier-progress', requireAuth, async (req, res) => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const agg = await prisma.order.aggregate({
    _sum: { total: true },
    where: {
      userId: req.user.id,
      status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      createdAt: { gte: yearStart },
    },
  });
  const spend = agg._sum.total ?? 0;
  const currentTier = await prisma.tier.findUnique({ where: { code: req.user.tier } });
  const nextTier = currentTier?.nextTierCode
    ? await prisma.tier.findUnique({ where: { code: currentTier.nextTierCode } })
    : null;
  res.json({
    year: now.getFullYear(),
    yearlySpend: spend,
    currentTier: currentTier ? { code: currentTier.code, nameZh: currentTier.nameZh } : null,
    nextTier: nextTier ? {
      code: nextTier.code, nameZh: nextTier.nameZh,
      threshold: currentTier?.yearlyUpgradeThreshold ?? null,
      remaining: currentTier?.yearlyUpgradeThreshold != null
        ? Math.max(0, currentTier.yearlyUpgradeThreshold - spend)
        : null,
    } : null,
    retain: currentTier?.yearlyRetainThreshold != null ? {
      threshold: currentTier.yearlyRetainThreshold,
      remaining: Math.max(0, currentTier.yearlyRetainThreshold - spend),
      onTrack: spend >= currentTier.yearlyRetainThreshold,
    } : null,
  });
});

authRouter.post('/me/line/unlink', requireAuth, async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { lineUserId: null },
  });
  res.json({ ok: true });
});

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getUserPermissions } from '../lib/permissions.js';

// Re-export so route files have a single import surface.
export { requirePermission } from '../lib/permissions.js';

// Session lifetime: 2 hours from last activity. Cookie is also re-issued on
// every authenticated /api/* request so an active user stays logged in
// across page navigations, but idle > 2h forces re-login.
export const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function signSession(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, tier: user.tier },
    config.jwtSecret,
    { expiresIn: '2h' }
  );
}

export function setSessionCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true, sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

// Attach req.user (with staffRole eager-loaded) when a session cookie is
// present. On API activity, renew the cookie so the session slides forward.
export async function attachUser(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { staffRole: true },
    });
    if (user) {
      req.user = user;
      if (req.path.startsWith('/api/')) {
        setSessionCookie(res, signSession(user));
      }
    }
  } catch { /* expired or invalid: stay anonymous; client should re-login */ }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

// "Verified Member" — only these users see prices and can place orders.
export function requireVerifiedMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.verificationStatus !== 'APPROVED') {
    return res.status(403).json({ error: 'member_not_verified' });
  }
  next();
}

// Legacy role check — only used by routes that haven't been migrated yet.
// Superadmin always passes; otherwise user's `role` string must match.
export function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!req.user.isActive) return res.status(403).json({ error: 'account_disabled' });
    if (req.user.isSuperAdmin) return next();
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
}

import { prisma } from '../db.js';

// Atomic permissions exposed in the admin UI. Group is for form display only.
export const PERMISSIONS = [
  // 商品
  { key: 'catalog.view',            group: '商品', label: '查看商品 / 分類' },
  { key: 'catalog.products.edit',   group: '商品', label: '新增 / 編輯 / 下架商品' },
  { key: 'catalog.categories.edit', group: '商品', label: '新增 / 編輯分類' },
  { key: 'catalog.brands.edit',     group: '商品', label: '新增 / 編輯品牌' },
  { key: 'banners.edit',            group: '商品', label: '首頁橫幅 (Banner)' },
  { key: 'bundles.edit',            group: '商品', label: '團購優惠 (Bundle)' },
  { key: 'media.view',              group: '商品', label: '查看媒體庫' },
  { key: 'media.upload',            group: '商品', label: '上傳檔案' },
  { key: 'media.delete',            group: '商品', label: '刪除媒體' },
  // 訂單
  { key: 'orders.view',             group: '訂單', label: '查看訂單' },
  { key: 'orders.ship',             group: '訂單', label: '出貨 / 物流' },
  { key: 'orders.refund',           group: '訂單', label: '退款' },
  // 會員
  { key: 'members.view',            group: '會員', label: '查看會員' },
  { key: 'members.verify',          group: '會員', label: '審核會員身份' },
  { key: 'members.tier.edit',       group: '會員', label: '調整會員等級' },
  { key: 'customers.edit',          group: '會員', label: '客戶管理 (月繳資格等)' },
  { key: 'leads.view',              group: '會員', label: '客戶來電紀錄' },
  // 行銷
  { key: 'vouchers.view',           group: '行銷', label: '查看優惠券' },
  { key: 'vouchers.create',         group: '行銷', label: '新增優惠券' },
  { key: 'vouchers.edit',           group: '行銷', label: '編輯優惠券' },
  { key: 'vouchers.delete',         group: '行銷', label: '刪除優惠券' },
  { key: 'vouchers.tier_link',      group: '行銷', label: '設定優惠券對應等級' },
  // 內容
  { key: 'pages.view',              group: '內容', label: '查看頁面' },
  { key: 'pages.create',            group: '內容', label: '新增頁面' },
  { key: 'pages.edit',              group: '內容', label: '編輯頁面' },
  { key: 'pages.delete',            group: '內容', label: '刪除頁面' },
  { key: 'nav.edit',                group: '內容', label: '編輯主選單' },
  { key: 'content.edit',            group: '內容', label: '編輯網站文案' },
  // 系統
  { key: 'tiers.edit',              group: '系統', label: '會員等級設定' },
  { key: 'settings.edit',           group: '系統', label: '系統設定 (ECPay / LINE / SMTP)' },
  { key: 'staff.view',              group: '系統', label: '查看員工' },
  { key: 'staff.create',            group: '系統', label: '新增員工' },
  { key: 'staff.edit',              group: '系統', label: '編輯員工' },
  { key: 'staff.delete',            group: '系統', label: '停用員工' },
  { key: 'staff.role.edit',         group: '系統', label: '管理角色與權限' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Legacy role → permission mapping (back-compat with existing seeded users).
// New users will use the staffRoleId path; these old role names still work.
const LEGACY_ROLE_PERMISSIONS = {
  MANAGER:   ALL_PERMISSION_KEYS,
  SALES: [
    'catalog.view', 'catalog.products.edit', 'catalog.categories.edit',
    'media.view', 'media.upload',
    'members.view', 'members.verify',
    'pages.view', 'pages.edit', 'content.edit',
  ],
  FINANCE: [
    'orders.view', 'orders.refund',
    'vouchers.view',
  ],
  WAREHOUSE: [
    'orders.view', 'orders.ship',
    'catalog.view',
  ],
};

// Small per-process cache so we don't hit the DB on every permission check
const permCache = new Map();
export function bustPermissionCache(userId) {
  if (userId) permCache.delete(userId); else permCache.clear();
}

export async function getUserPermissions(user) {
  if (!user) return new Set();
  if (user.isSuperAdmin) return new Set(ALL_PERMISSION_KEYS);

  const cached = permCache.get(user.id);
  if (cached) return cached;

  let perms = new Set(LEGACY_ROLE_PERMISSIONS[user.role] ?? []);
  if (user.staffRoleId) {
    const role = await prisma.staffRole.findUnique({ where: { id: user.staffRoleId } });
    if (role) for (const p of (role.permissions ?? '').split(',').filter(Boolean)) perms.add(p);
  }
  permCache.set(user.id, perms);
  return perms;
}

// Any-of: pass needed permissions; user must have at least one.
export function requirePermission(...needed) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!req.user.isActive) return res.status(403).json({ error: 'account_disabled' });
    const perms = await getUserPermissions(req.user);
    const ok = needed.some((p) => perms.has(p));
    if (!ok) return res.status(403).json({ error: 'forbidden', needed });
    next();
  };
}

// Helper used by /api/auth/me so the frontend can hide buttons it lacks perms for.
export async function describeUserPermissions(user) {
  const perms = await getUserPermissions(user);
  return [...perms];
}

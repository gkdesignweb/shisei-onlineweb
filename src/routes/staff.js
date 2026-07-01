import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { PERMISSIONS, ALL_PERMISSION_KEYS, bustPermissionCache } from '../lib/permissions.js';

export const staffRouter = express.Router();

// ----- Staff users -----
const staffSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).optional(),
  staffRoleId: z.string().optional().nullable(),
  isSuperAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

staffRouter.get('/staff', requirePermission('staff.view'), async (req, res) => {
  const users = await prisma.user.findMany({
    where: { OR: [{ isSuperAdmin: true }, { staffRoleId: { not: null } },
                   { role: { in: ['MANAGER', 'SALES', 'FINANCE', 'WAREHOUSE', 'STAFF'] } }] },
    include: { staffRole: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    users: users.map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      isSuperAdmin: u.isSuperAdmin, isActive: u.isActive,
      staffRole: u.staffRole, createdAt: u.createdAt,
    })),
  });
});

staffRouter.post('/staff', requirePermission('staff.create'), async (req, res) => {
  const parsed = staffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const d = parsed.data;
  if (!d.password) return res.status(400).json({ error: 'password_required' });
  try {
    const user = await prisma.user.create({
      data: {
        email: d.email,
        name: d.name,
        passwordHash: await bcrypt.hash(d.password, 10),
        role: 'STAFF',
        verificationStatus: 'APPROVED',
        staffRoleId: d.staffRoleId || null,
        isSuperAdmin: d.isSuperAdmin ?? false,
        isActive: d.isActive ?? true,
      },
    });
    res.json({ user: { id: user.id, email: user.email } });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'email_exists' });
    throw e;
  }
});

staffRouter.put('/staff/:id', requirePermission('staff.edit'), async (req, res) => {
  const parsed = staffSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  const data = { ...d };
  delete data.password;
  if (d.password) data.passwordHash = await bcrypt.hash(d.password, 10);
  if (d.staffRoleId === '') data.staffRoleId = null;
  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  bustPermissionCache(user.id);
  res.json({ ok: true });
});

staffRouter.delete('/staff/:id', requirePermission('staff.delete'), async (req, res) => {
  // Soft delete — flip isActive off so existing references stay valid.
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot_disable_self' });
  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
  bustPermissionCache(req.params.id);
  res.json({ ok: true });
});

// ----- Staff roles -----
const roleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  permissions: z.array(z.string()).default([]),
});

staffRouter.get('/staff-roles/permissions', requirePermission('staff.view'), (req, res) => {
  res.json({ permissions: PERMISSIONS });
});

staffRouter.get('/staff-roles', requirePermission('staff.view'), async (req, res) => {
  const roles = await prisma.staffRole.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { users: true } } },
  });
  res.json({
    roles: roles.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      permissions: (r.permissions ?? '').split(',').filter(Boolean),
      isSystem: r.isSystem, userCount: r._count.users,
    })),
  });
});

staffRouter.post('/staff-roles', requirePermission('staff.role.edit'), async (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  const valid = d.permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p));
  try {
    const role = await prisma.staffRole.create({
      data: {
        name: d.name,
        description: d.description ?? null,
        permissions: valid.join(','),
      },
    });
    res.json({ role });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'name_exists' });
    throw e;
  }
});

staffRouter.put('/staff-roles/:id', requirePermission('staff.role.edit'), async (req, res) => {
  const parsed = roleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  const data = { ...d };
  if (d.permissions) data.permissions = d.permissions
    .filter((p) => ALL_PERMISSION_KEYS.includes(p)).join(',');
  const role = await prisma.staffRole.update({ where: { id: req.params.id }, data });
  bustPermissionCache(); // any user of this role needs fresh permissions
  res.json({ role });
});

staffRouter.delete('/staff-roles/:id', requirePermission('staff.role.edit'), async (req, res) => {
  const role = await prisma.staffRole.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) return res.status(404).json({ error: 'not_found' });
  if (role.isSystem) return res.status(409).json({ error: 'system_role_cannot_delete' });
  if (role._count.users > 0) return res.status(409).json({ error: 'role_in_use', userCount: role._count.users });
  await prisma.staffRole.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

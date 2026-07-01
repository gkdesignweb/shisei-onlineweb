import express from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { bustPermissionCache } from '../lib/permissions.js';

export const customersRouter = express.Router();

customersRouter.get('/', requirePermission('customers.edit', 'members.view'), async (req, res) => {
  const where = { role: 'MEMBER' };
  const { q, tier, status, monthly } = req.query;
  if (tier)   where.tier = String(tier);
  if (status) where.verificationStatus = String(status);
  if (monthly === '1') where.canMonthlyPay = true;
  if (q) {
    const term = String(q);
    where.OR = [
      { email:      { contains: term } },
      { name:       { contains: term } },
      { clinicName: { contains: term } },
      { taxId:      { contains: term } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, phone: true,
      clinicName: true, taxId: true, companyTitle: true,
      tier: true, verificationStatus: true, canMonthlyPay: true,
      isActive: true, lineUserId: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ users });
});

// Single-customer GET — full profile for the edit modal
customersRouter.get('/:id', requirePermission('customers.edit', 'members.view'), async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, email: true, name: true, phone: true,
      medicalLicenseNo: true, clinicName: true, clinicAddress: true,
      taxId: true, companyTitle: true,
      tier: true, verificationStatus: true, canMonthlyPay: true,
      isActive: true, lineUserId: true, createdAt: true,
    },
  });
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({ user: u });
});

const baseProfileFields = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  medicalLicenseNo: z.string().optional().nullable(),
  clinicName: z.string().optional().nullable(),
  clinicAddress: z.string().optional().nullable(),
  taxId: z.string().regex(/^\d{8}$/).optional().nullable().or(z.literal('')),
  companyTitle: z.string().optional().nullable(),
  tier: z.string().optional(),
  verificationStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  canMonthlyPay: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const createSchema = baseProfileFields.extend({
  password: z.string().min(8),
});

const updateSchema = baseProfileFields.partial().extend({
  password: z.string().min(8).optional().or(z.literal('')),
});

// Admin opens an account on behalf of a customer
customersRouter.post('/', requirePermission('customers.edit'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const { password, ...d } = parsed.data;
  try {
    const user = await prisma.user.create({
      data: {
        ...d,
        taxId: d.taxId || null,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'MEMBER',
        verificationStatus: d.verificationStatus ?? 'APPROVED',
        tier: d.tier ?? 'BRONZE',
        isActive: d.isActive ?? true,
      },
    });
    res.json({ user: { id: user.id, email: user.email } });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'email_exists' });
    throw e;
  }
});

customersRouter.put('/:id', requirePermission('customers.edit'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues });
  const { password, ...d } = parsed.data;
  // Normalize empty string → null for nullable fields
  for (const k of ['phone', 'medicalLicenseNo', 'clinicName', 'clinicAddress', 'taxId', 'companyTitle']) {
    if (d[k] === '') d[k] = null;
  }
  const data = { ...d };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  // Unified 審核 semantics: verificationStatus and isActive move together.
  // - Setting verificationStatus=APPROVED implicitly activates the account.
  // - Setting verificationStatus=PENDING or REJECTED deactivates it.
  // Admin can still override isActive explicitly by sending it in the same payload.
  if (data.verificationStatus && data.isActive === undefined) {
    data.isActive = data.verificationStatus === 'APPROVED';
  }
  try {
    await prisma.user.update({ where: { id: req.params.id }, data });
    bustPermissionCache(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'email_exists' });
    if (e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw e;
  }
});

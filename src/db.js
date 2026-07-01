// Single shared Prisma client. Every route imports { prisma } from here so we
// reuse one connection pool to Supabase Postgres (datasource URL is in .env).
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

// Graceful shutdown so connections close cleanly during dev hot-reload.
process.on('beforeExit', async () => { await prisma.$disconnect(); });

// Author: Preston Lee

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

let prisma: PrismaClient | null = null;
let pool: pg.Pool | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const connectionString = process.env.CQL_STUDIO_SERVER_DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error('CQL_STUDIO_SERVER_DATABASE_URL is required to use the database');
    }
    pool = new pg.Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * @queuenow/db
 *
 * Single source of truth for database access in the monorepo. Owns the Prisma
 * schema, migrations, and client generation. Framework-agnostic on purpose —
 * any consumer (the NestJS API today, background workers/cron jobs tomorrow)
 * can build a client without depending on a web framework.
 */

// Re-export the generated Prisma Client, the `Prisma` namespace, model types,
// and all enums so consumers import everything from `@queuenow/db`.
export * from '@prisma/client';

// Re-export the node-postgres driver adapter (mandatory in Prisma 7) so
// consumers construct a client without depending on @prisma/adapter-pg directly.
export { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Builds a PrismaClient wired to PostgreSQL via the node-postgres adapter.
 *
 * @param connectionString PostgreSQL connection URL (e.g. `process.env.DATABASE_URL`)
 * @param log Optional Prisma log levels (defaults to errors only)
 */
export function createPrismaClient(
  connectionString: string,
  log: Array<'query' | 'info' | 'warn' | 'error'> = ['error'],
): PrismaClient {
  if (!connectionString) {
    throw new Error('createPrismaClient: connectionString is required');
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log,
  });
}

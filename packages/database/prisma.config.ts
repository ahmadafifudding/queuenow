import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 CLI configuration.
 *
 * The database connection URL now lives here instead of in `schema.prisma`.
 * At runtime, consumers build a client via `createPrismaClient()` (see
 * `src/index.ts`), which wires the `@prisma/adapter-pg` driver adapter.
 *
 * We read `process.env.DATABASE_URL` directly (rather than the throwing `env()`
 * helper) so commands that don't need a live database — e.g. `prisma generate`
 * during CI type-checking — don't fail when the variable is absent.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});

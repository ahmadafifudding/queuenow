/**
 * Lightweight `.env` loader for the e2e suites.
 *
 * The integration tests run against a REAL Postgres dev database. The Nest
 * `PrismaService` reads `process.env.DATABASE_URL` directly in its constructor,
 * so the variable must be present in `process.env` *before* the application is
 * bootstrapped. Jest does not load `.env` files automatically, so this setup
 * file parses `apps/api/.env(.test)` and copies any missing keys into
 * `process.env`.
 *
 * Behaviour:
 * - Existing `process.env` values are never overwritten (CI / shell wins).
 * - Missing `.env` files are ignored silently — when no `DATABASE_URL` ends up
 *   set, the e2e suites guard themselves with `describe.skip` so they degrade
 *   gracefully without a database rather than failing.
 *
 * We intentionally avoid a `dotenv` dependency (not resolvable in this package)
 * and parse the minimal `KEY=VALUE` format used by the project's `.env` files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvFile(filePath: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const content = readFileSync(filePath, 'utf8');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip matching surrounding quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function loadEnv(): void {
  const apiRoot = resolve(__dirname, '..');
  // `.env.test` takes precedence over `.env` when both are present.
  const candidates = [resolve(apiRoot, '.env.test'), resolve(apiRoot, '.env')];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    const values = parseEnvFile(filePath);
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

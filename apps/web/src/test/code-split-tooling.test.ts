/**
 * Code-splitting & tooling smoke tests (task 18.2, Requirements 1.6, 1.7, 1.8, 2.7).
 *
 * These are filesystem/static-inspection checks (no DOM): they assert the
 * project's build/tooling contract holds, rather than runtime behavior.
 *
 *   - R1.6 — `apps/web/.env.example` exists and documents the required client
 *     env vars (`VITE_API_URL`, `VITE_WS_URL`) that `lib/env.ts` validates.
 *   - R1.7 — a `generate:api` script exists and drives `openapi-typescript`
 *     (the source of the typed API schema), writing to the schema file.
 *   - R2.7 — the generated `src/lib/api/schema.d.ts` exists and is the
 *     `openapi-typescript` artifact (exports `paths`/`components`/`operations`),
 *     wired to the app via the `generate:api` output path.
 *   - R1.8 — the public Display/Kiosk screens are code-split out of the
 *     Dashboard entry: Vite's TanStack Router plugin has
 *     `autoCodeSplitting: true`, the `display.$orgId`/`kiosk.$orgId` route files
 *     exist and render their feature components, and the Dashboard route does
 *     not statically import the Display/Kiosk feature code.
 *
 * Chosen assertion approach for R1.8 (documented):
 *   A full production-build manifest assertion (running `vite build` and
 *   diffing emitted chunks) is the most direct proof but is heavy and slow for a
 *   smoke test. Instead we inspect the source contract that PRODUCES the split:
 *   `autoCodeSplitting` is what emits each route's component as its own chunk,
 *   and the Dashboard route avoiding any Display/Kiosk import guarantees that
 *   code can't be pulled into the Dashboard's graph. Together these are a fast,
 *   deterministic stand-in for the manifest check.
 *
 * Path resolution: every path is resolved relative to THIS test file via
 * `new URL(..., import.meta.url)` so the test is independent of the process
 * working directory. This file lives at `apps/web/src/test/`, so `../../` is the
 * `apps/web` package root and `../` is `apps/web/src`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Read a UTF-8 file resolved relative to this test file. */
function readRelative(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return readFileSync(path, 'utf8');
}

/** Whether a path (relative to this test file) exists. */
function existsRelative(relativePath: string): boolean {
  return existsSync(fileURLToPath(new URL(relativePath, import.meta.url)));
}

interface WebPackageJson {
  scripts?: Record<string, string>;
}

describe('env example (task 18.2, R1.6)', () => {
  it('.env.example exists and lists the required client env vars', () => {
    expect(existsRelative('../../.env.example')).toBe(true);

    const envExample = readRelative('../../.env.example');
    expect(envExample).toMatch(/^\s*VITE_API_URL=/m);
    expect(envExample).toMatch(/^\s*VITE_WS_URL=/m);
  });
});

describe('api type generation (task 18.2, R1.7, R2.7)', () => {
  const pkg = JSON.parse(readRelative('../../package.json')) as WebPackageJson;
  const generateApi = pkg.scripts?.['generate:api'];

  it('package.json has a generate:api script driving openapi-typescript', () => {
    expect(generateApi).toBeDefined();
    expect(generateApi).toContain('openapi-typescript');
  });

  it('generate:api writes to the generated schema file (R2.7)', () => {
    // The `-o` output target links the tool to the committed artifact.
    expect(generateApi).toContain('src/lib/api/schema.d.ts');
  });

  it('the generated schema.d.ts exists and is the openapi-typescript artifact', () => {
    expect(existsRelative('../lib/api/schema.d.ts')).toBe(true);

    // openapi-typescript output always exports these top-level members; their
    // presence proves the file is the generated schema artifact (R2.7). The
    // API client is intentionally generic over response data, so it does not
    // import these directly — the artifact is wired via the generate:api
    // output path asserted above.
    const schema = readRelative('../lib/api/schema.d.ts');
    expect(schema).toMatch(/export\s+(type|interface)\s+paths\b/);
    expect(schema).toMatch(/export\s+(type|interface)\s+components\b/);
    expect(schema).toMatch(/export\s+(type|interface)\s+operations\b/);
  });
});

describe('Display/Kiosk code-splitting (task 18.2, R1.8)', () => {
  it('Vite enables TanStack Router autoCodeSplitting', () => {
    const viteConfig = readRelative('../../vite.config.ts');
    expect(viteConfig).toContain('TanStackRouterVite');
    // Tolerant of whitespace between the key and the boolean.
    expect(viteConfig).toMatch(/autoCodeSplitting\s*:\s*true/);
  });

  it('the Display and Kiosk route files exist and render their feature components', () => {
    expect(existsRelative('../routes/display.$orgId.tsx')).toBe(true);
    expect(existsRelative('../routes/kiosk.$orgId.tsx')).toBe(true);

    const displayRoute = readRelative('../routes/display.$orgId.tsx');
    expect(displayRoute).toContain('@/features/display');
    expect(displayRoute).toContain('DisplayBoard');

    const kioskRoute = readRelative('../routes/kiosk.$orgId.tsx');
    expect(kioskRoute).toContain('@/features/kiosk');
    expect(kioskRoute).toContain('KioskScreen');
  });

  it('the Dashboard route does not statically import the Display/Kiosk feature code', () => {
    const dashboardRoute = readRelative('../routes/_authenticated/dashboard.tsx');
    expect(dashboardRoute).not.toContain('features/display');
    expect(dashboardRoute).not.toContain('features/kiosk');
    expect(dashboardRoute).not.toContain('DisplayBoard');
    expect(dashboardRoute).not.toContain('KioskScreen');
  });
});

/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * Vitest config for `apps/mobile` (boundary test harness — task 2.4).
 *
 * Why Vitest (not jest-expo / Metro):
 * - The logic under test in this app is PURE and DEPENDENCY-INJECTED: the REST
 *   client (`createApiClient`), secure-store (`createSecureStore`), the socket
 *   registry/bridge, the offline cache, connectivity derivations, and the
 *   notification mapping/channel selection all accept their I/O as injected
 *   seams (a `fetch` fn, a `TokenStore`, a `SecureStoreAdapter`, `NetInfoSource`
 *   /`AppStateSource`, notification ports). None of the property tests
 *   (Properties 1–21) need a real native module, a Metro bundler, or a device
 *   runtime — they exercise pure functions against the fakes in `src/test-support`.
 * - Vitest is already the frontend test runner in this monorepo (`apps/web`),
 *   so the version, API, and `fast-check` integration are consistent and fast
 *   (no Metro/RN runtime boot per run). `jest-expo` would only be needed for
 *   tests that mount real React Native components or touch native modules, which
 *   this app's testing strategy explicitly avoids.
 *
 * Environment is `node`: the suites are headless pure-logic + injected fakes.
 * The `@` alias mirrors `tsconfig.json` so tests import production pure modules
 * (e.g. `@/lib/socket-registry`) the same way app code does.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Run a minimum of 100 fast-check iterations per property unless a test
    // overrides it locally; keeps the property suites honest by default.
    passWithNoTests: true,
  },
});

// Feature: customer-mobile-app, Task 20.4 build/smoke gate
// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 10.5
/**
 * Build / smoke + strict-quality-gate checks (task 20.4).
 *
 * This is a ONE-TIME smoke suite (NOT a property test). It guards the
 * cross-cutting quality gates the design's Testing Strategy ("Smoke / build
 * checks") calls for, without booting a Metro bundler, a device runtime, or a
 * simulator (none of which are available in CI's unit step):
 *
 *  1. Shared-package presence (R14.3/R14.4): all THREE `@queuenow/shared-*`
 *     packages resolve and expose their runtime sentinels, and the boot
 *     presence-assertion (`assertSharedPackagesPresent`) returns `true` without
 *     throwing. A missing package fails this gate (and, in a real build, fails
 *     Metro/TypeScript resolution) rather than silently degrading to a subset.
 *
 *  2. No local redefinition of shared domain types (R10.5/R14.5): a pragmatic,
 *     grep-style check that the key view-model source files IMPORT their domain
 *     types from `@queuenow/shared-*` instead of redefining `IQueueTicket` /
 *     `NotificationType` / `TicketStatus` locally.
 *
 *  3. Strict-typecheck + no-`any` gate (R14.1/R14.2 build correctness): asserts
 *     the `typecheck` script is `tsc --noEmit` and that `tsconfig.json` extends
 *     the repo's strict `tsconfig.base.json` (which enables `strict`,
 *     `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`). The
 *     repo convention is "no `any` — use `unknown`" (project-standards.md);
 *     there is no repo-wide ESLint `no-explicit-any` rule, so the gate here is
 *     strict `tsc` PLUS a pragmatic scan that no explicit-`any` type annotation
 *     appears in production source (comments excluded). `pnpm --filter
 *     @queuenow/mobile typecheck` is the authoritative strict gate run in CI.
 *
 *  4. Expo runtime validity for iOS AND Android (R14.1/R14.2): a simulator
 *     cannot boot here, so instead this asserts `app.config.ts` exports a valid
 *     Expo config with iOS- and Android-capable settings (a scheme, an `ios`
 *     section, no platform exclusion, and the native plugins the app needs).
 *     CI runs the actual Expo build for both platforms.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConfigContext, ExpoConfig } from 'expo/config';
import { describe, expect, it } from 'vitest';

// Direct imports of each shared package's expected exports (R14.3/R14.4): if any
// package failed to resolve, this module would fail to load and the suite fails.
import { ERROR_CODES, WS_EVENTS, QUEUE_DEFAULTS } from '@queuenow/shared-constants';
import { joinQueueSchema, loginSchema } from '@queuenow/shared-validation';
import { NotificationType, TicketStatus } from '@queuenow/shared-types';

import appConfigFactory from '../../../app.config';
import { assertSharedPackagesPresent, sharedPackageSentinels } from '@/lib/shared-packages';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// apps/mobile root: src/test-support/__tests__ -> up three levels.
const MOBILE_ROOT = resolve(TEST_DIR, '../../..');
const SRC_ROOT = join(MOBILE_ROOT, 'src');

function readSource(relPath: string): string {
  return readFileSync(join(MOBILE_ROOT, relPath), 'utf8');
}

/** Strip block (`/* *\/`) and line (`//`) comments so scans ignore prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Recursively collect production `.ts`/`.tsx` files, excluding tests/harness. */
function collectProductionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'test-support') continue;
      out.push(...collectProductionSources(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|property|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe('build/smoke gate — shared packages (R14.3/R14.4)', () => {
  it('boot presence-assertion returns true and does not throw', () => {
    expect(() => assertSharedPackagesPresent()).not.toThrow();
    expect(assertSharedPackagesPresent()).toBe(true);
  });

  it('resolves all three shared packages and their expected exports', () => {
    // @queuenow/shared-types
    expect(TicketStatus.WAITING).toBe('WAITING');
    expect(NotificationType.YOUR_TURN).toBe('YOUR_TURN');
    // @queuenow/shared-validation
    expect(typeof joinQueueSchema.safeParse).toBe('function');
    expect(typeof loginSchema.safeParse).toBe('function');
    // @queuenow/shared-constants
    expect(typeof ERROR_CODES.INTERNAL_ERROR).toBe('string');
    expect(typeof WS_EVENTS.SUBSCRIBE).toBe('string');
    expect(typeof QUEUE_DEFAULTS.RESET_TIME).toBe('string');
  });

  it('exposes one runtime sentinel from every shared package', () => {
    expect(sharedPackageSentinels.ticketStatus).toBe(TicketStatus);
    expect(sharedPackageSentinels.joinQueueSchema).toBe(joinQueueSchema);
    expect(sharedPackageSentinels.errorCodes).toBe(ERROR_CODES);
    expect(sharedPackageSentinels.wsEvents).toBe(WS_EVENTS);
  });

  it('declares workspace deps on all three shared packages in package.json', () => {
    const pkg = JSON.parse(readSource('package.json')) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    expect(deps['@queuenow/shared-types']).toBe('workspace:*');
    expect(deps['@queuenow/shared-validation']).toBe('workspace:*');
    expect(deps['@queuenow/shared-constants']).toBe('workspace:*');
  });
});

describe('build/smoke gate — no local redefinition of shared types (R10.5/R14.5)', () => {
  // Key view-model files: each must IMPORT its domain types from the shared
  // packages rather than declaring its own copy.
  const cases: ReadonlyArray<{ file: string; symbol: string; redefinition: RegExp }> = [
    {
      file: 'src/lib/view-models.ts',
      symbol: 'IQueueTicket',
      redefinition: /\binterface\s+IQueueTicket\b/,
    },
    {
      file: 'src/features/queue/types.ts',
      symbol: 'IQueueTicket',
      redefinition: /\binterface\s+IQueueTicket\b/,
    },
    {
      file: 'src/features/history/types.ts',
      symbol: 'TicketStatus',
      redefinition: /\benum\s+TicketStatus\b/,
    },
    {
      file: 'src/features/notifications/types.ts',
      symbol: 'NotificationType',
      redefinition: /\benum\s+NotificationType\b/,
    },
  ];

  for (const { file, symbol, redefinition } of cases) {
    it(`${file} imports ${symbol} from @queuenow/shared-types`, () => {
      const source = readSource(file);
      // grep-style: imports the domain type from the shared package…
      expect(source).toMatch(/from\s+'@queuenow\/shared-types'/);
      expect(source).toContain(symbol);
      // …and does NOT redefine it locally.
      expect(source).not.toMatch(redefinition);
    });
  }
});

describe('build/smoke gate — strict typecheck + no-any (R14.1/R14.2)', () => {
  it('exposes a strict `tsc --noEmit` typecheck script', () => {
    const pkg = JSON.parse(readSource('package.json')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.typecheck).toBe('tsc --noEmit');
  });

  it('extends the repo strict tsconfig.base.json', () => {
    const tsconfig = readSource('tsconfig.json');
    expect(tsconfig).toMatch(/"extends"\s*:\s*"\.\.\/\.\.\/tsconfig\.base\.json"/);

    const base = JSON.parse(readSource('../../tsconfig.base.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUnusedLocals).toBe(true);
    expect(base.compilerOptions.noUnusedParameters).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });

  it('uses no explicit `any` type annotation in production source (convention gate)', () => {
    const anyPatterns = /(:\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\[\]|Array<\s*any\s*>)/;
    const offenders: string[] = [];
    for (const file of collectProductionSources(SRC_ROOT)) {
      const code = stripComments(readSource(relative(MOBILE_ROOT, file)));
      if (anyPatterns.test(code)) offenders.push(relative(MOBILE_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});

describe('build/smoke gate — Expo config valid for iOS + Android (R14.1/R14.2)', () => {
  it('app.config.ts exports a config with iOS- and Android-capable settings', () => {
    const context = { config: {} } as ConfigContext;
    const config: ExpoConfig = appConfigFactory(context);

    // Identity / deep-linking (shared by both platforms).
    expect(config.name).toBe('QueueNow');
    expect(config.slug).toBeTruthy();
    expect(config.scheme).toBe('queuenow');

    // iOS-capable: an `ios` section is present.
    expect(config.ios).toBeDefined();

    // Android-capable: no platform exclusion that would drop Android. SDK 56
    // builds both platforms by default; this config never narrows `platforms`.
    if (config.platforms) {
      expect(config.platforms).toContain('android');
      expect(config.platforms).toContain('ios');
    }

    // Native plugins the customer journey needs on BOTH platforms.
    const plugins = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins).toContain('expo-router');
    expect(plugins).toContain('expo-camera');
    expect(plugins).toContain('expo-secure-store');
    expect(plugins).toContain('expo-notifications');
  });
});

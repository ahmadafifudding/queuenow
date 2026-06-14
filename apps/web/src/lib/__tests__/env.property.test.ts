// Feature: web-app, Property 16: Env validation accepts iff required vars are present and well-formed
//
// Validates: Requirements 1.3, 1.4
//
// For any candidate environment, `validateEnv()` succeeds (returning a frozen
// object carrying both values) IF AND ONLY IF both `VITE_API_URL` and
// `VITE_WS_URL` are present and well-formed URLs. Otherwise it throws a named
// `EnvValidationError` whose message names every missing/malformed variable.
//
// Memoization note: `validateEnv()` caches its result in a module-level
// `cachedEnv`. To exercise different environments per generated case we call
// `vi.resetModules()` and re-`import('../env')` inside every property run, so
// each evaluation gets a fresh module that re-reads the freshly stubbed
// `import.meta.env`.
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/** Mirrors the schema's per-field rule in env.ts (`z.string().url()`). */
const isWellFormedUrl = (value: string): boolean => z.string().url().safeParse(value).success;

/** The three possible states a required variable can be in. */
type VarState =
  | { readonly kind: 'valid'; readonly value: string }
  | { readonly kind: 'malformed'; readonly value: string }
  | { readonly kind: 'absent' };

// (a) a well-formed http/https URL, (b) a malformed/non-URL string, (c) absent.
const validUrlArb: fc.Arbitrary<VarState> = fc
  .webUrl()
  .filter(isWellFormedUrl)
  .map((value) => ({ kind: 'valid', value }));

const malformedArb: fc.Arbitrary<VarState> = fc
  .string()
  .filter((value) => !isWellFormedUrl(value))
  .map((value) => ({ kind: 'malformed', value }));

const absentArb: fc.Arbitrary<VarState> = fc.constant({ kind: 'absent' });

const varStateArb: fc.Arbitrary<VarState> = fc.oneof(validUrlArb, malformedArb, absentArb);

/** Apply a generated variable state onto `import.meta.env` via Vitest stubs. */
function applyStub(name: string, state: VarState): void {
  if (state.kind === 'absent') {
    vi.stubEnv(name, undefined);
  } else {
    vi.stubEnv(name, state.value);
  }
}

describe('Property 16: Env validation accepts iff required vars are present and well-formed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a frozen typed env iff both vars are present + well-formed; otherwise throws naming offenders', async () => {
    await fc.assert(
      fc.asyncProperty(varStateArb, varStateArb, async (api: VarState, ws: VarState) => {
        // Fresh module per case so memoized `cachedEnv` re-reads the new env.
        vi.resetModules();
        vi.unstubAllEnvs();
        applyStub('VITE_API_URL', api);
        applyStub('VITE_WS_URL', ws);

        const { validateEnv, EnvValidationError } = await import('../env');

        const shouldAccept = api.kind === 'valid' && ws.kind === 'valid';

        if (shouldAccept) {
          const result = validateEnv();
          // Returns a frozen object carrying both values.
          expect(Object.isFrozen(result)).toBe(true);
          expect(result.VITE_API_URL).toBe(api.kind === 'valid' ? api.value : undefined);
          expect(result.VITE_WS_URL).toBe(ws.kind === 'valid' ? ws.value : undefined);
          return;
        }

        // Otherwise it throws EnvValidationError naming each offending variable.
        let thrown: unknown;
        try {
          validateEnv();
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(EnvValidationError);
        const message = (thrown as Error).message;
        if (api.kind !== 'valid') {
          expect(message).toContain('VITE_API_URL');
        }
        if (ws.kind !== 'valid') {
          expect(message).toContain('VITE_WS_URL');
        }
      }),
      { numRuns: 100 },
    );
  });
});

/*
 * Environment configuration (Env_Validator) — Requirements 14.1, 14.2.
 *
 * All app configuration is read here, once, and validated with Zod on boot.
 * Nothing else in the app reads raw environment values directly, and no URL is
 * ever hardcoded — every consumer goes through the validated `env` object.
 *
 * Expo specifics:
 * - Public configuration uses the `EXPO_PUBLIC_` prefix (NOT `VITE_`). Expo
 *   statically inlines `EXPO_PUBLIC_`-prefixed variables into the bundle as
 *   `process.env.EXPO_PUBLIC_*`, so this module reads from `process.env`.
 *   It does NOT (and cannot) use Vite's `import.meta.env`.
 * - As a secondary source, values surfaced through `app.config.ts` →
 *   `expo-constants` (`Constants.expoConfig.extra`) are merged in. `process.env`
 *   wins when both are present.
 *
 * On validation failure this module throws a NAMED `EnvValidationError` that
 * names every offending variable so the app entry can catch it and render a
 * fatal-config screen instead of mounting the app (fail-fast).
 */
import Constants from 'expo-constants';
import { z } from 'zod';

/**
 * Schema for the required `EXPO_PUBLIC_`-prefixed environment variables.
 *
 * - `EXPO_PUBLIC_API_URL` — REST base URL (e.g. `http://localhost:4000/api/v1`).
 * - `EXPO_PUBLIC_WS_URL`  — Socket.io base URL (e.g. `http://localhost:4000`).
 */
const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_WS_URL: z.string().url(),
});

/** The validated, typed shape of the application environment. */
export type Env = z.infer<typeof envSchema>;

/**
 * Named error thrown when environment validation fails. The app entry catches
 * this to render a fatal-config screen rather than mounting the app (fail-fast,
 * Requirement 14.1/14.2). The `message` names every offending variable.
 */
export class EnvValidationError extends Error {
  /** The list of variable names that were missing or malformed. */
  public readonly variables: readonly string[];

  constructor(variables: readonly string[], message: string) {
    super(message);
    this.name = 'EnvValidationError';
    this.variables = variables;
    // Restore prototype chain for instanceof checks when targeting ES5/ES6.
    Object.setPrototypeOf(this, EnvValidationError.prototype);
  }
}

/**
 * Collect the raw public configuration from the two Expo-supported sources.
 *
 * `process.env.EXPO_PUBLIC_*` (inlined by Expo at build time) is authoritative;
 * `Constants.expoConfig.extra` (populated by `app.config.ts`) is a fallback so
 * the same values are available wherever `process.env` inlining is unavailable.
 */
function readRawEnv(): Record<string, unknown> {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

  return {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? extra.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_WS_URL: process.env.EXPO_PUBLIC_WS_URL ?? extra.EXPO_PUBLIC_WS_URL,
  };
}

/**
 * Validate the raw environment against {@link envSchema}.
 *
 * @throws {EnvValidationError} when a required variable is missing or malformed,
 * with a message naming each offending variable.
 */
function parseEnvOrThrow(): Env {
  const result = envSchema.safeParse(readRawEnv());

  if (!result.success) {
    const issues = result.error.issues;
    // Deduplicate the offending variable names (top-level keys).
    const variables = Array.from(
      new Set(issues.map((issue) => (issue.path.length > 0 ? String(issue.path[0]) : '(root)'))),
    );
    const details = issues
      .map((issue) => {
        const name = issue.path.length > 0 ? String(issue.path[0]) : '(root)';
        return `${name}: ${issue.message}`;
      })
      .join('; ');

    throw new EnvValidationError(
      variables,
      `Invalid environment configuration. Check the following variable(s): ${details}. ` +
        `See apps/mobile/.env.example for the required values.`,
    );
  }

  return result.data;
}

/** Memoized validated environment. Populated on first call to {@link validateEnv}. */
let cachedEnv: Readonly<Env> | null = null;

/**
 * Validate the environment and return the frozen, typed `env`. The result is
 * memoized so validation only runs once per session.
 *
 * The app entry calls this first, inside a try/catch, so a misconfigured build
 * halts with a named {@link EnvValidationError} and renders a fatal-config
 * screen instead of mounting the app (fail-fast).
 *
 * @throws {EnvValidationError} when a required variable is missing or malformed.
 */
export function validateEnv(): Readonly<Env> {
  if (cachedEnv === null) {
    cachedEnv = Object.freeze(parseEnvOrThrow());
  }
  return cachedEnv;
}

/**
 * The validated, frozen environment object. All configuration access goes
 * through this object — no URL is hardcoded anywhere else in the app.
 *
 * Access is lazy: the first property read triggers (memoized) validation. This
 * lets the app entry gate startup via {@link validateEnv} and catch failures,
 * rather than the validation throwing at module-import time (which a try/catch
 * around a static import cannot intercept).
 */
export const env: Readonly<Env> = new Proxy({} as Env, {
  get(_target, prop: string | symbol): unknown {
    return validateEnv()[prop as keyof Env];
  },
  has(_target, prop: string | symbol): boolean {
    return prop in validateEnv();
  },
  ownKeys(): ArrayLike<string | symbol> {
    return Reflect.ownKeys(validateEnv());
  },
  getOwnPropertyDescriptor(_target, prop: string | symbol) {
    return Reflect.getOwnPropertyDescriptor(validateEnv(), prop);
  },
});

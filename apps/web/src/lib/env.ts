/*
 * Environment configuration (Env_Validator) — Requirements 1.3, 1.4, 1.5, 1.6.
 *
 * All frontend configuration is read here, once, from `import.meta.env` and
 * validated with Zod on boot. Nothing else in the app reads `import.meta.env`
 * directly, and `process.env` is never referenced in client code.
 *
 * On validation failure this module throws a NAMED `EnvValidationError` that
 * names the missing/invalid variable(s) so `main.tsx` can catch it and render a
 * full-screen fatal-config message instead of mounting the app (fail-fast).
 */
import { z } from 'zod';

/**
 * Schema for the required `VITE_`-prefixed environment variables.
 *
 * - `VITE_API_URL` — REST base URL (e.g. `http://localhost:4000/api/v1`).
 * - `VITE_WS_URL`  — Socket.io base URL (e.g. `http://localhost:4000`).
 */
const envSchema = z.object({
  VITE_API_URL: z.string().url(),
  VITE_WS_URL: z.string().url(),
});

/** The validated, typed shape of the application environment. */
export type Env = z.infer<typeof envSchema>;

/**
 * Named error thrown when environment validation fails. `main.tsx` catches this
 * to render a fatal-config screen rather than mounting the router (fail-fast,
 * Requirement 1.4). The `message` names every offending variable.
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
 * Validate `import.meta.env` against {@link envSchema}.
 *
 * @throws {EnvValidationError} when a required variable is missing or malformed,
 * with a message naming each offending variable.
 */
function parseEnvOrThrow(): Env {
  const result = envSchema.safeParse(import.meta.env);

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
        `See apps/web/.env.example for the required values.`,
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
 * `main.tsx` calls this first, inside a try/catch, so a misconfigured deploy
 * halts with a named {@link EnvValidationError} and renders a fatal-config
 * screen instead of mounting the app (fail-fast, Requirement 1.4).
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
 * through this object (Requirement 1.5).
 *
 * Access is lazy: the first property read triggers (memoized) validation. This
 * lets `main.tsx` gate startup via {@link validateEnv} and catch failures,
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

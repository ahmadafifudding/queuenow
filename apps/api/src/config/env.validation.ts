import { z } from 'zod';

/**
 * Schema for all environment variables consumed by the API.
 *
 * - Required values (secrets, database URL) have no default, so a missing value
 *   fails validation at startup (fail-fast).
 * - Numeric values are coerced from their string env representation.
 * - Optional integrations (Google, R2, Resend, Sentry) are left optional.
 */
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().min(1).default('api/v1'),
  APP_BASE_URL: z.string().url().default('https://queue.app'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRATION: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRATION: z.string().min(1).default('7d'),

  // Google OAuth (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // Cloudflare R2 (optional)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Email (optional)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default('noreply@queueapp.com'),

  // Observability (optional)
  SENTRY_DSN: z.string().optional(),

  // CORS — comma-separated list of allowed origins
  CORS_ORIGINS: z.string().default(''),

  // Rate limiting
  THROTTLE_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validation hook passed to `ConfigModule.forRoot({ validate })`.
 *
 * Runs once at startup. The returned (parsed + coerced) object becomes the
 * source of truth for `ConfigService`, so numeric vars like `PORT` are real
 * numbers rather than strings. Throws a readable error listing every problem.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}

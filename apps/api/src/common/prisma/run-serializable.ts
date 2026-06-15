import { Prisma } from '@queuenow/db';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Postgres SQLSTATE raised when a `Serializable` transaction is aborted because
 * it could not be serialized against a concurrent transaction (write-skew /
 * serialization failure).
 */
const POSTGRES_SERIALIZATION_FAILURE = '40001';

/**
 * Prisma error code raised for a transaction write conflict or deadlock that
 * the caller is expected to retry.
 */
const PRISMA_TRANSACTION_CONFLICT = 'P2034';

/**
 * Default number of attempts (the initial try plus retries) made before a
 * serialization failure is allowed to propagate. Numeric plan-limit enforcement
 * only ever contends for a single remaining slot, so a small bound is plenty to
 * absorb the retry storms that can occur when several writers abort and retry in
 * lock-step; exhausting it indicates pathological contention worth surfacing.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Base back-off in milliseconds; the per-attempt delay grows linearly with jitter. */
const BASE_BACKOFF_MS = 5;

/** Options controlling the serializable retry loop. */
export interface RunSerializableOptions {
  /**
   * Total number of attempts (initial try + retries) before the serialization
   * failure propagates. Must be >= 1; defaults to {@link DEFAULT_MAX_ATTEMPTS}.
   */
  maxAttempts?: number;
}

/**
 * Narrowly detect a retryable serialization failure without using `any`. The
 * failure can surface either as a typed Prisma known-request error (`P2034`) or
 * as the raw Postgres `40001` SQLSTATE on the underlying driver error.
 */
function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === PRISMA_TRANSACTION_CONFLICT;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: unknown }).code === POSTGRES_SERIALIZATION_FAILURE;
  }
  return false;
}

/** Resolve after a small jittered back-off to de-correlate competing retries. */
function backoff(attempt: number): Promise<void> {
  const delay = BASE_BACKOFF_MS * attempt + Math.floor(Math.random() * BASE_BACKOFF_MS);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Run `work` inside a `Serializable` Prisma transaction, retrying on a
 * serialization failure up to {@link RunSerializableOptions.maxAttempts} total
 * attempts (default {@link DEFAULT_MAX_ATTEMPTS}).
 *
 * Numeric plan-limit enforcement counts existing usage and creates the new row
 * in the same transaction (R1.6). Under `Serializable` isolation two concurrent
 * creates that both read `usage = limit - 1` cannot both commit — Postgres
 * aborts one (or, under lock-step scheduling, both) with a serialization failure
 * (SQLSTATE `40001`, surfaced by Prisma as `P2034`). A single retry is not
 * always sufficient: when several writers abort and retry together, a retry can
 * itself be aborted, which would otherwise propagate as an unhandled error
 * (HTTP 500) instead of the intended `PLAN_LIMIT_EXCEEDED` rejection. The
 * bounded retry loop here re-opens a fresh transaction (which re-reads the
 * now-committed `usage`) after a short jittered back-off, so the loser converges
 * on `usage = limit` and is rejected cleanly, and the committed usage never
 * exceeds the limit. A non-serialization error propagates immediately.
 *
 * @param prisma  the Prisma service used to open the transaction
 * @param work    the transactional unit of work (receives the transaction client)
 * @param options optional retry tuning (see {@link RunSerializableOptions})
 */
export async function runSerializable<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: RunSerializableOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const txOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  } as const;

  let attempt = 0;
  // Loop until an attempt succeeds or the retry budget is exhausted.
  for (;;) {
    attempt += 1;
    try {
      return await prisma.$transaction(work, txOptions);
    } catch (error) {
      // Only serialization failures are retryable, and only while attempts remain.
      if (isSerializationFailure(error) && attempt < maxAttempts) {
        await backoff(attempt);
        continue;
      }
      throw error;
    }
  }
}

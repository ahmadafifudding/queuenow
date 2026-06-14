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

/**
 * Run `work` inside a `Serializable` Prisma transaction, retrying exactly once
 * when the transaction is aborted by a serialization failure.
 *
 * Numeric plan-limit enforcement counts existing usage and creates the new row
 * in the same transaction (R1.6). Under `Serializable` isolation two concurrent
 * creates that both read `usage = limit - 1` cannot both commit — Postgres
 * aborts one with a serialization failure (SQLSTATE `40001`, surfaced by Prisma
 * as `P2034`). The losing transaction is retried once here; on the retry it
 * reads the committed `usage = limit` and is rejected with
 * `PLAN_LIMIT_EXCEEDED`, so the resulting usage never exceeds the limit.
 *
 * @param prisma the Prisma service used to open the transaction
 * @param work   the transactional unit of work (receives the transaction client)
 */
export async function runSerializable<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const options = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  } as const;

  try {
    return await prisma.$transaction(work, options);
  } catch (error) {
    if (isSerializationFailure(error)) {
      // Retry exactly once; a second serialization failure propagates to the caller.
      return prisma.$transaction(work, options);
    }
    throw error;
  }
}

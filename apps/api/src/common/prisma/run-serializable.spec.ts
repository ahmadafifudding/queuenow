// Feature: plan-limit-enforcement, runSerializable bounded retry loop
//
// Validates: Requirement 1.6 (atomic Serializable check-then-create retries on
// a serialization failure so concurrent creates never overshoot the limit).
//
// These unit tests drive `runSerializable` with a mocked `$transaction` so the
// retry policy is exercised without a real database. They lock in that:
//   - a successful unit of work runs exactly once,
//   - a serialization failure (Prisma P2034 / Postgres 40001) is retried,
//   - more than one consecutive serialization failure is tolerated up to the
//     attempt budget (the bug that made the concurrency e2e flaky / 500 under
//     lock-step retries), and
//   - a non-serialization error propagates immediately without retry.
import { Prisma } from '@queuenow/db';

import type { PrismaService } from '../../prisma/prisma.service';
import { runSerializable } from './run-serializable';

/** Build a mocked PrismaService whose `$transaction` invokes the work callback. */
function makePrisma(transaction: jest.Mock): PrismaService {
  return { $transaction: transaction } as unknown as PrismaService;
}

/** A typed Prisma serialization failure (write conflict / deadlock → P2034). */
function serializationError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

/** A raw driver error carrying the Postgres 40001 SQLSTATE. */
function rawSqlState40001(): { code: string } {
  return { code: '40001' };
}

describe('runSerializable', () => {
  it('runs the unit of work once and returns its result on success', async () => {
    const work = jest.fn().mockResolvedValue('ok');
    const transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb({}));
    const prisma = makePrisma(transaction);

    await expect(runSerializable(prisma, work)).resolves.toBe('ok');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('retries once after a single serialization failure, then succeeds (P2034)', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(serializationError())
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) => cb({}));
    const prisma = makePrisma(transaction);
    const work = jest.fn().mockResolvedValue('created');

    await expect(runSerializable(prisma, work)).resolves.toBe('created');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('tolerates multiple consecutive serialization failures up to the attempt budget (40001)', async () => {
    // Three consecutive aborts then success → 4 attempts total, within the
    // default budget of 5. This is the lock-step retry storm that a
    // retry-exactly-once policy could not absorb (it leaked an HTTP 500).
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(rawSqlState40001())
      .mockRejectedValueOnce(rawSqlState40001())
      .mockRejectedValueOnce(serializationError())
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) => cb({}));
    const prisma = makePrisma(transaction);
    const work = jest.fn().mockResolvedValue('eventually');

    await expect(runSerializable(prisma, work)).resolves.toBe('eventually');
    expect(transaction).toHaveBeenCalledTimes(4);
  });

  it('propagates the serialization failure after exhausting the attempt budget', async () => {
    const transaction = jest.fn().mockRejectedValue(serializationError());
    const prisma = makePrisma(transaction);
    const work = jest.fn();

    await expect(runSerializable(prisma, work, { maxAttempts: 3 })).rejects.toMatchObject({
      code: 'P2034',
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-serialization error', async () => {
    const nonRetryable = new Error('boom');
    const transaction = jest.fn().mockRejectedValue(nonRetryable);
    const prisma = makePrisma(transaction);
    const work = jest.fn();

    await expect(runSerializable(prisma, work)).rejects.toBe(nonRetryable);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

// Feature: customer-mobile-app, Task 17.2 — tests for CustomerService.refreshToken
// (the service behind the public POST /customers/refresh endpoint added in 17.1).
//
// Validates: Requirements 12.2, 12.4
//
// R12.2: the customer token-refresh endpoint accepts a valid customer
// Refresh_Token and returns a new token pair.
// R12.4: when refresh fails because the Refresh_Token is invalid or expired,
// the client clears its tokens and returns to sign-in — the backend signals
// this with AUTH_TOKEN_EXPIRED (expired) or AUTH_UNAUTHORIZED (invalid).
//
// A REAL JwtService is used so generateTokens actually signs the replacement
// refresh token and refreshToken can verify/decode the presented one.
// PrismaService is mocked with a small in-memory CustomerSession store so the
// session backing a presented token is discoverable by findUnique and the
// rotation (delete old + create new) is observable. CustomerService is NOT
// modified — these are tests only.

import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CustomerProfile } from '@queuenow/db';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthTokenExpiredException } from '../../common/exceptions/auth-token-expired.exception';
import { AuthUnauthorizedException } from '../../common/exceptions/auth-unauthorized.exception';
import { CustomerService } from './customer.service';

const ACCESS_SECRET = 'access-secret-for-customer-refresh-tests';
const REFRESH_SECRET = 'refresh-secret-for-customer-refresh-tests';

const CUSTOMER_ID = 'customer-under-test';

/** Claims that CustomerService.generateTokens signs into a refresh token. */
interface RefreshClaims {
  sub: string;
  type: string;
}

/** In-memory CustomerSession row mirroring the Prisma model used by the service. */
interface CustomerSessionRow {
  id: string;
  customerId: string;
  refreshToken: string;
  deviceInfo: string | null;
  expiresAt: Date;
  createdAt: Date;
}

function buildCustomer(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  const now = new Date(0);
  return {
    id: CUSTOMER_ID,
    email: 'customer@example.com',
    phone: '+60123456789',
    fullName: 'Test Customer',
    passwordHash: 'hashed',
    provider: 'EMAIL',
    avatarUrl: 'https://cdn.example.com/avatar.png',
    pushToken: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CustomerProfile;
}

/**
 * In-memory PrismaService double for the CustomerSession table. The store is
 * shared across findUnique/delete/create so a rotation issued by generateTokens
 * is observable, and the spies let us assert side effects (delete/create).
 */
function createPrismaMock(customer: CustomerProfile): {
  prisma: PrismaService;
  sessions: CustomerSessionRow[];
  createSpy: jest.Mock;
  deleteSpy: jest.Mock;
} {
  const sessions: CustomerSessionRow[] = [];
  let counter = 0;

  const createSpy = jest.fn(
    async ({ data }: { data: { customerId: string; refreshToken: string; expiresAt: Date } }) => {
      const row: CustomerSessionRow = {
        id: `session-${counter++}`,
        customerId: data.customerId,
        refreshToken: data.refreshToken,
        deviceInfo: null,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      };
      sessions.push(row);
      return row;
    },
  );

  const deleteSpy = jest.fn(async ({ where }: { where: { id: string } }) => {
    const idx = sessions.findIndex((s) => s.id === where.id);
    const [removed] = idx >= 0 ? sessions.splice(idx, 1) : [undefined];
    return removed ?? {};
  });

  const prisma = {
    customerSession: {
      findUnique: jest.fn(async ({ where }: { where: { refreshToken?: string; id?: string } }) => {
        const row = sessions.find(
          (s) =>
            (where.refreshToken !== undefined && s.refreshToken === where.refreshToken) ||
            (where.id !== undefined && s.id === where.id),
        );
        return row ? { ...row, customer } : null;
      }),
      create: createSpy,
      delete: deleteSpy,
    },
  } as unknown as PrismaService;

  return { prisma, sessions, createSpy, deleteSpy };
}

function createConfigService(): ConfigService {
  const values: Record<string, string> = {
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    JWT_REFRESH_EXPIRATION: '30d',
  };
  return {
    getOrThrow: (key: string): string => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config: ${key}`);
      }
      return value;
    },
    get: (key: string, defaultValue?: string): string | undefined => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

function createJwtService(): JwtService {
  return new JwtService({ secret: ACCESS_SECRET, signOptions: { expiresIn: '15m' } });
}

/** Signs a refresh token the way generateTokens does (secret + claims). */
function signRefresh(
  jwt: JwtService,
  claims: RefreshClaims,
  expiresIn: string | number = '30d',
): string {
  return jwt.sign(claims, { secret: REFRESH_SECRET, expiresIn });
}

/** Seeds a live CustomerSession row backing the given refresh token. */
function seedSession(
  sessions: CustomerSessionRow[],
  overrides: Partial<CustomerSessionRow> & { refreshToken: string },
): CustomerSessionRow {
  const row: CustomerSessionRow = {
    id: 'seeded-session',
    customerId: CUSTOMER_ID,
    deviceInfo: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  };
  sessions.push(row);
  return row;
}

describe('CustomerService.refreshToken', () => {
  describe('valid refresh (R12.2)', () => {
    it('rotates the session and returns the ICustomerLoginResponse shape with a new token pair', async () => {
      const customer = buildCustomer();
      const { prisma, sessions, createSpy, deleteSpy } = createPrismaMock(customer);
      const jwt = createJwtService();
      const service = new CustomerService(prisma, jwt, createConfigService());

      const presentedToken = signRefresh(jwt, { sub: CUSTOMER_ID, type: 'customer' });
      const seeded = seedSession(sessions, { id: 'old-session', refreshToken: presentedToken });

      const result = await service.refreshToken(presentedToken);

      // Response mirrors the login shape: { customer, tokens }.
      expect(result.customer).toEqual({
        id: customer.id,
        email: customer.email,
        phone: customer.phone,
        fullName: customer.fullName,
        avatarUrl: customer.avatarUrl,
      });
      expect(typeof result.tokens.accessToken).toBe('string');
      expect(typeof result.tokens.refreshToken).toBe('string');
      expect(result.tokens.accessToken.length).toBeGreaterThan(0);
      expect(result.tokens.refreshToken.length).toBeGreaterThan(0);

      // The old session was deleted and exactly one replacement was created.
      expect(deleteSpy).toHaveBeenCalledWith({ where: { id: seeded.id } });
      expect(createSpy).toHaveBeenCalledTimes(1);

      // Only the freshly created session remains, holding the new refresh token.
      expect(sessions).toHaveLength(1);
      expect(sessions[0].refreshToken).toBe(result.tokens.refreshToken);
      expect(sessions[0].customerId).toBe(CUSTOMER_ID);

      // The new refresh token is a valid customer refresh JWT.
      const claims = jwt.verify<RefreshClaims>(result.tokens.refreshToken, {
        secret: REFRESH_SECRET,
      });
      expect(claims.sub).toBe(CUSTOMER_ID);
      expect(claims.type).toBe('customer');
    });
  });

  describe('expired refresh JWT (R12.4)', () => {
    it('rejects with AUTH_TOKEN_EXPIRED and issues no new tokens', async () => {
      const customer = buildCustomer();
      const { prisma, createSpy } = createPrismaMock(customer);
      const jwt = createJwtService();
      const service = new CustomerService(prisma, jwt, createConfigService());

      // Already-expired refresh JWT → JwtService throws TokenExpiredError.
      const expiredToken = signRefresh(jwt, { sub: CUSTOMER_ID, type: 'customer' }, '-1s');

      await expect(service.refreshToken(expiredToken)).rejects.toBeInstanceOf(
        AuthTokenExpiredException,
      );

      try {
        await service.refreshToken(expiredToken);
        throw new Error('expected refreshToken to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthTokenExpiredException);
        const response = (error as AuthTokenExpiredException).getResponse() as { code: string };
        expect(response.code).toBe('AUTH_TOKEN_EXPIRED');
      }

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('expired backing session (R12.4)', () => {
    it('rejects with AUTH_TOKEN_EXPIRED and cleans up the stale session row', async () => {
      const customer = buildCustomer();
      const { prisma, sessions, createSpy, deleteSpy } = createPrismaMock(customer);
      const jwt = createJwtService();
      const service = new CustomerService(prisma, jwt, createConfigService());

      // The JWT itself is still valid, but its backing session has expired.
      const presentedToken = signRefresh(jwt, { sub: CUSTOMER_ID, type: 'customer' });
      const stale = seedSession(sessions, {
        id: 'stale-session',
        refreshToken: presentedToken,
        expiresAt: new Date(Date.now() - 60_000),
      });

      try {
        await service.refreshToken(presentedToken);
        throw new Error('expected refreshToken to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthTokenExpiredException);
        const response = (error as AuthTokenExpiredException).getResponse() as { code: string };
        expect(response.code).toBe('AUTH_TOKEN_EXPIRED');
      }

      // The stale row is removed and no replacement pair is issued.
      expect(deleteSpy).toHaveBeenCalledWith({ where: { id: stale.id } });
      expect(createSpy).not.toHaveBeenCalled();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('invalid refresh attempts (R12.4)', () => {
    it('rejects a malformed token with AUTH_UNAUTHORIZED', async () => {
      const customer = buildCustomer();
      const { prisma, createSpy } = createPrismaMock(customer);
      const service = new CustomerService(prisma, createJwtService(), createConfigService());

      try {
        await service.refreshToken('not-a-real-jwt');
        throw new Error('expected refreshToken to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthUnauthorizedException);
        const response = (error as AuthUnauthorizedException).getResponse() as { code: string };
        expect(response.code).toBe('AUTH_UNAUTHORIZED');
      }
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects a token signed with the wrong type with AUTH_UNAUTHORIZED', async () => {
      const customer = buildCustomer();
      const { prisma, sessions, createSpy } = createPrismaMock(customer);
      const jwt = createJwtService();
      const service = new CustomerService(prisma, jwt, createConfigService());

      // Valid signature/expiry but type !== 'customer' (e.g. a staff/user token).
      const wrongTypeToken = signRefresh(jwt, { sub: CUSTOMER_ID, type: 'user' });
      seedSession(sessions, { refreshToken: wrongTypeToken });

      await expect(service.refreshToken(wrongTypeToken)).rejects.toBeInstanceOf(
        AuthUnauthorizedException,
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects when no CustomerSession backs the token with AUTH_UNAUTHORIZED', async () => {
      const customer = buildCustomer();
      const { prisma, createSpy } = createPrismaMock(customer);
      const jwt = createJwtService();
      const service = new CustomerService(prisma, jwt, createConfigService());

      // Properly signed customer refresh token, but the session store is empty.
      const orphanToken = signRefresh(jwt, { sub: CUSTOMER_ID, type: 'customer' });

      await expect(service.refreshToken(orphanToken)).rejects.toBeInstanceOf(
        AuthUnauthorizedException,
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects when the session customerId does not match the token sub with AUTH_UNAUTHORIZED', async () => {
      const customer = buildCustomer();
      const { prisma, sessions, createSpy, deleteSpy } = createPrismaMock(customer);
      const jwt = createJwtService();
      const service = new CustomerService(prisma, jwt, createConfigService());

      // Token sub is CUSTOMER_ID, but the backing session belongs to someone else.
      const presentedToken = signRefresh(jwt, { sub: CUSTOMER_ID, type: 'customer' });
      seedSession(sessions, {
        refreshToken: presentedToken,
        customerId: 'a-different-customer',
      });

      await expect(service.refreshToken(presentedToken)).rejects.toBeInstanceOf(
        AuthUnauthorizedException,
      );
      // Mismatch path must not rotate (no delete, no create).
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});

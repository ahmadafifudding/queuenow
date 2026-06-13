---
inclusion: fileMatch
fileMatchPattern: "apps/api/**"
---

# Testing Standards (Backend / apps/api)

> Scope: This applies to the NestJS backend (`apps/api`), which is a CommonJS project.
> When the React (Vite) frontend `apps/web` is added, it should use **Vitest** with its
> own steering file — do not apply Jest patterns there.

## Framework

- Use **Jest** with `ts-jest` and `@nestjs/testing` (the NestJS default; deps already installed)
- Test files co-located with source: `feature.service.spec.ts` next to `feature.service.ts`
- Use `describe` / `it` blocks with descriptive names in English

## What to Test

### Must test (high risk):

- Auth flows: register, login, token refresh, logout
- Queue lifecycle: join → call → recall → skip → rejoin → complete
- Guards: JwtAuthGuard, RolesGuard (access granted/denied scenarios)
- Business rules: max queue per day, max recall limit, expiration logic

### Should test (medium risk):

- Service CRUD: create, update, delete with validation
- Staff management: invite, remove, cancel invitation
- Notification: send logic, push token registration

### Skip (low value):

- Controllers (thin wrappers, tested via integration/e2e instead)
- DTOs (validated by class-validator, tested implicitly)
- Prisma schema (database-level, tested via integration)

## Mocking Patterns

### Prisma Mock

```typescript
const mockPrisma = {
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  queueTicket: {
    findFirst: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  // Add models as needed
  $transaction: jest.fn((callback) => callback(mockPrisma)),
};
```

### JwtService Mock

```typescript
const mockJwtService = {
  sign: jest.fn().mockReturnValue("mock-token"),
  verify: jest
    .fn()
    .mockReturnValue({ sub: "user-id", orgId: "org-id", role: "OWNER" }),
};
```

### ConfigService Mock

```typescript
const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string> = {
      JWT_ACCESS_SECRET: "test-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      JWT_REFRESH_EXPIRATION: "7d",
    };
    return config[key];
  }),
};
```

## Test Structure

```typescript
describe("AuthService", () => {
  let service: AuthService;
  let prisma: typeof mockPrisma;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    // Setup service with mocks
  });

  describe("register", () => {
    it("should create user, org, role, settings, and branding in transaction", async () => {});
    it("should throw ConflictException if email already exists", async () => {});
    it("should generate access and refresh tokens", async () => {});
  });

  describe("login", () => {
    it("should return tokens for valid credentials", async () => {});
    it("should throw UnauthorizedException for wrong password", async () => {});
    it("should throw UnauthorizedException if user has no roles", async () => {});
  });
});
```

## Naming Convention

- Test files: `{feature}.service.spec.ts`, `{feature}.guard.spec.ts`
- Describe blocks: class name (`"AuthService"`, `"RolesGuard"`)
- It blocks: start with `"should"` — describe expected behavior

## Assertions

- Use `expect(...).toThrow()` for exception testing
- Use `expect(mock).toHaveBeenCalledWith(...)` to verify interactions
- Test both happy path and error cases for every method
- Assert specific exception types, not just "throws"

## Running Tests

Run from `apps/api` (or via the workspace filter):

- `pnpm --filter @queue-system/api test` — run all tests
- `pnpm --filter @queue-system/api test:watch` — watch mode during development
- `pnpm --filter @queue-system/api test:cov` — generate coverage report
- Target: >80% coverage on services, 100% on guards

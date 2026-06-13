---
inclusion: fileMatch
fileMatchPattern: "**/*.spec.ts,**/*.test.ts,**/test/**"
---

# Testing Standards

## Framework

- Use Vitest (ESM-native, fast, compatible with `"type": "module"`)
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
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  queueTicket: {
    findFirst: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  // Add models as needed
  $transaction: vi.fn((callback) => callback(mockPrisma)),
};
```

### JwtService Mock

```typescript
const mockJwtService = {
  sign: vi.fn().mockReturnValue("mock-token"),
  verify: vi
    .fn()
    .mockReturnValue({ sub: "user-id", orgId: "org-id", role: "OWNER" }),
};
```

### ConfigService Mock

```typescript
const mockConfigService = {
  get: vi.fn((key: string) => {
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
    vi.clearAllMocks();
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

- `pnpm test` — run all tests
- `pnpm test:watch` — watch mode during development
- `pnpm test:coverage` — generate coverage report
- Target: >80% coverage on services, 100% on guards

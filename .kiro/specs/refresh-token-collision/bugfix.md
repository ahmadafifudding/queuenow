# Bugfix Requirements Document

## Introduction

The private `generateTokens(userId, orgId, role)` method in `apps/api/src/modules/auth/auth.service.ts` signs both the access and refresh JWT from an identical payload (`{ sub: userId, orgId, role, type: 'staff' }`) with no per-issuance uniqueness. Because JWTs only add `iat` (issued-at, second granularity) and `exp`, two token issuances for the same user/org/role within the same second produce byte-identical refresh tokens. The `Session.refreshToken` column is `@unique`, so the second `prisma.session.create(...)` fails with a Prisma P2002 unique-constraint violation, which surfaces to the client as an unhandled HTTP 500.

This affects every code path that issues tokens — `login`, `register`, `refreshToken`, and `switchOrganization` — because all funnel through `generateTokens`, the single source of token issuance and `Session` creation. The collision is observable when a user logs in, registers, refreshes, or switches organization twice within the same second to the same org and role. The bug was discovered during organization-switching e2e work, where specs added a `prisma.session.deleteMany({ where: { userId } })` workaround to mask it.

The fix must make every issued refresh token unique by construction, independent of timing, while preserving the existing token verification path and all current consumers of the access and refresh token claims.

## Bug Analysis

### Current Behavior (Defect)

When two token issuances occur for the same user/org/role within the same one-second window, the second issuance collides on the unique `refreshToken` and fails.

1.1 WHEN `generateTokens` is invoked twice for the same `userId`, `orgId`, and `role` within the same one-second window THEN the system produces two byte-identical refresh tokens

1.2 WHEN the second `prisma.session.create` runs with a refresh token identical to an existing `Session.refreshToken` THEN the system raises a Prisma P2002 unique-constraint violation

1.3 WHEN the P2002 violation propagates uncaught THEN the system responds with an unhandled HTTP 500

1.4 WHEN a user invokes `login`, `register`, `refreshToken`, or `switchOrganization` a second time for the same org and role within the same second THEN the system fails the second request with HTTP 500 instead of completing it successfully

### Expected Behavior (Correct)

Every issued refresh token must be unique regardless of how close together in time two issuances occur.

2.1 WHEN `generateTokens` is invoked twice for the same `userId`, `orgId`, and `role` within the same one-second window THEN the system SHALL produce two distinct refresh tokens

2.2 WHEN a second token issuance occurs within the same second as a prior issuance THEN the system SHALL persist the new `Session` without a unique-constraint violation

2.3 WHEN a user invokes `login`, `register`, `refreshToken`, or `switchOrganization` a second time for the same org and role within the same second THEN the system SHALL complete the request successfully and return a valid token pair

### Unchanged Behavior (Regression Prevention)

Token verification and all existing claim consumers must continue to work unchanged.

3.1 WHEN the `refreshToken` path verifies a presented refresh token THEN the system SHALL CONTINUE TO read `{ sub, orgId, role }` from the refresh-token claim and succeed for valid tokens

3.2 WHEN `JwtStrategy` validates an access token THEN the system SHALL CONTINUE TO read `{ sub, orgId, role, type }` from the access-token claim without error

3.3 WHEN token issuances occur more than one second apart (the non-colliding case) THEN the system SHALL CONTINUE TO issue valid token pairs and create the backing `Session` successfully

3.4 WHEN a token pair is issued THEN the system SHALL CONTINUE TO be the single source of token issuance and `Session` creation via `generateTokens`

3.5 WHEN `login`, `register`, `refreshToken`, or `switchOrganization` complete successfully THEN the system SHALL CONTINUE TO return the existing response shape (access token, refresh token, and associated user/organization data)

## Bug Condition Specification

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type { firstIssuance: TokenIssuance, secondIssuance: TokenIssuance }
  OUTPUT: boolean

  // Two issuances for the same identity collide when their signed payloads are
  // identical and their issued-at timestamps fall in the same one-second bucket,
  // because the refresh token value is then byte-identical and Session.refreshToken
  // is @unique.
  RETURN X.firstIssuance.userId = X.secondIssuance.userId
     AND X.firstIssuance.orgId  = X.secondIssuance.orgId
     AND X.firstIssuance.role   = X.secondIssuance.role
     AND floor(X.firstIssuance.iat)  = floor(X.secondIssuance.iat)
END FUNCTION
```

### Property Specification (Fix Checking)

```pascal
// Property: Fix Checking - Unique Refresh Token By Construction
FOR ALL X WHERE isBugCondition(X) DO
  firstResult  ← generateTokens'(X.firstIssuance)
  secondResult ← generateTokens'(X.secondIssuance)
  ASSERT firstResult.refreshToken ≠ secondResult.refreshToken
  ASSERT secondResult persisted a Session without unique-constraint violation
  ASSERT no HTTP 500 raised
END FOR
```

### Preservation Specification (Preservation Checking)

```pascal
// Property: Preservation Checking - Verification And Claims Unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT generateTokens(X) ≈ generateTokens'(X)   // same externally observable contract
  ASSERT refreshToken verify path still reads { sub, orgId, role } successfully
  ASSERT JwtStrategy still reads { sub, orgId, role, type } successfully
END FOR
```

**Definitions:**

- **F** (`generateTokens`): the original method that signs both tokens from `{ sub, orgId, role, type: 'staff' }` with no unique per-issuance claim.
- **F'** (`generateTokens'`): the fixed method that adds a unique per-issuance claim so every refresh token is unique by construction, independent of timing, while keeping `{ sub, orgId, role, type }` readable by existing consumers.
- **Counterexample**: two `login` calls for the same user/org/role within the same second → the second `prisma.session.create` throws P2002 → HTTP 500.

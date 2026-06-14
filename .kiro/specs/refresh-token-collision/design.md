# Refresh Token Collision Bugfix Design

## Overview

The private `generateTokens(userId, orgId, role)` method in
`apps/api/src/modules/auth/auth.service.ts` signs both the access and refresh JWT from an
identical payload — `{ sub: userId, orgId, role, type: 'staff' }` — with no per-issuance
uniqueness. JWT only contributes `iat` (issued-at, **second** granularity) and `exp` to the
encoded token, so two issuances for the same `(userId, orgId, role)` that land in the same
one-second bucket produce **byte-identical** refresh tokens. Because `Session.refreshToken` is
`@unique`, the second `prisma.session.create(...)` throws a Prisma `P2002` unique-constraint
violation, which propagates uncaught and surfaces to the client as an unhandled HTTP 500.

Every token-issuing path funnels through `generateTokens` — `login`, `register`,
`refreshToken`, and `switchOrganization` — so all four are exposed to the collision whenever a
user repeats the action twice within the same second to the same org and role.

The fix makes each refresh token **unique by construction, independent of timing**, by adding a
unique per-issuance `jti` (JWT ID) claim — `crypto.randomUUID()` — to the signed payload. The
existing `{ sub, orgId, role, type }` claims stay intact, so `refreshToken`'s verify path and
`JwtStrategy` are unaffected. The fix is confined to `generateTokens`, preserving its role as the
single source of token and `Session` issuance.

## Glossary

- **Bug_Condition (C)**: Two token issuances for the same `(userId, orgId, role)` whose `iat`
  timestamps fall in the same one-second bucket — the condition under which the original method
  produces byte-identical refresh tokens and the second `Session.create` collides.
- **Property (P)**: When the bug condition holds, the fixed method SHALL produce two **distinct**
  refresh tokens, persist both backing `Session` rows without a unique-constraint violation, and
  raise no HTTP 500.
- **Preservation**: Token verification and every existing claim consumer must continue to work
  unchanged — `refreshToken`'s verify path, `JwtStrategy`, the non-colliding issuance case, the
  single-source-of-issuance invariant, and the existing response shape.
- **generateTokens**: The private method in `apps/api/src/modules/auth/auth.service.ts` (~line 403) that signs the access and refresh tokens and creates the backing `Session`. **F** is the
  original; **F'** is the fixed version.
- **jti**: A unique per-issuance JWT ID claim added to the payload to guarantee per-issuance
  uniqueness regardless of timing.
- **Session.refreshToken**: The `@unique` Prisma column that stores the issued refresh token;
  the byte-identical collision violates this constraint.
- **RefreshTokenClaims**: The interface in `auth.service.ts` describing the refresh-token claim
  `{ sub, orgId, role, type }` read by `refreshToken`.
- **JwtStrategy**: The Passport strategy in
  `apps/api/src/modules/auth/strategies/jwt.strategy.ts` that reads `{ sub, orgId, role, type }`
  from the access token on every authenticated request.

## Bug Details

### Bug Condition

The bug manifests when `generateTokens` is invoked twice for the **same** `userId`, `orgId`, and
`role` within the **same one-second window**. The method signs both tokens from a payload that
carries no per-issuance uniqueness, so the two refresh tokens are byte-identical, and the second
`prisma.session.create` collides on the `@unique` `Session.refreshToken` column. The defect is
therefore a combination of: (1) a non-unique signed payload, and (2) JWT's second-granularity
`iat` being the only time-varying field.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type { firstIssuance: TokenIssuance, secondIssuance: TokenIssuance }
  OUTPUT: boolean

  RETURN X.firstIssuance.userId = X.secondIssuance.userId
     AND X.firstIssuance.orgId  = X.secondIssuance.orgId
     AND X.firstIssuance.role   = X.secondIssuance.role
     AND floor(X.firstIssuance.iat) = floor(X.secondIssuance.iat)
END FUNCTION
```

Where `TokenIssuance` is a call to `generateTokens(userId, orgId, role)` and `iat` is the
issued-at second JWT stamps on the resulting tokens.

### Examples

- **Double login (same second)**: A user logs in twice to the same default org within one second.
  First login succeeds; the second produces an identical refresh token and the backing
  `session.create` throws `P2002` → HTTP 500. _Expected_: both logins succeed with distinct
  refresh tokens.
- **Register then immediate retry**: `register` issues an `OWNER` token pair, and a rapid
  follow-up issuance for the same `(userId, orgId, 'OWNER')` within the same second collides.
  _Expected_: both issuances produce distinct tokens.
- **Rapid refresh**: `refreshToken` deletes the old session and calls `generateTokens`; a second
  refresh for the same identity in the same second collides on the new token. _Expected_: distinct
  tokens, session rotation completes.
- **Switch + re-switch (same second)**: `switchOrganization` to org A, then a second issuance for
  `(userId, A, role)` within the same second collides. _Expected_: both complete successfully.
- **Edge case — issuances > 1 second apart (non-bug)**: Two issuances for the same identity
  separated by more than one second already differ via `iat`. _Expected behavior_: unchanged —
  both succeed. This case is the preservation boundary, not the bug.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `refreshToken` must continue to verify a presented refresh token with `JWT_REFRESH_SECRET` and
  read `{ sub, orgId, role }` (via `RefreshTokenClaims`) from the claim, succeeding for valid
  tokens. (R3.1)
- `JwtStrategy` must continue to read `{ sub, orgId, role, type }` from the access-token claim
  without error on every authenticated request. (R3.2)
- Issuances more than one second apart (the non-colliding case) must continue to issue valid
  token pairs and create the backing `Session` successfully. (R3.3)
- `generateTokens` must remain the single source of token issuance and `Session` creation; all
  four callers continue to funnel through it. (R3.4)
- `login`, `register`, `refreshToken`, and `switchOrganization` must continue to return their
  existing response shape (access token, refresh token, and associated user/organization data).
  (R3.5)

**Scope:**
All inputs that do NOT satisfy the bug condition (`NOT isBugCondition(X)`) must be completely
unaffected by this fix. This includes:

- Token verification and claim reads (access and refresh) by every existing consumer.
- Issuances that are already distinct because they differ in `userId`, `orgId`, `role`, or fall
  in different one-second buckets.
- The externally observable contract of each calling endpoint (status codes, response bodies).

**Note:** The expected correct behavior for the buggy inputs is defined in the Correctness
Properties section (Property 1). This section captures only what must NOT change.

## Hypothesized Root Cause

Based on the verified code, the cause is well understood (not speculative):

1. **Non-unique signed payload (primary cause)**: `generateTokens` builds
   `payload = { sub: userId, orgId, role, type: 'staff' }` and signs both tokens from it. The
   payload has no per-issuance entropy, so two issuances for the same identity differ only by
   whatever the signer adds.

2. **Second-granularity `iat` is the only time-varying field**: `jwtService.sign` adds `iat` in
   **seconds** and `exp`. Two signs in the same second therefore yield identical encoded payloads
   and, with a deterministic HMAC signature, byte-identical tokens.

3. **Unique constraint turns the collision into a 500**: `Session.refreshToken` is `@unique`. The
   second `prisma.session.create` throws Prisma `P2002`, which is not caught anywhere on the
   issuance path, so it surfaces as an unhandled HTTP 500 rather than a successful issuance.

4. **Single funnel amplifies the blast radius**: because `login`, `register`, `refreshToken`, and
   `switchOrganization` all call `generateTokens`, the defect manifests across every
   token-issuing endpoint. (This is also why a single-point fix is sufficient.)

## Correctness Properties

Property 1: Bug Condition - Unique Refresh Token By Construction

_For any_ pair of token issuances where the bug condition holds (`isBugCondition` returns
true — same `userId`, `orgId`, `role`, and same one-second `iat` bucket), the fixed
`generateTokens` SHALL produce two **distinct** refresh tokens, persist each backing `Session`
without a unique-constraint violation, and raise no HTTP 500 — so that `login`, `register`,
`refreshToken`, and `switchOrganization` each complete successfully and return a valid token
pair on the second invocation.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Verification And Claims Unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed
`generateTokens` SHALL produce the same externally observable contract as the original: the
`refreshToken` verify path SHALL still read `{ sub, orgId, role }` from the refresh-token claim
and succeed for valid tokens, `JwtStrategy` SHALL still read `{ sub, orgId, role, type }` from
the access-token claim without error, non-colliding issuances SHALL still create their backing
`Session` successfully, and every calling endpoint SHALL still return its existing response shape
— preserving all existing token-verification and claim-consumption behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

The root cause is confirmed, so the fix targets the single source of issuance.

**File**: `apps/api/src/modules/auth/auth.service.ts`

**Function**: `generateTokens(userId, orgId, role)`

**Specific Changes**:

1. **Add a unique per-issuance `jti` claim**: Generate `const jti = crypto.randomUUID();` and
   include it in the signed payload:

   ```ts
   const payload = { sub: userId, orgId, role, type: 'staff', jti };
   ```

   `randomUUID()` is cryptographically random and collision-resistant, so the encoded payload —
   and therefore the resulting refresh token — is unique regardless of how close in time two
   issuances occur. This eliminates the dependency on second-granularity `iat`.

2. **Import `randomUUID` from Node's `crypto`**: Add `import { randomUUID } from 'node:crypto';`.
   This is a standard Node API (no new dependency) and is fully typed, satisfying the
   strict / no-`any` constraint.

3. **Decision — apply `jti` to a single shared payload (both tokens)**: The simplest, lowest-risk
   change is to add `jti` to the one `payload` object both `sign` calls already share, rather than
   constructing separate payloads.
   - _Trade-off analysis_: Only the refresh token hits the `@unique Session.refreshToken` column,
     so strictly only the refresh token must be unique. However, adding `jti` to the access token
     as well is harmless: `JwtStrategy` reads named claims (`sub`, `orgId`, `role`, `type`) and
     ignores unknown ones, so an extra `jti` claim does not affect validation. Keeping a single
     shared payload avoids divergence between the two tokens, keeps the diff minimal, and is
     easier to reason about. Constructing a second payload solely to keep `jti` off the access
     token would add code for no behavioral benefit.
   - _Resolution_: Use one shared payload containing `jti`. Both tokens carry the claim; only the
     refresh token's uniqueness is contractually relied upon.

4. **Preserve everything else**: The `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRATION` sign options,
   the 7-day `expiresAt`, the `prisma.session.create({ data: { userId, refreshToken, expiresAt } })`
   call, and the `{ accessToken, refreshToken }` return shape are all unchanged. The
   `RefreshTokenClaims` interface need not change (it may optionally gain an unused `jti?: string`
   for documentation, but the verify path does not read it).

5. **Keep the single funnel intact**: No caller signatures or call sites change; `generateTokens`
   remains the sole issuer of tokens and `Session` rows.

**Resulting method (target shape):**

```ts
import { randomUUID } from 'node:crypto';

private async generateTokens(userId: string, orgId: string, role: string) {
  const payload = { sub: userId, orgId, role, type: 'staff', jti: randomUUID() };

  const accessToken = this.jwtService.sign(payload);

  const refreshToken = this.jwtService.sign(payload, {
    secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d'),
  } as JwtSignOptions);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await this.prisma.session.create({ data: { userId, refreshToken, expiresAt } });

  return { accessToken, refreshToken };
}
```

### Optional Cleanup (out of scope for the fix, noted for follow-up)

Two e2e specs currently mask the bug with a pre-login workaround:

- `apps/api/test/org-switch.e2e-spec.ts` (`prisma.session.deleteMany({ where: { userId } })`)
- `apps/api/test/org-switch-refresh-roundtrip.e2e-spec.ts` (same workaround)

Once the fix lands, these `deleteMany` workarounds can be removed because rapid same-second
issuances no longer collide. This is optional cleanup and not required for the fix to be correct;
it should be done deliberately so the specs still exercise their intended scenarios.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate
the collision on the **unfixed** code, then verify the fix produces unique tokens for the buggy
inputs and preserves all existing verification and claim behavior. Property-based testing with
Jest + `fast-check` is used, consistent with the existing
`apps/api/src/modules/auth/auth-*.property.spec.ts` harness (real `JwtService`, mocked
`PrismaService` with a small in-memory session store).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the collision BEFORE implementing the fix, and
confirm the root-cause hypothesis (identical payload + same-second `iat` → byte-identical refresh
token → `P2002`). If the tokens turn out to already differ on unfixed code, the hypothesis is
refuted and must be re-examined.

**Test Plan**: Using a real `JwtService` and an in-memory session store that enforces the
`refreshToken` uniqueness (mirroring the `@unique` column), invoke `generateTokens` twice for the
same `(userId, orgId, role)` with the clock pinned to the same second. Run on the UNFIXED code to
observe the identical refresh tokens and the simulated unique-constraint failure.

**Test Cases**:

1. **Login double-issue (battle of the same second)**: Two `login`-driven issuances for the same
   default org/role within one second (will fail on unfixed code — identical refresh token →
   constraint violation).
2. **Register → immediate issue**: `register` (`OWNER`) followed by a same-second issuance for the
   same identity (will fail on unfixed code).
3. **Rapid refresh**: Two `refreshToken` rotations for the same identity in the same second (will
   fail on unfixed code).
4. **Switch same-second re-issue**: `switchOrganization` to org A, then a same-second issuance for
   `(userId, A, role)` (will fail on unfixed code).

**Expected Counterexamples**:

- `firstResult.refreshToken === secondResult.refreshToken` (byte-identical) on unfixed code.
- The second `session.create` rejects with a unique-constraint (`P2002`) error, modeling the
  unhandled HTTP 500.
- Confirmed causes: shared non-unique payload + second-granularity `iat`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces
two distinct refresh tokens and persists both sessions without a unique-constraint violation.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  firstResult  := generateTokens'(X.firstIssuance)
  secondResult := generateTokens'(X.secondIssuance)
  ASSERT firstResult.refreshToken != secondResult.refreshToken
  ASSERT secondResult persisted a Session without a unique-constraint violation
  ASSERT no HTTP 500 raised
END FOR
```

This maps directly to the bugfix.md Fix-Checking property and Correctness Property 1. `fast-check`
generates random `(userId, orgId, role)` triples and same-second issuance pairs to exercise the
bug condition broadly.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function
produces the same externally observable contract as the original — token verification and claim
reads continue to work, and non-colliding issuances still succeed.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT generateTokens(X) ~= generateTokens'(X)   // same observable contract
  ASSERT refreshToken verify path still reads { sub, orgId, role } successfully
  ASSERT JwtStrategy still reads { sub, orgId, role, type } successfully
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation because it generates
many inputs across the domain, catches edge cases manual tests miss, and gives strong assurance
that behavior is unchanged for all non-buggy inputs. Observe behavior on UNFIXED code first, then
write property tests capturing it.

**Test Cases**:

1. **Refresh verify-path preservation**: Issue tokens via the fixed `generateTokens`, then verify
   the refresh token with `JWT_REFRESH_SECRET` and assert `{ sub, orgId, role }` read exactly as
   before (mirrors the existing `auth-refresh.property.spec.ts` round-trip).
2. **Access-token claim preservation (`JwtStrategy`)**: Decode/verify the access token and assert
   `{ sub, orgId, role, type }` are present and correct; the added `jti` claim does not affect
   `JwtStrategy.validate`.
3. **Non-colliding issuance preservation**: For issuances differing in identity or more than one
   second apart, assert both still create a backing `Session` and return the existing token-pair
   shape.
4. **Response-shape preservation**: For each of `login`, `register`, `refreshToken`,
   `switchOrganization`, assert the returned `ILoginResponse` / token-pair shape is unchanged.

### Unit Tests

- `generateTokens` adds a `jti` claim and produces distinct refresh tokens on two same-second
  calls for the same identity.
- Decoded access and refresh tokens still contain `{ sub, orgId, role, type }` with correct
  values.
- `prisma.session.create` is called once per issuance with the expected `{ userId, refreshToken,
expiresAt }` data (single-source-of-issuance invariant).

### Property-Based Tests

- **Fix Checking (Property 1)**: Generate random same-second issuance pairs and assert distinct
  refresh tokens, successful second-session persistence, and no error.
- **Preservation (Property 2)**: Generate random non-colliding inputs and assert the refresh
  verify path and access-token claim reads are unchanged and the response shape is preserved.
- Place new specs alongside existing ones as
  `apps/api/src/modules/auth/auth-token-uniqueness.property.spec.ts`, reusing the real-`JwtService`
  - in-memory-`PrismaService` harness pattern.

### Integration Tests

- End-to-end: two rapid `login` requests for the same user within one second both return 200 with
  distinct refresh tokens (replaces the masked behavior the e2e workaround hid).
- End-to-end: rapid `switchOrganization` → `refreshToken` round-trip in the same second completes
  successfully and preserves the active org across refresh.
- Regression: after removing the optional `deleteMany` workarounds in
  `org-switch.e2e-spec.ts` and `org-switch-refresh-roundtrip.e2e-spec.ts`, both suites still pass.

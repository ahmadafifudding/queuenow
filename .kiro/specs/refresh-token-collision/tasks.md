# Implementation Plan: Refresh Token Collision Fix

## Overview

This plan fixes the refresh-token collision in
`AuthService.generateTokens` (`apps/api/src/modules/auth/auth.service.ts`),
where two issuances for the same `(userId, orgId, role)` within the same
one-second `iat` bucket produce byte-identical refresh tokens, so the second
`prisma.session.create` collides on the `@unique Session.refreshToken` column
and surfaces as an unhandled HTTP 500.

The work follows the exploratory bugfix methodology:

1. **Explore** — write a property-based test that encodes the **Bug Condition**
   (same identity, same one-second bucket) and the **Expected Behavior**
   (distinct refresh tokens, no collision). Run it on the **UNFIXED** code where
   it is **EXPECTED TO FAIL**, confirming the collision and the root-cause
   hypothesis (shared non-unique payload + second-granularity `iat`).
2. **Preserve** — write property-based tests over the **non-bug-condition**
   domain and confirm they **PASS on the UNFIXED code**, capturing the baseline
   verification/claim/response behavior that must not change.
3. **Implement** — apply the single-point fix (add a unique `jti` claim to the
   shared signed payload in `generateTokens`).
4. **Validate** — re-run the same Property 1 and Property 2 tests; the bug-
   condition test now passes and the preservation tests still pass.

Implementation language: **TypeScript** (NestJS 11, Prisma 7, strict mode, no
`any`). Property tests use **Jest + fast-check** and reuse the existing
real-`JwtService` + in-memory mocked-`PrismaService` harness pattern from the
`apps/api/src/modules/auth/auth-*.property.spec.ts` suites, with the in-memory
`session.create` enforcing `refreshToken` uniqueness to mirror the `@unique`
column. New specs live in `apps/api/src/modules/auth/` as
`auth-token-uniqueness.property.spec.ts`. Each property test carries the repo
header comment `// Feature: refresh-token-collision, Property <n>: <text>`, a
`Validates: Requirements ...` line, and runs with `{ numRuns: 100 }` minimum.

## Tasks

- [x] 1. Write the bug-condition exploration property test (BEFORE the fix)
  - **Property 1: Bug Condition** - Unique Refresh Token By Construction
  - Create `apps/api/src/modules/auth/auth-token-uniqueness.property.spec.ts`
    with the header comment
    `// Feature: refresh-token-collision, Property 1: same-second issuances for the same (userId, orgId, role) yield distinct refresh tokens with no unique-constraint violation`
    and a `Validates: Requirements 2.1, 2.2, 2.3` line
  - **CRITICAL**: This test MUST FAIL on the unfixed code — the failure confirms
    the bug exists. **DO NOT fix the test or the code when it fails.**
  - **NOTE**: This test encodes the Expected Behavior — it becomes the
    fix-checking test that passes once the fix lands (re-run in task 3.2).
  - **GOAL**: Surface counterexamples that demonstrate the collision and confirm
    the root-cause hypothesis (shared non-unique payload + second-granularity
    `iat` → byte-identical refresh token → simulated `P2002`).
  - Reuse the harness from `auth-refresh.property.spec.ts`: a real `JwtService`,
    `createConfigService()` (`JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRATION`), and
    an in-memory `PrismaService` mock whose `session.create` **rejects on a
    duplicate `refreshToken`** (throws a `P2002`-shaped error) to mirror the
    `@unique Session.refreshToken` column
  - **Scoped PBT approach (deterministic bug)**: pin the clock to a single second
    (e.g. mock `Date`/`jwt` `iat`) so both issuances land in the same one-second
    bucket — `isBugCondition(X)` is forced true. `fast-check` generates random
    `(userId, orgId, role)` triples (`{ numRuns: 100 }`)
  - Invoke `generateTokens` (via `login`/`register`/`refreshToken`/
    `switchOrganization` or directly through the service) twice for the same
    identity within that pinned second; assert the Expected Behavior:
    `firstResult.refreshToken !== secondResult.refreshToken`, both Sessions
    persist, and no unique-constraint error/HTTP 500 is raised (per design
    Fix-Checking test cases: login double-issue, register→immediate, rapid
    refresh, switch same-second re-issue)
  - Run on UNFIXED code. **EXPECTED OUTCOME**: test FAILS — record the
    counterexamples (`firstResult.refreshToken === secondResult.refreshToken`
    byte-identical; second `session.create` rejects with the unique-constraint
    error)
  - Mark complete when the test is written, run, and the failure is documented
  - _Bug_Condition: isBugCondition(X) — same userId, orgId, role AND floor(iat) equal_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_

- [x] 2. Write the preservation property tests (BEFORE the fix)
  - **Property 2: Preservation** - Verification And Claims Unchanged
  - Add to `apps/api/src/modules/auth/auth-token-uniqueness.property.spec.ts`
    the header/`Validates` line for
    `// Feature: refresh-token-collision, Property 2: for non-colliding inputs the refresh verify path, JwtStrategy claims, session creation, and response shape are unchanged`
    and `Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5`
  - **IMPORTANT**: Follow the observation-first methodology — run the UNFIXED
    code over the `NOT isBugCondition(X)` domain (identities differing in
    `userId`/`orgId`/`role`, or issuances in different one-second buckets),
    observe the actual outputs, then encode them as properties
  - `fast-check` generates non-colliding inputs (`{ numRuns: 100 }`); assert the
    observed baseline contract per the design Preservation test cases:
    - Refresh verify-path: verifying the issued refresh token with
      `JWT_REFRESH_SECRET` reads `{ sub, orgId, role }` exactly as before (R3.1)
    - Access-token claims: the access token still carries
      `{ sub, orgId, role, type }` readable by `JwtStrategy` (R3.2)
    - Non-colliding issuance: each issuance still creates a backing `Session`
      and returns the token-pair shape (R3.3)
    - Single-source-of-issuance: `prisma.session.create` is called once per
      issuance with `{ userId, refreshToken, expiresAt }` (R3.4)
    - Response shape: `login`/`register`/`refreshToken`/`switchOrganization`
      still return the existing `ILoginResponse`/token-pair shape (R3.5)
  - Run on UNFIXED code. **EXPECTED OUTCOME**: tests PASS — this is the baseline
    behavior the fix must preserve
  - Mark complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix the refresh-token collision in `generateTokens`
  - [x] 3.1 Add a unique per-issuance `jti` claim to the shared payload
    - In `apps/api/src/modules/auth/auth.service.ts` add the top-level import
      `import { randomUUID } from 'node:crypto';` (standard Node API, fully
      typed — satisfies strict / no-`any`)
    - In the private `generateTokens(userId, orgId, role)` method, change the
      shared payload to
      `const payload = { sub: userId, orgId, role, type: 'staff', jti: randomUUID() };`
      so the encoded payload — and therefore the resulting refresh token — is
      unique by construction, independent of second-granularity `iat`
    - Keep everything else unchanged: both `jwtService.sign` calls share the one
      payload, the `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRATION` sign options,
      the 7-day `expiresAt`, the single
      `prisma.session.create({ data: { userId, refreshToken, expiresAt } })`, and
      the `{ accessToken, refreshToken }` return shape
    - Do NOT change any caller signatures or call sites — `generateTokens`
      remains the single source of token issuance and `Session` creation for
      `login`/`register`/`refreshToken`/`switchOrganization`
    - _Bug_Condition: isBugCondition(X) — same userId, orgId, role AND floor(iat) equal_
    - _Expected_Behavior: distinct refresh tokens, both Sessions persist, no unique-constraint violation / HTTP 500_
    - _Preservation: refresh verify path, JwtStrategy claims, non-colliding issuance, single-source-of-issuance, response shape all unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify the bug-condition exploration test now passes
    - **Property 1: Expected Behavior** - Unique Refresh Token By Construction
    - **IMPORTANT**: Re-run the SAME Property 1 test from task 1 — do NOT write a
      new test. The task-1 test encodes the Expected Behavior; its passing
      confirms the fix
    - **EXPECTED OUTCOME**: test PASSES — same-second issuances now yield
      distinct refresh tokens, both Sessions persist, and no unique-constraint
      violation / HTTP 500 occurs
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify the preservation tests still pass
    - **Property 2: Preservation** - Verification And Claims Unchanged
    - **IMPORTANT**: Re-run the SAME Property 2 tests from task 2 — do NOT write
      new tests
    - **EXPECTED OUTCOME**: tests PASS — the refresh verify path still reads
      `{ sub, orgId, role }`, `JwtStrategy` still reads
      `{ sub, orgId, role, type }` (the extra `jti` claim is ignored),
      non-colliding issuances still persist their `Session`, and every response
      shape is unchanged (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x]\* 4. (Optional) Remove the e2e `deleteMany` collision workarounds
  - Now that same-second issuances no longer collide, remove the
    `prisma.session.deleteMany({ where: { userId } })` pre-login workaround from
    `apps/api/test/org-switch.e2e-spec.ts` and
    `apps/api/test/org-switch-refresh-roundtrip.e2e-spec.ts`
  - Do this deliberately so each suite still exercises its intended scenario;
    confirm both suites still pass after removal
  - This is optional follow-up cleanup, not required for the fix to be correct
  - _Requirements: 2.3, 3.3, 3.5_

- [x] 5. Checkpoint - full verification
  - Run `pnpm --filter @queuenow/api test` (unit + property suites, including the
    new Property 1 and Property 2 tests)
  - Run `pnpm --filter @queuenow/api test:e2e` (real-DB e2e, including the
    org-switch suites)
  - Ensure everything is green; ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster landing,
  but are recommended. Tasks 1, 2, and 3 (with its verification sub-tasks) are
  the core bugfix methodology and are required.
- Property 1 (Bug Condition / Fix Checking) and Property 2 (Preservation) live
  together in `apps/api/src/modules/auth/auth-token-uniqueness.property.spec.ts`,
  reusing the real-`JwtService` + in-memory mocked-`PrismaService` harness; the
  mock's `session.create` enforces `refreshToken` uniqueness to mirror the
  `@unique` column. Both run with `{ numRuns: 100 }` minimum and carry the repo
  header comment `// Feature: refresh-token-collision, Property <n>: <text>`.
- The fix is a single-point change in `generateTokens`; because all four
  token-issuing paths funnel through it, `login`/`register`/`refreshToken`/
  `switchOrganization` are all fixed by the one change.
- No Prisma migration is required — the fix only adds a `jti` claim to the
  signed JWT payload and changes no schema.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5"] }
  ]
}
```

# Implementation Plan: Organization Switching

## Overview

This plan implements organization switching for QueueNow's flat multi-org model.
It fixes the **single-org lock** bug in `AuthService` and adds two authenticated
endpoints (`GET /auth/organizations`, `POST /auth/switch-organization`) plus the
frontend Org_Switcher.

Work is sequenced bottom-up so every step builds on the previous one with no
orphaned code:

1. Shared contracts first (Zod schema in `@queuenow/shared-validation`,
   `OrganizationMembership` in `@queuenow/shared-types`) so both backend and
   frontend compile against one source of truth.
2. Backend primitives (DTO, domain exceptions, the `AUTH_UNAUTHORIZED` envelope
   fix, the `ValidationPipe` `exceptionFactory`).
3. `AuthService` core logic (shared helpers, rewritten `login`/`refreshToken`,
   new `listOrganizations`/`switchOrganization`).
4. `AuthController` wiring of the two endpoints.
5. Frontend query/mutation hooks, cache-invalidation helper, and the
   `OrgSwitcher` mounted in `AppShell`.
6. Real-DB e2e suites and a full typecheck/test/build verification pass.

Implementation language: **TypeScript** (matches the design and the existing
monorepo). Backend property tests use **Jest + fast-check** (`apps/api`); the
frontend property test uses **Vitest + fast-check** (`apps/web`). Each property
test carries the repo header comment
`// Feature: organization-switching, Property <n>: <text>` and a
`Validates: Requirements …` line, and runs with `{ numRuns: 100 }` minimum.

## Tasks

- [x] 1. Add shared contracts for organization switching
  - [x] 1.1 Add `switchOrganizationSchema` to `@queuenow/shared-validation`
    - In `packages/shared-validation/src/index.ts` add
      `export const switchOrganizationSchema = z.object({ orgId: z.string().uuid() })`
      and `export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>`
    - Mirrors the backend `SwitchOrganizationDto` so the web mutation validates symmetrically
    - _Requirements: 2.12, 7.6_

  - [x] 1.2 Add `OrganizationMembership` response type to `@queuenow/shared-types`
    - Define `interface OrganizationMembership { id: string; name: string; slug: string; isActive: boolean; role: UserRoleType; active: boolean }`
    - Reuse the existing `UserRoleType` enum/type for `role`; export from the package index
    - This is the element type for `GET /auth/organizations` consumed by both `AuthService` and the web hooks
    - _Requirements: 1.2, 1.3, 1.5_

- [x] 2. Implement backend request/response primitives
  - [x] 2.1 Create `SwitchOrganizationDto`
    - Create `apps/api/src/modules/auth/dto/switch-organization.dto.ts` with `@IsUUID()` on `orgId` and an `@ApiProperty({ format: 'uuid' })`
    - _Requirements: 2.12, 7.6_

  - [x]\* 2.2 Write DTO validation spec for `SwitchOrganizationDto`
    - Create `apps/api/src/modules/auth/dto/switch-organization.dto.spec.ts` (mirror `change-plan.dto.spec.ts`)
    - Assert missing `orgId` and non-UUID `orgId` fail class-validator; a valid UUID passes
    - _Requirements: 2.12_

  - [x] 2.3 Create `AuthForbiddenException` and `OrgInactiveException`
    - Create `apps/api/src/common/exceptions/auth-forbidden.exception.ts` (HTTP 403, code `AUTH_FORBIDDEN`) and `org-inactive.exception.ts` (HTTP 403, code `ORG_INACTIVE`) following the `OrgNotFoundException` pattern (carry `{ code, message }`)
    - _Requirements: 2.7, 2.8, 2.9, 3.9, 7.3, 7.4_

  - [x] 2.4 Add the `AUTH_UNAUTHORIZED`-coded `UnauthorizedException` subclass and point auth at it
    - Create an `UnauthorizedException` subclass (e.g. `apps/api/src/common/exceptions/auth-unauthorized.exception.ts`) that carries `code: ERROR_CODES.AUTH_UNAUTHORIZED` so `HttpExceptionFilter` emits the spec'd code instead of the generic `'ERROR'`
    - Point `JwtStrategy`/`JwtAuthGuard` (missing/invalid access token) at the new exception so the envelope code is `AUTH_UNAUTHORIZED`
    - _Requirements: 1.9, 2.11, 3.8, 7.2, 7.6_

  - [x]\* 2.5 Write exception specs
    - Add `auth-forbidden.exception.spec.ts`, `org-inactive.exception.spec.ts`, and a spec for the `AUTH_UNAUTHORIZED` subclass under `apps/api/src/common/exceptions/` (mirror `org-not-found.exception.spec.ts`)
    - Assert each carries the expected `ERROR_CODES` value and HTTP status
    - _Requirements: 7.6_

  - [x] 2.6 Configure the global `ValidationPipe` `exceptionFactory` to emit `VALIDATION_ERROR`
    - In `apps/api/src/main.ts`, set the `ValidationPipe` `exceptionFactory` to throw a domain `ValidationException` carrying `{ code: ERROR_CODES.VALIDATION_ERROR, message, details }` so malformed bodies surface `VALIDATION_ERROR` (not `'ERROR'`) across every endpoint
    - Mirror the same pipe configuration in the e2e harness `apps/api/test/utils/e2e-app.ts` (`createE2EApp`) so e2e behavior matches production
    - _Requirements: 2.12, 7.5, 7.6_

- [x] 3. Implement `AuthService` shared resolution helpers
  - [x] 3.1 Add the `compareMemberships` comparator and `selectDefaultMembership`
    - In `apps/api/src/modules/auth/auth.service.ts` add the private `compareMemberships(a, b)` comparator: `createdAt` ascending, tie-broken by `orgId` ascending Unicode code-point order
    - Add private `selectDefaultMembership(memberships)` that filters to `org.isActive === true`, sorts by `compareMemberships`, and returns `[0] ?? null`
    - _Requirements: 1.4, 4.1, 4.2, 4.3, 4.4_

  - [x]\* 3.2 Write property test for default-organization selection
    - **Property 4: Deterministic default-organization selection** (Jest + fast-check, `apps/api/src/modules/auth/auth-default-membership.property.spec.ts`)
    - Generate membership sets with forced `createdAt` ties, mixed active/inactive orgs, and empty/singleton cases; assert earliest `createdAt`, tie-break smallest `orgId`, never an inactive org
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x] 3.3 Add `resolveActiveMembership` and `buildLoginResponse`
    - Add private `resolveActiveMembership(memberships, targetOrgId)` that throws in fixed order: membership absent → `AuthForbiddenException`; then `org.isActive === false` → `OrgInactiveException`
    - Add private `buildLoginResponse(user, membership, tokens)` that produces the `ILoginResponse` (`user`, `organization` `{ id, name, slug, role }`, `tokens`) shared by login/switch/refresh
    - _Requirements: 2.2, 2.13, 3.5, 7.1, 7.3, 7.4_

- [x] 4. Rewrite `login` and `refreshToken`, add `listOrganizations` and `switchOrganization`
  - [x] 4.1 Rewrite `AuthService.login()` for deterministic default selection
    - Replace `primaryRole = user.roles[0]` with `selectDefaultMembership(user.roles)`; if `null` throw `AuthForbiddenException('No active organization assigned')`
    - Otherwise `generateTokens(user.id, membership.orgId, membership.role)` and return `buildLoginResponse(...)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]\* 4.2 Write property test for login with no eligible membership
    - **Property 11: Login with no eligible membership is forbidden** (Jest + fast-check, `apps/api/src/modules/auth/auth-login.property.spec.ts`)
    - Generate users with zero memberships or all-inactive memberships; assert `login` rejects `AUTH_FORBIDDEN` and issues neither access nor refresh tokens
    - **Validates: Requirements 4.6**

  - [x] 4.3 Rewrite `AuthService.refreshToken()` to read the active org from the refresh-token claim
    - Find `Session` by `refreshToken`; missing/expired → `AUTH_UNAUTHORIZED`
    - `jwtService.verify(refreshToken, { secret: JWT_REFRESH_SECRET })` to read `claims.orgId`; verify failure → `AUTH_UNAUTHORIZED`
    - `resolveActiveMembership(memberships, claims.orgId)` (membership gone → `AUTH_FORBIDDEN`; inactive → `ORG_INACTIVE`); take `role` from the current membership, not `claims.role`
    - Delete the old session, `generateTokens(user.id, claims.orgId, membership.role)`, return `buildLoginResponse(...)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9_

  - [x] 4.4 Add `AuthService.listOrganizations(userId, activeOrgId)`
    - Load all of the user's memberships incl. `org`; map each to `OrganizationMembership` (`id`, `name`, `slug`, `isActive`, `role`, `active = id === activeOrgId`)
    - Order by `compareMemberships` (all memberships, active and inactive); mark `active: true` on exactly the entry whose `id === activeOrgId`, none if no match
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.10_

  - [x]\* 4.5 Write property tests for `listOrganizations`
    - **Property 1: List completeness and projection**, **Property 2: Deterministic list ordering**, **Property 3: Exactly one (or zero) active entry** (Jest + fast-check, `apps/api/src/modules/auth/auth-list-organizations.property.spec.ts`)
    - Generate membership sets incl. empty/singleton, inactive orgs, ties, and a presented active `orgId` drawn from members/non-members
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.10**

  - [x] 4.6 Add `AuthService.switchOrganization(userId, targetOrgId, presentedRefreshToken)`
    - Load user + memberships; `resolveActiveMembership(memberships, targetOrgId)` (forbidden before inactive) — all checks before any token is generated
    - Delete the `Session` for `presentedRefreshToken`, then `generateTokens(user.id, targetOrgId, membership.role)` (creates the new Session); already-active target is a normal switch (not special-cased)
    - Return `buildLoginResponse(...)`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.13, 6.1, 6.2, 6.3_

  - [x]\* 4.7 Write property tests for switch/refresh token claims, rotation, and authorization
    - **Property 5: Issued token claims reflect target/active org and current role**, **Property 6: Session rotation on switch and refresh**, **Property 7: Membership authorization (forbidden)**, **Property 8: Inactive organization rejection**, **Property 12: No side effects on rejection**, **Property 13: Check ordering — membership before active status** (Jest + fast-check, real `JwtService` + mocked `PrismaService`, `apps/api/src/modules/auth/auth-switch.property.spec.ts`)
    - Generate role drift between the token claim and current membership, targets drawn from members/non-members/never-created ids, and member-but-inactive orgs
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.7, 2.8, 2.9, 2.13, 3.3, 3.4, 3.5, 4.5, 6.1, 6.2, 6.3, 7.1, 7.3, 7.4**

  - [x]\* 4.8 Write property tests for refresh round-trip and refresh error conditions
    - **Property 9: Switch → refresh round-trip organization consistency**, **Property 10: Refresh error conditions** (Jest + fast-check, real `JwtService`, `apps/api/src/modules/auth/auth-refresh.property.spec.ts`)
    - For P9 run `switchOrganization(target)` then `refreshToken` with the produced refresh token and assert refreshed `orgId === target`; for P10 generate no-session/expired-session refresh tokens and assert `AUTH_UNAUTHORIZED` with no tokens issued
    - **Validates: Requirements 3.1, 3.2, 3.6, 3.8**

- [x] 5. Wire the new endpoints into `AuthController`
  - [x] 5.1 Add `GET /auth/organizations` and `POST /auth/switch-organization`
    - In `apps/api/src/modules/auth/auth.controller.ts` add both routes, each with a per-route `@UseGuards(JwtAuthGuard)` and `@ApiBearerAuth()`
    - `listOrganizations` reads `@CurrentUser() user` and returns `authService.listOrganizations(user.id, user.orgId)`
    - `switchOrganization` binds `SwitchOrganizationDto`, reuses `extractRefreshToken(req)` for the presented refresh token, calls `authService.switchOrganization(...)`, and returns via `respondWithRefreshCookie(res, result)` (`@HttpCode(200)`)
    - _Requirements: 1.1, 1.6, 1.9, 2.1, 2.2, 2.3, 2.11, 6.4_

  - [x]\* 5.2 Write route-guard-metadata spec
    - Create `apps/api/src/modules/auth/auth.controller.spec.ts` (mirror `organization-change-plan.spec.ts`) asserting both new routes carry `JwtAuthGuard`
    - _Requirements: 1.9, 2.11, 7.2_

- [x] 6. Checkpoint - backend unit/property suite green
  - Run `pnpm --filter @queuenow/api test`. Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement frontend query/mutation hooks and cache invalidation
  - [x] 7.1 Add `queryKeys.organizations()` factory entry
    - In `apps/web/src/lib/api/query-keys.ts` add `organizations: () => ['organizations'] as const` — deliberately user-scoped (NOT org-scoped) so it survives a switch
    - _Requirements: 5.1, 5.10_

  - [x] 7.2 Add the `invalidateOrgScopedQueries` helper
    - Create `apps/web/src/lib/api/invalidate-org-scoped.ts` (or extend the existing invalidation lib) that `removeQueries` by org-scoped first-element prefixes (`queue`, `services`, `counters`, `staff`, `ticket`, `org-stats`, `organization`, `plan-usage`), preserving `['organizations']`
    - _Requirements: 5.10, 5.12_

  - [x]\* 7.3 Write property test for org-scoped cache invalidation
    - **Property 14: Frontend org-scoped cache invalidation** (Vitest + fast-check, `apps/web/src/lib/api/__tests__/invalidate-org-scoped.property.test.ts`)
    - Generate arbitrary cached key sets from the central `queryKeys` factory plus `['organizations']` and random foreign keys; assert exactly the org-scoped prefixes are removed and `['organizations']` is untouched
    - **Validates: Requirements 5.10**

  - [x] 7.4 Add the `useOrganizations` query hook
    - Create `apps/web/src/features/auth/api/useOrganizations.ts` calling `GET /auth/organizations`, keyed by `queryKeys.organizations()`, `enabled` only when authenticated; returns `OrganizationMembership[]`
    - _Requirements: 5.1, 5.2_

  - [x] 7.5 Add the `useSwitchOrganization` mutation hook
    - Create `apps/web/src/features/auth/api/useSwitchOrganization.ts` calling `POST /auth/switch-organization` with the selected `orgId`
    - `onSuccess`: `setSession(data)` (new access token + `organization`), then `invalidateOrgScopedQueries(queryClient)`; rely on existing `lib/socket.ts` `watchTokenChanges` for the socket reconnect (no explicit call)
    - _Requirements: 5.4, 5.7, 5.8, 5.9, 5.10, 5.12_

  - [x]\* 7.6 Write hook tests for `useSwitchOrganization`
    - Create `apps/web/src/features/auth/api/__tests__/useSwitchOrganization.test.tsx` (Vitest + RTL, mocked API client/store): `onSuccess` updates the auth-store token and `organization` (R5.7, R5.8) and calls `invalidateOrgScopedQueries` (R5.10); a token change drives a socket reconnect via `watchTokenChanges` (R5.9); on failure `onSuccess` never runs so state is unchanged (R5.12)
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.12_

- [x] 8. Build the `OrgSwitcher` and mount it in `AppShell`
  - [x] 8.1 Add i18n strings for the switcher
    - Add the user-facing strings (switcher label, inactive badge, pending/loading, list-fetch-failed, switch-failed) to the centralized copy module so EN/MS can be added later (no hardcoded strings in the component)
    - _Requirements: 5.1, 5.2, 5.12_

  - [x] 8.2 Implement the `OrgSwitcher` component
    - Create `apps/web/src/features/auth/components/OrgSwitcher.tsx` as a thin composition over the shadcn dropdown/menu primitive
    - Calls `useOrganizations()`; renders the active entry with a persistent selected-state marker (R5.3); single membership (≤1) renders as a static hidden/disabled label (R5.11); selecting the active org is a no-op (R5.5); selecting a non-active org calls `useSwitchOrganization` (R5.4); shows pending and ignores selections in-flight (R5.6); a list-fetch failure surfaces inline and leaves the active org unchanged (R5.2); a switch failure shows an error via `getErrorMessage(error)` with state untouched (R5.12)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.11, 5.12, 6.6_

  - [x] 8.3 Mount `OrgSwitcher` in `AppShell`
    - Add an optional slot in `apps/web/src/features/auth/components/AppShell.tsx` (sidebar header beside the org name) and render `OrgSwitcher` there without restructuring the existing layout
    - _Requirements: 5.1_

  - [x]\* 8.4 Write `OrgSwitcher` component tests
    - Create `apps/web/src/features/auth/components/__tests__/OrgSwitcher.test.tsx` (Vitest + RTL, mocked hooks): renders the list (R5.1), marks exactly the active entry (R5.3), no-op on selecting active (R5.5), calls the mutation with the chosen `orgId` on a non-active entry (R5.4), shows pending and ignores selections in-flight (R5.6), hides/disables for a single membership (R5.11), and on failure shows the `error.code` message while leaving state unchanged (R5.2, R5.12)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.11, 5.12_

- [x] 9. Add real-DB e2e suites
  - [x] 9.1 Write `org-switch.e2e-spec.ts`
    - Create `apps/api/test/org-switch.e2e-spec.ts` reusing `createE2EApp`/`registerTestOwner`/`setOrgPlan`/`cleanupTestOrg`; `describe.skip` when no `DATABASE_URL`
    - Register an owner, create a second org + membership for the same user via Prisma, then over real HTTP: list orgs (envelope shape, ordering, active flag — R1.6); switch and assert `Set-Cookie` `refresh_token` attributes (httpOnly, `SameSite=Lax`, path `/api/v1/auth`) and that body `tokens` omits `refreshToken` (R2.3); assert old `Session` gone + new one exists (R2.4, R2.5); anonymous requests to both endpoints return 401 `AUTH_UNAUTHORIZED` (R7.2); malformed body returns 400 `VALIDATION_ERROR` (R2.12); error bodies carry the envelope with no stack in `details` (R7.5)
    - _Requirements: 1.6, 1.9, 2.3, 2.4, 2.5, 2.11, 2.12, 6.4, 6.5, 7.2, 7.5_

  - [x] 9.2 Write `org-switch-refresh-roundtrip.e2e-spec.ts`
    - Create `apps/api/test/org-switch-refresh-roundtrip.e2e-spec.ts`: switch to the second org, then `POST /auth/refresh` with the returned refresh cookie and assert the refreshed `organization.id` equals the switched-to org (not the default) — the R3.6 headline guarantee end-to-end
    - _Requirements: 3.1, 3.2, 3.6_

- [x] 10. Final checkpoint - full verification
  - Run `pnpm --filter @queuenow/web typecheck`, `pnpm --filter @queuenow/web test`, and `pnpm --filter @queuenow/web build`
  - Run `pnpm --filter @queuenow/api test` and `pnpm --filter @queuenow/api test:e2e`
  - Ensure everything is green; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP, but they encode the design's Correctness Properties and example
  coverage and are recommended.
- Each task references specific requirement clauses for traceability and names
  the design components it implements.
- Property tests P1–P13 run under Jest in `apps/api`; P14 runs under Vitest in
  `apps/web`. Every property test uses the repo header comment
  `// Feature: organization-switching, Property <n>: <text>` and `{ numRuns: 100 }` minimum.
- No Prisma migration is required — the feature reads existing
  `UserRole.createdAt`, `Organization.isActive`, and `Session` fields only.
- `generateTokens` remains the single source of truth for token issuance +
  session creation across login/switch/refresh.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "7.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.4", "2.6", "7.2"] },
    { "id": 2, "tasks": ["2.2", "2.5", "3.1", "7.3", "7.4"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["4.1", "4.4"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.5"] },
    { "id": 6, "tasks": ["4.6", "4.8"] },
    { "id": 7, "tasks": ["4.7", "5.1", "7.5"] },
    { "id": 8, "tasks": ["5.2", "7.6", "8.1"] },
    { "id": 9, "tasks": ["8.2", "9.1", "9.2"] },
    { "id": 10, "tasks": ["8.3"] },
    { "id": 11, "tasks": ["8.4"] }
  ]
}
```

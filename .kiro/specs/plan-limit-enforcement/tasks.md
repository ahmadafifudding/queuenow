# Implementation Plan: Plan Limit Enforcement

## Overview

This plan turns the dormant `PLAN_LIMITS` table into an enforced security boundary in the QueueNow
API and mirrors that enforcement in the web app. Work proceeds bottom-up: shared constants/types
first, then the custom exceptions, then the central `PlanLimitsService` + window helper (the pure
enforcement core), then atomic numeric enforcement wired into the Service/Counter/Staff/Queue create
flows, then the feature-gate guard/decorator on TV Display and the analytics/stats surface, then the
plan-change and plan-usage endpoints, then the frontend mirroring (hooks, views, nav gating, error
handling), and finally the UAT checklist plus a full green-build verification.

Property-based tests reference the design's Correctness Properties (Properties 1–13) and the
requirement IDs they validate. Each property test is tagged in the repo convention
`// Feature: plan-limit-enforcement, Property {n}: {text}` and run with `fast-check` (Jest on the
backend, Vitest on the frontend) at a minimum of 100 runs.

## Tasks

- [x] 1. Add shared constants and types for plan enforcement
  - [x] 1.1 Add `PLAN_LIMIT_EXCEEDED` to `ERROR_CODES` and plan enforcement types to shared packages
    - Add `PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED'` to `ERROR_CODES` in `packages/shared-constants/src/index.ts`
    - Add `NumericResource` (`'services' | 'counters' | 'staff' | 'queuePerDay'`) and `FeatureFlag` (`'tvDisplay' | 'analytics' | 'customBranding'`) types to `@queuenow/shared-types`
    - Add `PlanUsageResource` and `PlanUsageResponse` interfaces (plan, features record, per-resource usage/limit/atLimit) to `@queuenow/shared-types`
    - Export new symbols from each package's barrel so `apps/api` and `apps/web` can consume them
    - _Requirements: 7.1, 8.1, 8.2, 8.3_

  - [x]\* 1.2 Write smoke test asserting `ERROR_CODES.PLAN_LIMIT_EXCEEDED` is present
    - Assert the constant exists and equals `'PLAN_LIMIT_EXCEEDED'`
    - _Requirements: 7.1_

- [x] 2. Add custom exceptions for plan enforcement
  - [x] 2.1 Implement `PlanLimitExceededException` and `OrgNotFoundException`
    - Create `apps/api/src/common/exceptions/plan-limit-exceeded.exception.ts` extending `HttpException`, HTTP 403, carrying `{ code: ERROR_CODES.PLAN_LIMIT_EXCEEDED, message, details }`; support numeric details (`{ limitName, limit, currentUsage, plan }`) and feature details (`{ flag, plan }`) via a `buildMessage` helper that always produces a non-empty message
    - Create `apps/api/src/common/exceptions/org-not-found.exception.ts` extending `HttpException`, HTTP 404, `code: ORG_NOT_FOUND`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 3.4, 6.5_

  - [x]\* 2.2 Write property test for the PLAN_LIMIT_EXCEEDED error envelope
    - **Property 9: PLAN_LIMIT_EXCEEDED error envelope shape**
    - Generate numeric and feature `details`, run the exception through the real `HttpExceptionFilter`, assert `success === false`, `error.code === 'PLAN_LIMIT_EXCEEDED'`, non-empty message, plan in details, HTTP 403; numeric adds `limitName`/`limit`/`currentUsage`, feature has `flag` and omits `limit`/`currentUsage`
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6**

  - [x]\* 2.3 Write unit test confirming exceptions flow through `HttpExceptionFilter`
    - Assert `OrgNotFoundException` yields the standard envelope with `ORG_NOT_FOUND` and HTTP 404
    - _Requirements: 3.4, 6.5_

- [x] 3. Implement the daily-window helper
  - [x] 3.1 Implement `resolveDailyWindow` in `plan-window.util.ts`
    - Create `apps/api/src/modules/plan/plan-window.util.ts` with the pure `resolveDailyWindow(timezone, resetTime, now)` returning `{ start, end, windowDate }`, computing the half-open `[start, end)` org-timezone window beginning at `resetTime`, DST-aware, defaulting `resetTime` to `QUEUE_DEFAULTS.RESET_TIME`
    - _Requirements: 2.4_

  - [x]\* 3.2 Write property test for the daily window
    - **Property 3: Daily-volume window is the org-timezone reset-time day**
    - Generate timezone, `resetTime` (`HH:MM`), and `now`; assert `start <= now < end`, the interval spans exactly one calendar day in that timezone (including DST boundaries), and `start`'s wall-clock time equals `resetTime` (timezone-pinned oracle)
    - **Validates: Requirements 2.4**

- [x] 4. Implement the central `PlanLimitsService` and `PlanModule`
  - [x] 4.1 Implement `PlanLimitsService` pure policy methods
    - Create `apps/api/src/modules/plan/plan-limits.service.ts` with `limitsFor(plan)` (resolve `PLAN_LIMITS` entry) and `isFeatureEnabled(plan, flag)` using only `@queuenow/shared-constants`
    - _Requirements: 1.4, 3.1, 3.2, 4.1, 4.2_

  - [x]\* 4.2 Write property test for the numeric-limit decision
    - **Property 1: Numeric-limit decision is allow-iff-below-limit**
    - For any plan, resource, and non-negative usage, ALLOW when limit is `null` or `usage < limit`, REJECT with `PLAN_LIMIT_EXCEEDED` when limit is a number and `usage >= limit` (test against an in-memory enforcement model)
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 5.2, 5.6**

  - [x]\* 4.3 Write property test for the feature-gate decision
    - **Property 5: Feature gate permits iff the plan enables the flag, independent of auth source**
    - For any plan and flag, permit iff the plan's flag is `true`; decision depends only on the resolved org plan (identical for param-resolved and JWT-resolved orgId)
    - **Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2**

  - [x] 4.4 Implement `assertWithinNumericLimit` and `assertWithinDailyQueueLimit`
    - Add `assertWithinNumericLimit(tx, orgId, resource)`: load org plan (throw `OrgNotFoundException` if missing), resolve the limit name/value, return on `null`, count usage within `tx` (services/counters via `count`; staff = `userRole.count` + `PENDING` invitation count), throw `PlanLimitExceededException` when `usage >= limit`
    - Add `assertWithinDailyQueueLimit(tx, orgId)`: resolve window via `resolveDailyWindow` (reading `QueueSettings.resetTime` + org timezone), sum `DailyQueueCounter.lastNumber` for the window date, apply the same `>=` rejection rule, return on `null` `maxQueuePerDay`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 5.2_

  - [x]\* 4.5 Write stateful property test for the never-exceeds usage invariant
    - **Property 2: Usage never exceeds the limit and rejects leave usage unchanged**
    - Use a model-based/stateful generator (`fc.commands` or sequence generator) over create/delete sequences (including interleavings) against the in-memory model; assert committed usage never exceeds the limit, every reject returns `PLAN_LIMIT_EXCEEDED` and leaves usage unchanged, and a delete below the limit re-permits the next create
    - **Validates: Requirements 1.3, 1.6, 5.6**

  - [x]\* 4.6 Write property test for daily-volume creation counting
    - **Property 4: Daily volume counts creations regardless of later state changes**
    - Generate create-then-mutate/delete sequences within a window; assert measured Daily_Queue_Volume equals the number of in-window creations
    - **Validates: Requirements 2.5**

  - [x] 4.7 Implement `getPlanUsage` and register `PlanModule`
    - Add `getPlanUsage(orgId)` returning `PlanUsageResponse` (plan, `features` record, per-resource `usage`/`limit`/`atLimit`), reusing the same counting logic and window helper
    - Create `apps/api/src/modules/plan/plan.module.ts` as `@Global()`, providing and exporting `PlanLimitsService`; register it in `app.module.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]\* 4.8 Write unit tests for `getPlanUsage` projection
    - Cover `null` limit ⇒ `atLimit === false` and unlimited representation, and `usage >= limit` ⇒ `atLimit === true`
    - _Requirements: 8.2, 8.3, 8.4_

- [x] 5. Checkpoint - enforcement core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Wire atomic numeric-limit enforcement into create flows
  - [x] 6.1 Enforce `maxServices` in `ServiceService.create`
    - Wrap the create in `prisma.$transaction` at `Serializable` isolation, call `assertWithinNumericLimit(tx, orgId, 'services')` before `tx.service.create`, keep existing uniqueness checks inside the tx; add a `runSerializable()` retry-once wrapper for `40001` serialization failures
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 6.2 Enforce `maxCounters` in `CounterService.create`
    - Same transactional pattern calling `assertWithinNumericLimit(tx, orgId, 'counters')`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 6.3 Enforce `maxStaff` in `StaffService` invite/add flow
    - Wrap invite/add in the Serializable transaction, call `assertWithinNumericLimit(tx, orgId, 'staff')` (count = existing `UserRole` rows + `PENDING` invitations), and create the invitation/role inside the same tx
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [ ]\* 6.4 Write unit tests for Service/Counter/Staff create enforcement
    - Assert allow below limit, reject with `PLAN_LIMIT_EXCEEDED` at/over limit, usage unchanged on reject, and `null` ⇒ unlimited; for staff assert pending invitations count toward `maxStaff`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 7. Wire daily-queue-volume enforcement into the join flow
  - [x] 7.1 Enforce `maxQueuePerDay` in `QueueService.joinQueue`
    - Inside `joinQueue`'s transaction, call `assertWithinDailyQueueLimit(tx, orgId)` before creating the ticket; increment `DailyQueueCounter.lastNumber` and create the ticket in the same tx so the check and create are atomic
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x]\* 7.2 Write unit tests for daily-volume enforcement
    - Assert allow below `maxQueuePerDay`, reject with `PLAN_LIMIT_EXCEEDED` at/over, `null` ⇒ unlimited, and window boundary behavior using `resolveDailyWindow`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 8. Implement the feature-gate guard and decorator
  - [x] 8.1 Implement `@RequiresFeature` decorator and `PlanFeatureGuard`
    - Create `apps/api/src/common/decorators/requires-feature.decorator.ts` (`SetMetadata(REQUIRES_FEATURE_KEY, flag)`)
    - Create `apps/api/src/common/guards/plan-feature.guard.ts` resolving `orgId` from `req.params.orgId ?? req.user.orgId`, throwing `OrgNotFoundException` when missing/unknown (decided before the feature check), and `PlanLimitExceededException` when `isFeatureEnabled` is false
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2_

  - [x] 8.2 Apply the gate to TV Display (public by orgId)
    - Add `@UseGuards(PlanFeatureGuard)` + `@RequiresFeature('tvDisplay')` to the public `DisplayController`; ensure `ORG_NOT_FOUND` precedence over the feature check for unknown orgId
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 8.3 Apply the gate to the analytics/stats surface (authenticated)
    - Add `@RequiresFeature('analytics')` + `PlanFeatureGuard` to the existing authenticated `GET /organizations/:id/stats` surface (behind `JwtAuthGuard`), resolving `orgId` from `user.orgId`
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]\* 8.4 Write unit tests for guard ordering and error paths
    - TV Display: `ORG_NOT_FOUND` for unknown orgId (precedence), `PLAN_LIMIT_EXCEEDED` when `tvDisplay` false, allow when true; Analytics: `AUTH_UNAUTHORIZED` for anonymous, `PLAN_LIMIT_EXCEEDED` when `analytics` false
    - _Requirements: 3.1, 3.3, 3.4, 4.1, 4.3_

- [x] 9. Implement the manual plan-change endpoint
  - [x] 9.1 Implement `ChangePlanDto` and `OrganizationService.changePlan`
    - Create `apps/api/src/modules/organization/dto/change-plan.dto.ts` validating `plan` ∈ `{FREE,BASIC,PRO,ENTERPRISE}` (enum)
    - Implement `changePlan(id, plan, user)`: validate org-scope access, `findUnique` ⇒ `OrgNotFoundException` if missing, return unchanged org when `org.plan === plan` (idempotent), else `organization.update({ data: { plan } })` returning the updated org; perform no side effects on existing resources
    - _Requirements: 6.1, 6.5, 6.6, 6.7, 5.1, 5.4_

  - [x] 9.2 Add `PATCH /organizations/:id/plan` (OWNER-only)
    - Add the `changePlan` handler to `OrganizationController` with `@Roles('OWNER')` behind `JwtAuthGuard` + `RolesGuard`; non-OWNER ⇒ `AUTH_FORBIDDEN`, anon ⇒ `AUTH_UNAUTHORIZED`, invalid plan ⇒ `VALIDATION_ERROR`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]\* 9.3 Write property test for plan-change semantics
    - **Property 8: Plan change sets the target, is idempotent, and governs later decisions**
    - For any current and valid target plan, result plan equals target; target == current ⇒ unchanged, no error; applying twice == once; later enforcement uses the new plan's limits
    - **Validates: Requirements 6.1, 6.6, 6.7**

  - [ ]\* 9.4 Write property tests for grandfathering invariants
    - **Property 6: A plan change never mutates existing resources or configuration**
    - **Property 7: Disabling then re-enabling a feature preserves config and restores access**
    - For any org state and target plan, only `plan` changes; a feature disable→enable round-trip preserves config and restores access
    - **Validates: Requirements 5.1, 5.4, 5.5**

  - [ ]\* 9.5 Write unit tests for plan-change auth and validation error paths
    - `AUTH_FORBIDDEN` for ADMIN/STAFF (plan unchanged), `AUTH_UNAUTHORIZED` for anonymous, `VALIDATION_ERROR` for non-enum target, `ORG_NOT_FOUND` for missing org; over-limit existing resources remain readable/updatable (R5.3)
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 5.3_

- [x] 10. Implement the plan-usage endpoint
  - [x] 10.1 Add `GET /organizations/:id/plan-usage` (OWNER/ADMIN)
    - Add the handler to `OrganizationController` behind `JwtAuthGuard` + `RolesGuard('OWNER','ADMIN')` delegating to `PlanLimitsService.getPlanUsage`, returning `PlanUsageResponse` (plan + per-resource usage/limit/atLimit + features)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]\* 10.2 Write unit test for the plan-usage endpoint contract
    - Assert response includes plan, features record, and a resource entry per `NumericResource` with correct `atLimit`/`limit` (null ⇒ unlimited)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 11. Checkpoint - backend enforcement complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Real-DB concurrency and direct-API integration tests
  - [ ]\* 12.1 Write the real-database concurrency integration test
    - **Property 2: Usage never exceeds the limit and rejects leave usage unchanged** (real transactional guarantee)
    - Issue N parallel create requests for the same resource/org while `currentUsage = limit − 1` against real Postgres at `Serializable` isolation; assert final committed count equals `limit` and excess requests received `PLAN_LIMIT_EXCEEDED` (HTTP 403)
    - **Validates: Requirements 1.6**

  - [ ]\* 12.2 Write the direct-API over-limit Supertest
    - Via Supertest (no UI), create an over-limit resource and assert the response envelope has `error.code === 'PLAN_LIMIT_EXCEEDED'` and HTTP status 403
    - _Requirements: 10.7_

- [ ] 13. Frontend: query keys, hooks, and error mapping
  - [ ] 13.1 Add `planUsage` query key and `usePlanUsage`/`useChangePlan` hooks
    - Add `planUsage(orgId)` to `apps/web/src/lib/api/query-keys.ts`
    - Create `features/organization/api/usePlanUsage.ts` (`useQuery` for `GET :id/plan-usage`)
    - Create `features/organization/api/useChangePlan.ts` (`useMutation` `PATCH :id/plan`) invalidating `planUsage`, the org query, and gated lists
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 6.1, 6.7_

  - [ ] 13.2 Map `PLAN_LIMIT_EXCEEDED` and add `onPlanLimitError` helper
    - Add friendly copy for `PLAN_LIMIT_EXCEEDED` in `lib/api/error-map.ts` and `i18n/en.ts`
    - Add a shared `onPlanLimitError` helper that, when `ApiError.code === 'PLAN_LIMIT_EXCEEDED'`, shows the upgrade prompt and does not reset the form (retains unsaved input)
    - _Requirements: 8.5_

  - [ ]\* 13.3 Write property test for the upgrade-prompt classifier
    - **Property 12: Upgrade prompt is triggered exactly by PLAN_LIMIT_EXCEEDED**
    - For any API error, the classifier returns `true` iff `code === 'PLAN_LIMIT_EXCEEDED'`
    - **Validates: Requirements 8.5**

- [ ] 14. Frontend: Plan & Usage view and plan-change dialog
  - [ ] 14.1 Implement the usage formatter and `PlanUsageView`
    - Add a pure formatter returning `"{usage} / {limit}"` for numeric limits and `"Unlimited"` for `null`
    - Create `features/organization/components/PlanUsageView.tsx` rendering plan name, per-resource usage/limit, per-resource upgrade prompt for at-limit resources, and an error indication (no usage values) on query failure
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_

  - [ ]\* 14.2 Write property test for usage formatting
    - **Property 10: Usage formatting renders the limit or "Unlimited"**
    - For any non-negative usage/limit, returns `"{usage} / {limit}"` for numeric and `"Unlimited"` for `null`
    - **Validates: Requirements 8.2, 8.3**

  - [ ]\* 14.3 Write property test for at-limit upgrade prompts
    - **Property 11: Upgrade prompts appear exactly for at-limit resources**
    - For any plan-usage projection, the set of resources showing an upgrade prompt equals the set whose limit is numeric and `usage >= limit`
    - **Validates: Requirements 8.4**

  - [ ] 14.4 Implement `PlanChangeDialog`
    - Create `features/organization/components/PlanChangeDialog.tsx` (OWNER-only target-plan picker) wired to `useChangePlan`
    - _Requirements: 6.1, 8.4, 9.4_

  - [ ]\* 14.5 Write unit tests for `PlanUsageView` states
    - Renders plan name (R8.1); shows error indication with no usage values on query failure (R8.6)
    - _Requirements: 8.1, 8.6_

- [ ] 15. Frontend: feature-gate mirroring in navigation
  - [ ] 15.1 Implement `usePlanFeatures` and `AppShell` feature gating
    - Add `usePlanFeatures()` in `features/auth/capabilities.ts` resolving `{tvDisplay, analytics}` from `planUsage.features`
    - Add optional `featureFlag?: FeatureFlag` to `AppShellNavItem`; update `visibleNavItems` to keep an item only when capability is satisfied AND (no `featureFlag` or the flag is true); render an OWNER upgrade entry in place of a hidden gated surface
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]\* 15.2 Write property test for navigation visibility
    - **Property 13: Navigation visibility mirrors capability and plan feature flags**
    - For any role and set of feature flags, a plan-only item is visible iff the role satisfies its capability and its flag is enabled; an upgrade entry appears iff the role is OWNER and the surface's flag is disabled
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [ ] 16. Author the UAT/demo checklist
  - [ ] 16.1 Write `uat-checklist.md` covering R10.1–R10.7
    - Create `.kiro/specs/plan-limit-enforcement/uat-checklist.md` with steps for: per-resource allow-then-reject at the limit (R10.1); `null` ⇒ unlimited / "Unlimited" display (R10.2); upgrade-then-create-up-to-new-limit (R10.3); TV Display gating on/off (R10.4); Analytics gating on/off (R10.5); downgrade grandfathering + reject + re-permit after deletion (R10.6); direct API over-limit returns `PLAN_LIMIT_EXCEEDED` + HTTP 403 (R10.7)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 17. Final verification - full green build
  - [ ] 17.1 Run frontend and backend test/build suites and fix any failures
    - Run `pnpm --filter @queuenow/web typecheck`, `pnpm --filter @queuenow/web test`, and `pnpm --filter @queuenow/web build`
    - Run the backend api test suite (`pnpm --filter @queuenow/api test`) including the property, unit, and integration tests
    - Resolve any type, lint, test, or build failures until everything is green
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.7_

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP, but property tests
  validate the universal correctness guarantees and are strongly recommended.
- Each property test must be tagged `// Feature: plan-limit-enforcement, Property {n}: {text}` and run
  with `fast-check` at a minimum of 100 runs (`{ numRuns: 100 }` or higher).
- Numeric enforcement is atomic: the count and create run in one `Serializable` Prisma transaction
  with a retry-once wrapper for serialization failures (R1.6).
- The API is the authoritative enforcement boundary; the web app only mirrors it (R9.5).
- Checkpoints ensure incremental validation before moving to the next layer.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "8.1"] },
    { "id": 5, "tasks": ["4.8", "6.1", "6.2", "6.3", "7.1", "8.2", "8.3", "9.1"] },
    { "id": 6, "tasks": ["6.4", "7.2", "8.4", "9.2", "9.3", "9.4", "10.1"] },
    { "id": 7, "tasks": ["9.5", "10.2", "12.1", "12.2", "13.1"] },
    { "id": 8, "tasks": ["13.2", "13.3", "14.1", "14.4", "15.1", "16.1"] },
    { "id": 9, "tasks": ["14.2", "14.3", "14.5", "15.2"] },
    { "id": 10, "tasks": ["17.1"] }
  ]
}
```

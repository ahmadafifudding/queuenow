# Implementation Plan: Queue Turn Notifications Bugfix

## Overview

This plan wires the existing turn-alert delivery primitives into the three
queue-serving actions in `QueueService`
(`apps/api/src/modules/queue/queue.service.ts`) — `callNext`, `recall`, and
`skip` — so the `YOUR_TURN` / `ALMOST_TURN` / `SKIPPED` alert types fire on the
correct ticket transitions. Both primitives already exist and are tested in
isolation but are never called from production code:
`QueueGateway.emitTicketNotification(ticketId, payload)` (socket channel,
reaches any device subscribed to `ticket:<id>`, works for anonymous tickets) and
`NotificationService.sendNotification(ticketId, customerId, type)` (push channel
with graceful degradation). The defect is **missing producer wiring**, not a
logic error in an existing call.

The work follows the exploratory bugfix methodology:

1. **Explore** — write a property-based test that encodes the **Bug Condition**
   (a `callNext`/`recall` → `CALLED` or `skip` → `SKIPPED` transition that
   should produce a turn-alert) and the **Expected Behavior** (the affected
   ticket receives `emitTicketNotification` + `sendNotification`, and the next
   front-of-line `WAITING` ticket receives `ALMOST_TURN`). Run it on the
   **UNFIXED** code where it is **EXPECTED TO FAIL** (the primitives are never
   called), confirming the missing-wiring root cause.
2. **Preserve** — write property-based tests over the **non-bug-condition**
   domain and confirm they **PASS on the UNFIXED code**, capturing the baseline
   emissions (`emitQueueUpdate` → `queue:update` + `ticket:update`;
   `emitTicketCalled` → `queue:ticket-called`), staff authorization/validation,
   return shapes, and the no-turn-alert guarantee for
   `joinQueue`/`complete`/`rejoin`/`cancelTicket`.
3. **Implement** — add the module import, inject `NotificationService`, add the
   `emitTurnAlert` dual-channel helper, and wire `callNext`/`recall`/`skip`
   AFTER their existing emissions.
4. **Validate** — re-run the same Property 1 and Property 2 tests; the
   bug-condition test now passes and the preservation tests still pass.

Implementation language: **TypeScript** (NestJS 11, Prisma 7, strict mode, no
`any`). Property tests use **Jest + fast-check** (`fast-check ^3.23.2`, already a
dev dependency of `@queuenow/api`) and reuse the existing `queue.service`
unit-test harness pattern from `queue-cancel-ticket.test.ts` /
`queue-daily-volume.test.ts`: construct `QueueService` directly with a mocked
`PrismaService`, a mocked `QueueGateway` (extended with
`emitTicketNotification: jest.fn()`), a `PlanLimitsService` stub, and a new
mocked `NotificationService` exposing
`sendNotification: jest.fn().mockResolvedValue(...)`. New specs live in
`apps/api/src/modules/queue/` as `queue-turn-notifications.property.spec.ts`.
Each property test carries the repo header comment
`// Feature: queue-turn-notifications, Property <n>: <text>`, a
`Validates: Requirements ...` line, and runs with `{ numRuns: 100 }` minimum.

## Tasks

- [x] 1. Write the bug-condition exploration property test (BEFORE the fix)
  - **Property 1: Bug Condition** - Serving Actions Produce The Correct Turn-Alert
  - Create `apps/api/src/modules/queue/queue-turn-notifications.property.spec.ts`
    with the header comment
    `// Feature: queue-turn-notifications, Property 1: every callNext/recall/skip transition that should alert invokes emitTicketNotification (and sendNotification when the affected ticket is profiled), and callNext alerts the next WAITING ticket with ALMOST_TURN`
    and a `Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11` line
  - **CRITICAL**: This test MUST FAIL on the unfixed code — the failure confirms
    the bug exists (the producer wiring is absent; `emitTicketNotification` and
    `sendNotification` are never called). **DO NOT fix the test or the code when
    it fails.**
  - **NOTE**: This test encodes the Expected Behavior — it becomes the
    fix-checking test that passes once the fix lands (re-run in task 3.5).
  - **GOAL**: Surface counterexamples that demonstrate the bug and confirm the
    root-cause hypothesis (no call sites + `NotificationService` not injected).
  - Build the harness in the `queue-cancel-ticket.test.ts` style: a mocked
    `PrismaService` (`queueTicket.findFirst`/`update`, `dailyQueueCounter.updateMany`,
    plus a `queueTicket.findFirst` that returns the next `WAITING` ticket for the
    `ALMOST_TURN` lookup), a mocked `QueueGateway` with
    `emitQueueUpdate: jest.fn()`, `emitTicketCalled: jest.fn()`, AND the new
    `emitTicketNotification: jest.fn()`, a `PlanLimitsService` stub, and a mocked
    `NotificationService` with `sendNotification: jest.fn().mockResolvedValue(undefined)`.
    Construct `QueueService(prisma, queueGateway, planLimits, notificationService)`
  - **Scoped PBT approach**: `fast-check` (`{ numRuns: 100 }`) generates inputs
    over the bug-condition domain — action ∈ {`CALL_NEXT`, `RECALL`, `SKIP`},
    affected ticket profiled vs anonymous (`customerProfileId` non-null vs null),
    and (for `CALL_NEXT`) presence/absence of a next `WAITING` ticket
    (profiled/anonymous) — so `isBugCondition(X)` is forced true for every case.
    Import `NotificationType` from `@queuenow/shared-types`
  - Drive each action through a successful transition and assert the Expected
    Behavior from the design Fix-Checking pseudocode:
    - `callNext`/`recall` → `emitTicketNotification(ticket.id, { type: YOUR_TURN, counterName })`; `skip` → `emitTicketNotification(ticket.id, { type: SKIPPED })` (no `counterName`) (R2.1, R2.3, R2.4)
    - `sendNotification(ticket.id, customerProfileId, expectedType)` called iff `customerProfileId` is non-null; NOT called for anonymous tickets (R2.2, R2.9, R2.10, R2.11)
    - `callNext` with a next `WAITING` ticket → `emitTicketNotification(next.id, { type: ALMOST_TURN })` (push iff next is profiled); no `ALMOST_TURN` when no next ticket exists (R2.5, R2.6)
    - at most one alert of a given type per affected ticket per transition (R2.7)
    - the action still resolves with the updated ticket even when a delivery throws/rejects (R2.8)
  - Run on UNFIXED code. **EXPECTED OUTCOME**: test FAILS — record the
    counterexamples (`emitTicketNotification` and `sendNotification` mocks record
    zero calls after a successful serving action; no `ALMOST_TURN` ever emitted)
  - Mark complete when the test is written, run, and the failure is documented
  - _Bug_Condition: isBugCondition(X) — (CALL_NEXT∨RECALL → CALLED) ∨ (SKIP → SKIPPED)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

- [x] 2. Write the preservation property tests (BEFORE the fix)
  - **Property 2: Preservation** - Existing Behavior Is Unchanged
  - Add to `apps/api/src/modules/queue/queue-turn-notifications.property.spec.ts`
    the header/`Validates` line for
    `// Feature: queue-turn-notifications, Property 2: pre-existing emissions, staff auth/validation, and return shapes are unchanged, and joinQueue/complete/rejoin/cancelTicket emit no turn-alerts`
    and `Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7`
  - **IMPORTANT**: Follow the observation-first methodology — run the UNFIXED
    code, observe the actual outputs, then encode them as properties so the
    tests PASS on the unfixed code and continue to pass after the fix
  - `fast-check` generates inputs (`{ numRuns: 100 }`) across the action domain;
    assert the observed baseline contract per the design Preservation test cases:
    - Existing emissions preserved: for each of `callNext`/`recall`/`skip`, `emitQueueUpdate` (→ `queue:update` + `ticket:update`) and (for `callNext`/`recall`) `emitTicketCalled` (→ `queue:ticket-called`, including `isRecall`/`recallCount` on recall) are still called once with the same payload (R3.1, R3.2)
    - Non-triggering actions untouched: `joinQueue`, `complete`, `rejoin`, `cancelTicket` never call `emitTicketNotification` or `sendNotification` (R3.3)
    - Authorization/validation preserved: forbidden-org (`validateStaffOrgAccess`), not-found, invalid-status, and max-recall all still throw before any transition, and produce no `emitTicketNotification`/`sendNotification` calls (R3.4)
    - Return shape preserved: each serving action returns the updated ticket with its existing `include` relations, unchanged (R3.5)
    - `NotificationService.sendNotification` is not modified by this bugfix; existing queue + notification suites stay green (R3.6, R3.7)
  - Run on UNFIXED code. **EXPECTED OUTCOME**: tests PASS — this is the baseline
    behavior the fix must preserve
  - Mark complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Wire the turn-alert primitives into the queue-serving actions
  - [x] 3.1 Import `NotificationModule` into `QueueModule`
    - In `apps/api/src/modules/queue/queue.module.ts` add
      `import { NotificationModule } from '../notification/notification.module';`
      and add `imports: [NotificationModule]` to the `@Module` decorator
    - This is a one-way dependency (`QueueModule` → `NotificationModule`); confirm
      `NotificationModule` exports `NotificationService` and MUST NOT import
      `QueueModule` (no circular dependency, no `forwardRef`)
    - _Preservation: module wiring is additive; existing providers/exports unchanged_
    - _Requirements: 3.6, 3.7_

  - [x] 3.2 Inject `NotificationService` and add `Logger` + `NotificationType`
    - In `apps/api/src/modules/queue/queue.service.ts` add
      `private readonly notificationService: NotificationService` as the 4th
      constructor parameter (after `prisma`, `queueGateway`, `planLimits`)
    - Add a `private readonly logger = new Logger(QueueService.name)` (import
      `Logger` from `@nestjs/common`) and import `NotificationType` from
      `@queuenow/shared-types` and `NotificationService` from
      `../notification/notification.service`
    - Strict / no-`any`: type the helper inputs explicitly
    - _Preservation: existing constructor dependencies and their usage unchanged_
    - _Requirements: 3.4, 3.5_

  - [x] 3.3 Add the private `emitTurnAlert` dual-channel helper
    - Add `private async emitTurnAlert(ticket: { id: string; customerProfileId: string | null }, type: NotificationType, counterName?: string): Promise<void>`
    - Build payload `counterName !== undefined ? { type, counterName } : { type }`;
      call `this.queueGateway.emitTicketNotification(ticket.id, payload)` inside a
      try/catch that logs and swallows (socket channel always fires) (R2.1, R2.4, R2.9)
    - When `ticket.customerProfileId` is non-null, call
      `await this.notificationService.sendNotification(ticket.id, ticket.customerProfileId, type)`
      inside its own try/catch that logs and swallows (push channel) (R2.2, R2.10, R2.11)
    - All failures are guarded so a delivery error can never fail or roll back the
      queue action; the helper is called exactly once per affected ticket per type
      per transition (structural idempotency) (R2.7, R2.8)
    - _Bug_Condition: isBugCondition(X) — (CALL_NEXT∨RECALL → CALLED) ∨ (SKIP → SKIPPED)_
    - _Expected_Behavior: socket always; push iff customerProfileId; never throws; one alert per type per ticket_
    - _Preservation: helper is new; adds no behavior to existing emit paths_
    - _Requirements: 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x] 3.4 Wire `callNext`, `recall`, and `skip` AFTER their existing emissions
    - `callNext`: AFTER the existing transition `update` and the existing
      `emitQueueUpdate` / `emitTicketCalled` emissions, call
      `await this.emitTurnAlert(updatedTicket, NotificationType.YOUR_TURN, counter.name)`;
      then perform the guarded next-`WAITING` lookup
      (`prisma.queueTicket.findFirst({ where: { orgId, serviceId: counter.serviceId, status: 'WAITING' }, orderBy: { createdAt: 'asc' }, select: { id: true, customerProfileId: true } })`)
      and, if present, `await this.emitTurnAlert(nextWaiting, NotificationType.ALMOST_TURN)`;
      wrap the lookup-and-alert block in try/catch that logs and swallows; return
      `updatedTicket` unchanged (R2.1, R2.2, R2.5, R2.6, R2.8)
    - `recall`: AFTER the existing `update` and `emitQueueUpdate` /
      `emitTicketCalled` emissions, call
      `await this.emitTurnAlert(updatedTicket, NotificationType.YOUR_TURN, ticket.counter?.name)`
      (the ticket's existing counter); return `updatedTicket` unchanged (R2.3)
    - `skip`: AFTER the existing `update` (→ `SKIPPED`), the daily-counter
      `updateMany`, and the existing `emitQueueUpdate`, call
      `await this.emitTurnAlert(updatedTicket, NotificationType.SKIPPED)` (no
      `counterName`); return `updatedTicket` unchanged (R2.4)
    - Ordering invariant: turn-alert wiring is placed AFTER the DB `update` and
      AFTER all pre-existing emissions; the return statement stays last and
      unchanged (preservation is obviously intact)
    - _Bug_Condition: isBugCondition(X) — (CALL_NEXT∨RECALL → CALLED) ∨ (SKIP → SKIPPED)_
    - _Expected_Behavior: affected ticket gets YOUR_TURN/SKIPPED on socket (+push if profiled); callNext alerts next WAITING with ALMOST_TURN_
    - _Preservation: emitQueueUpdate, emitTicketCalled, auth/validation, and return values unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.5 Verify the bug-condition exploration test now passes
    - **Property 1: Expected Behavior** - Serving Actions Produce The Correct Turn-Alert
    - **IMPORTANT**: Re-run the SAME Property 1 test from task 1 — do NOT write a
      new test. The task-1 test encodes the Expected Behavior; its passing
      confirms the fix
    - **EXPECTED OUTCOME**: test PASSES — every `callNext`/`recall`/`skip`
      transition now invokes `emitTicketNotification` (and `sendNotification` for
      profiled tickets), `callNext` alerts the next `WAITING` ticket with
      `ALMOST_TURN`, no duplicate alerts fire, and the action succeeds even when a
      delivery throws
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x] 3.6 Verify the preservation tests still pass
    - **Property 2: Preservation** - Existing Behavior Is Unchanged
    - **IMPORTANT**: Re-run the SAME Property 2 tests from task 2 — do NOT write
      new tests
    - **EXPECTED OUTCOME**: tests PASS — the pre-existing `emitQueueUpdate` /
      `emitTicketCalled` emissions, staff authorization/validation, and return
      shapes are unchanged; `joinQueue`/`complete`/`rejoin`/`cancelTicket` still
      emit no turn-alerts (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Checkpoint - full verification
  - Run `pnpm --filter @queuenow/api test` (unit + property suites, including the
    new Property 1 and Property 2 tests, plus the existing
    `queue-cancel-ticket.test.ts`, `queue-daily-volume.test.ts`, and
    `notification.service.spec.ts`)
  - Run `pnpm --filter @queuenow/api build` to confirm the strict TypeScript build
    is green (no `any`, all return types defined)
  - Ensure everything is green; ask the user if questions arise

## Notes

- Property 1 (Bug Condition / Fix Checking) and Property 2 (Preservation) live
  together in
  `apps/api/src/modules/queue/queue-turn-notifications.property.spec.ts`, reusing
  the mocked-`PrismaService` + mocked-`QueueGateway` (with
  `emitTicketNotification`) + mocked-`NotificationService` harness in the
  `queue-cancel-ticket.test.ts` style. Both run with `{ numRuns: 100 }` minimum
  and carry the repo header comment
  `// Feature: queue-turn-notifications, Property <n>: <text>`.
- The fix is additive: one module import, one injected dependency, one private
  helper (`emitTurnAlert`), and turn-alert calls appended AFTER the existing
  emissions in `callNext`/`recall`/`skip`. No existing emission, authorization,
  validation, or return value changes.
- `NotificationService` depends only on `PrismaService` and `ConfigService`, so
  `QueueModule` → `NotificationModule` is a clean one-way import — no circular
  dependency and no `forwardRef`. `NotificationModule` MUST NOT import
  `QueueModule`.
- No Prisma migration is required — the fix only wires existing primitives and
  reads the existing `customerProfileId` column.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1", "3.2"] },
    { "id": 2, "tasks": ["3.3"] },
    { "id": 3, "tasks": ["3.4"] },
    { "id": 4, "tasks": ["3.5", "3.6"] },
    { "id": 5, "tasks": ["4"] }
  ]
}
```

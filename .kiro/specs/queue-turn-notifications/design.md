# Queue Turn Notifications Bugfix Design

## Overview

The customer turn-alert feature is broken on the backend: the producer wiring is missing. Both delivery primitives exist and work in isolation — `QueueGateway.emitTicketNotification(ticketId, payload)` (socket, reaches any device subscribed to `ticket:<id>`, works for anonymous tickets) and `NotificationService.sendNotification(ticketId, customerId, type)` (records a `Notification` and attempts Expo push with graceful degradation) — but neither is ever called from production code. As a result none of the `YOUR_TURN` / `ALMOST_TURN` / `SKIPPED` alert types defined in `@queuenow/shared-types` fire when staff call, recall, or skip tickets (bugfix.md 1.1–1.6).

The fix wires those existing primitives into the three queue-serving actions in `QueueService` — `callNext`, `recall`, and `skip` — so each transition produces the correct turn-alert through a dual-channel delivery (socket always; push when the affected ticket has a `customerProfileId`). A small private helper, `emitTurnAlert`, centralizes the dual-channel logic and the graceful-degradation guard so a delivery failure can never fail or roll back the queue action (bugfix.md 2.8). The wiring is additive: every existing emission (`queue:update`, `ticket:update`, `queue:ticket-called`), staff authorization, validation, and response shape is preserved unchanged (bugfix.md 3.1–3.7).

Both open questions from the requirements are now resolved and the design is written against the resolved decisions:

- **OQ-1 (ALMOST_TURN timing) — RESOLVED:** when `callNext` consumes the front-of-line `WAITING` ticket for a service, the new front-of-line `WAITING` ticket (the next ticket by FIFO `createdAt` for that service — the one the next `callNext` would return) receives a single `ALMOST_TURN` turn-alert (socket always; push when it has a `customerProfileId`). When no next `WAITING` ticket exists, no `ALMOST_TURN` is produced (bugfix.md 2.5, 2.6).
- **OQ-2 (recall push) — RESOLVED:** on `recall`, BOTH the socket emit and the push fire again, because recall is an explicit staff re-summon (bugfix.md 2.3).

## Glossary

- **Bug_Condition (C)**: A queue-serving action that should produce a turn-alert but currently produces none — a `callNext`/`recall` resulting in `CALLED`, or a `skip` resulting in `SKIPPED` (bugfix.md "Bug Condition").
- **Property (P)**: The desired behavior for `C` — the directly affected ticket receives its turn-alert on the socket channel always, and on the push channel iff it has a `customerProfileId`; `callNext` additionally alerts the new front-of-line `WAITING` ticket with `ALMOST_TURN`.
- **Preservation**: All pre-existing behavior that must remain byte-for-byte identical between `F` and `F'` — the existing emissions, staff authorization, validation, and return shapes (bugfix.md 3.1–3.7).
- **F**: The queue-serving code before the fix (no turn-alert wiring).
- **F'**: The queue-serving code after the fix (turn-alert wiring added to `callNext`, `recall`, `skip`).
- **emitTurnAlert**: New private helper in `QueueService` that performs dual-channel delivery for one ticket and guards all failures so the queue action always completes.
- **`callNext` / `recall` / `skip`**: The staff serving actions in `apps/api/src/modules/queue/queue.service.ts` that transition a ticket and emit real-time events.
- **`emitTicketNotification`**: `QueueGateway` method emitting `ticket:notification` to the `ticket:<ticketId>` room (socket channel).
- **`sendNotification`**: `NotificationService` method that records a `Notification` and attempts push delivery (push channel); never throws.
- **NotificationType**: Enum from `@queuenow/shared-types` with values `YOUR_TURN`, `ALMOST_TURN`, `SKIPPED`.
- **customerProfileId**: Nullable column on `QueueTicket`; non-null means the ticket is owned by a registered customer profile (the push channel gate).
- **front-of-line WAITING ticket**: The oldest `WAITING` ticket for a service by `createdAt asc` — the one `callNext` returns.

## Bug Details

### Bug Condition

The bug manifests when staff perform a queue-serving action that should produce a turn-alert but the action never invokes `emitTicketNotification` or `sendNotification` (they are referenced only by tests). This applies to `callNext` (resulting in `CALLED`), `recall` (resulting in `CALLED`), and `skip` (resulting in `SKIPPED`). It also covers the second-order alert: when `callNext` consumes the front-of-line ticket, the new front-of-line `WAITING` ticket is never sent `ALMOST_TURN` (bugfix.md 1.1–1.6).

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type ServingAction   // a callNext / recall / skip invocation with its resulting ticket transition
  OUTPUT: boolean

  RETURN (input.action = CALL_NEXT AND input.resultStatus = CALLED)   // expects YOUR_TURN (called ticket) + maybe ALMOST_TURN (next)
      OR (input.action = RECALL    AND input.resultStatus = CALLED)   // expects YOUR_TURN
      OR (input.action = SKIP      AND input.resultStatus = SKIPPED)  // expects SKIPPED
END FUNCTION
```

### Examples

- **`callNext` → CALLED (registered customer):** staff call ticket `A001` (has `customerProfileId`) to "Counter 1". Expected: socket `ticket:notification` `{ type: YOUR_TURN, counterName: "Counter 1" }` to `ticket:A001` AND `sendNotification(A001, profileId, YOUR_TURN)`. Actual (F): neither fires — no banner, no push, no `Notification` record (bugfix.md 1.1, 1.2).
- **`callNext` → CALLED with a next waiting ticket:** after `A001` is called, `A002` (next by FIFO) is now front-of-line. Expected: `A002` receives a single `ALMOST_TURN` (socket always; push if it has a `customerProfileId`). Actual (F): no `ALMOST_TURN` ever produced (bugfix.md 1.5).
- **`recall` → CALLED:** staff re-summon `CALLED` ticket `A001`. Expected: `YOUR_TURN` on both channels again (recall is an explicit re-summon). Actual (F): nothing fires (bugfix.md 1.3).
- **`skip` → SKIPPED:** staff skip `CALLED` ticket `A001`. Expected: `SKIPPED` on both channels (push iff `customerProfileId`). Actual (F): nothing fires (bugfix.md 1.4).
- **Edge case — `callNext` with no next waiting ticket:** `A001` is the only `WAITING` ticket. Expected: `YOUR_TURN` to `A001`, and NO `ALMOST_TURN` (no next ticket exists) (bugfix.md 2.6).
- **Edge case — anonymous ticket (null `customerProfileId`):** socket `ticket:notification` fires; `sendNotification` is NOT called (no push, no `Notification` record) (bugfix.md 2.9).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `emitQueueUpdate` continues to emit `queue:update` to `org:<orgId>` and `org:<orgId>:service:<serviceId>` rooms, and `ticket:update` to `ticket:<id>`, with unchanged payloads — mobile live position tracking keeps working (bugfix.md 3.1).
- `callNext` and `recall` continue to emit `queue:ticket-called` to `org:<orgId>` with the existing payload, including `isRecall`/`recallCount` for recall — Display screens keep working (bugfix.md 3.2).
- `joinQueue`, `complete`, `rejoin`, and `cancelTicket` continue to emit exactly what they emit today, with NO new turn-alert side effects added (bugfix.md 3.3).
- `validateStaffOrgAccess` plus existing not-found / invalid-status / max-recall validation on `callNext`, `recall`, `skip` are unchanged (bugfix.md 3.4).
- Each serving action returns the same response shape (the updated ticket with its existing `include` relations); turn-alert side effects do not change return values (bugfix.md 3.5).
- `NotificationService.sendNotification` internal logic is unchanged — this bugfix wires callers to it but does not modify it (bugfix.md 3.6, 3.7).

**Scope:**

All inputs that do NOT satisfy `isBugCondition` are completely unaffected by this fix. This includes:

- `joinQueue`, `complete`, `rejoin`, `cancelTicket`, `getCurrentStatus`, `getTicketStatus`.
- Actions that throw before transition (not-found, invalid-status, max-recall, forbidden-org) — they produce no turn-alert because no transition occurs.
- The pre-existing emissions and return values of `callNext`/`recall`/`skip` themselves (only NEW turn-alert side effects are added).

The actual expected correct behavior for buggy-condition inputs is defined in the Correctness Properties section (Property 1).

## Hypothesized Root Cause

This is not a logic defect in an existing call — it is **missing producer wiring**. The root cause is structural, not behavioral:

1. **No call sites for the primitives.** `QueueGateway.emitTicketNotification` and `NotificationService.sendNotification` are fully implemented and tested but are never invoked from `QueueService`. The serving actions emit `queue:update` / `queue:ticket-called` only (bugfix.md 1.6).

2. **`NotificationService` is not injectable into `QueueService`.** `QueueModule` declares only `QueueService` and `QueueGateway` and does not import `NotificationModule`, so `QueueService` has no reference to `NotificationService` to call. The fix must add module wiring.

3. **No second-order (`ALMOST_TURN`) lookup.** `callNext` returns the called ticket but never looks up the new front-of-line `WAITING` ticket, so there is no opportunity to alert it (bugfix.md 1.5).

4. **No dual-channel/idempotency/guard abstraction.** There is no single place that performs "socket always + push when profiled, exactly once, never throwing", so each call site would otherwise duplicate that logic. The fix introduces `emitTurnAlert` to centralize it (bugfix.md 2.7, 2.8).

### Module wiring decision (no circular dependency)

`NotificationService` depends only on `PrismaService` and `ConfigService` — it does NOT depend on `QueueModule` or `QueueGateway`. Therefore the dependency direction is one-way: `QueueModule` → `NotificationModule`. This is a clean import with **no circular dependency** and **no `forwardRef` required**.

```
QueueModule (imports NotificationModule)  ──uses──►  NotificationService
NotificationModule                         ──NOT──►  QueueModule   // must never import QueueModule
```

The chosen approach: `QueueModule` adds `imports: [NotificationModule]`; `NotificationModule` already exports `NotificationService`. `NotificationModule` MUST NOT import `QueueModule`. If a future change makes `NotificationService` depend on `QueueService`/`QueueGateway`, that would introduce a cycle and require `forwardRef` on both sides — out of scope here and explicitly avoided.

## Correctness Properties

Property 1: Bug Condition — Serving actions produce the correct turn-alert

_For any_ serving action where the bug condition holds (`isBugCondition` returns true), the fixed code SHALL, for the directly affected ticket, call `emitTicketNotification(ticket.id, payload)` with `payload.type = expectedType` (`YOUR_TURN` for `CALL_NEXT`/`RECALL`, `SKIPPED` for `SKIP`) and, for `YOUR_TURN`, `payload.counterName` set to the counter the ticket was called to (for `recall`, the ticket's existing counter); AND SHALL call `sendNotification(ticket.id, ticket.customerProfileId, expectedType)` if and only if `ticket.customerProfileId` is non-null. Additionally, for `CALL_NEXT`, if a next `WAITING` ticket exists for the same service (next by FIFO `createdAt`), the fixed code SHALL send that ticket a single `ALMOST_TURN` (socket always; push iff it has a non-null `customerProfileId`), and SHALL produce no `ALMOST_TURN` when no next `WAITING` ticket exists. At most one alert of a given type SHALL be sent per affected ticket per transition, and the queue action SHALL complete successfully even if a delivery throws.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11**

Property 2: Preservation — Existing behavior is unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed code SHALL produce exactly the same result as the original code, preserving all existing emissions, authorization, validation, and return values. Furthermore, even for inputs where the bug condition DOES hold, the pre-existing emissions (`emitQueueUpdate` → `queue:update` + `ticket:update`; `emitTicketCalled` → `queue:ticket-called`), the staff authorization and validation, and the returned response shape SHALL be identical to the original — only the new turn-alert side effects are added.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming the root-cause analysis is correct, the fix is additive wiring plus one private helper and one module import.

**File**: `apps/api/src/modules/queue/queue.module.ts`

1. **Import `NotificationModule`** so `NotificationService` is available for injection.

```typescript
import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { QueueGateway } from './queue.gateway';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule], // one-way dependency; NotificationModule must NOT import QueueModule
  controllers: [QueueController],
  providers: [QueueService, QueueGateway],
  exports: [QueueService, QueueGateway],
})
export class QueueModule {}
```

**File**: `apps/api/src/modules/queue/queue.service.ts`

2. **Inject `NotificationService`** into the constructor (in addition to the existing `PrismaService`, `QueueGateway`, `PlanLimitsService`) and import `NotificationType` from `@queuenow/shared-types`.

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly queueGateway: QueueGateway,
  private readonly planLimits: PlanLimitsService,
  private readonly notificationService: NotificationService,
) {}
```

3. **Add the private `emitTurnAlert` helper** that performs dual-channel delivery and guards every failure so the queue action never fails (bugfix.md 2.7, 2.8, 2.9, 2.10, 2.11). It accepts the minimal fields needed and is `async` but is intentionally not awaited in a way that can reject the caller (it self-contains its try/catch).

```typescript
/**
 * Dual-channel turn-alert delivery for a single ticket.
 * - Socket channel ALWAYS fires (works for anonymous tickets).
 * - Push channel fires iff the ticket has a non-null customerProfileId.
 * All failures are swallowed/logged so a delivery error can never fail or roll
 * back the queue action (R2.8). sendNotification never throws, but the socket
 * emit is still guarded defensively.
 */
private async emitTurnAlert(
  ticket: { id: string; customerProfileId: string | null },
  type: NotificationType,
  counterName?: string,
): Promise<void> {
  // Build payload: counterName included only for YOUR_TURN (R2.1/R2.3).
  const payload = counterName !== undefined ? { type, counterName } : { type };
  try {
    this.queueGateway.emitTicketNotification(ticket.id, payload);
  } catch (error) {
    this.logger.error(`emitTicketNotification failed for ticket ${ticket.id}: ${reason(error)}`);
  }
  if (ticket.customerProfileId) {
    // sendNotification already never throws; guarded anyway for defense in depth.
    try {
      await this.notificationService.sendNotification(ticket.id, ticket.customerProfileId, type);
    } catch (error) {
      this.logger.error(`sendNotification failed for ticket ${ticket.id}: ${reason(error)}`);
    }
  }
}
```

- A `Logger` instance is added to `QueueService` (consistent with `NotificationService`/`QueueGateway`).
- `counterName` is passed only for `YOUR_TURN`; omitted for `SKIPPED`/`ALMOST_TURN` so the socket payload is `{ type }` (bugfix.md 2.4, 2.5, payload-contract scope note).
- Idempotency (bugfix.md 2.7) is structural: `emitTurnAlert` is called exactly once per affected ticket per type per transition.

4. **Wire `callNext`** — AFTER the existing transition update AND AFTER the existing `emitQueueUpdate` / `emitTicketCalled` emissions, so `updatedTicket` and `counter.name` are available:
   - Call `emitTurnAlert(updatedTicket, NotificationType.YOUR_TURN, counter.name)` for the called ticket (bugfix.md 2.1, 2.2). `counter.name` is the counter the ticket was called to.
   - Then look up the next `WAITING` ticket for `counter.serviceId` (see step 6) and, if present, call `emitTurnAlert(nextWaiting, NotificationType.ALMOST_TURN)` (bugfix.md 2.5); if absent, do nothing (bugfix.md 2.6).
   - Return `updatedTicket` unchanged (bugfix.md 3.5).

5. **Wire `recall`** — AFTER the existing `update` AND AFTER the existing `emitQueueUpdate` / `emitTicketCalled` emissions:
   - Call `emitTurnAlert(updatedTicket, NotificationType.YOUR_TURN, ticket.counter?.name)` (bugfix.md 2.3). For recall the counter is the ticket's existing counter (`ticket.counter` from the `findFirst` include, mirroring the existing `queue:ticket-called` payload which uses `ticket.counter?.name`).
   - Return `updatedTicket` unchanged.

6. **Wire `skip`** — AFTER the existing `update` (status → `SKIPPED`), the daily-counter `updateMany`, AND the existing `emitQueueUpdate`:
   - Call `emitTurnAlert(updatedTicket, NotificationType.SKIPPED)` (no `counterName`) (bugfix.md 2.4).
   - Return `updatedTicket` unchanged.

7. **Next-WAITING lookup for `ALMOST_TURN`** — reuse the existing FIFO query pattern from `callNext`. After the called ticket has been updated to `CALLED`, the previous front-of-line ticket is no longer `WAITING`, so the same query returns the new front-of-line ticket:

```typescript
// Same pattern as the callNext "find next waiting" query; the just-called
// ticket is now CALLED so it is excluded, yielding the new front-of-line.
const nextWaiting = await this.prisma.queueTicket.findFirst({
  where: { orgId, serviceId: counter.serviceId, status: 'WAITING' },
  orderBy: { createdAt: 'asc' },
  select: { id: true, customerProfileId: true },
});
if (nextWaiting) {
  await this.emitTurnAlert(nextWaiting, NotificationType.ALMOST_TURN);
}
```

- This lookup must itself be guarded so a query failure cannot fail the `callNext` action (bugfix.md 2.8) — wrap the lookup-and-alert block in try/catch that logs and swallows.

### Ordering invariant (critical)

In all three actions the turn-alert wiring is placed **after** the DB `update` (so the payload can read `counterName` and the ticket id/`customerProfileId`) and **after** all pre-existing emissions (so preservation is obviously intact and the new code is purely appended). The return statement remains last and unchanged.

## Testing Strategy

### Validation Approach

Two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed code (the producer wiring is absent — `emitTicketNotification` / `sendNotification` are never called); then verify the fix produces the correct alerts and preserves all existing behavior. Tests follow the existing `queue.service` unit-test style (`queue-cancel-ticket.test.ts`, `queue-daily-volume.test.ts`): construct `QueueService` directly with mocked `PrismaService`, `QueueGateway`, `PlanLimitsService`, and now a mocked `NotificationService`, then assert call patterns on the mocks. The harness stub for `QueueGateway` adds an `emitTicketNotification: jest.fn()`, and a `NotificationService` stub exposes `sendNotification: jest.fn().mockResolvedValue(...)`.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix, confirming the root cause (missing call sites). If these unexpectedly pass on unfixed code, the root-cause hypothesis is wrong and must be re-examined.

**Test Plan**: Build a `QueueService` with mocked dependencies, drive `callNext`/`recall`/`skip` through a successful transition, and assert that `emitTicketNotification` and `sendNotification` are invoked. Run on the UNFIXED code to observe failures.

**Test Cases**:

1. **callNext YOUR_TURN socket**: call a ticket; assert `emitTicketNotification(ticketId, { type: YOUR_TURN, counterName })` (will fail on unfixed code — never called).
2. **callNext YOUR_TURN push (profiled)**: called ticket has `customerProfileId`; assert `sendNotification(ticketId, profileId, YOUR_TURN)` (will fail on unfixed code).
3. **recall YOUR_TURN both channels**: recall a `CALLED` ticket; assert both socket emit and `sendNotification` (will fail on unfixed code).
4. **skip SKIPPED both channels**: skip a `CALLED` ticket; assert socket emit `{ type: SKIPPED }` and `sendNotification(..., SKIPPED)` (will fail on unfixed code).
5. **Edge — ALMOST_TURN for next**: call front-of-line when a second `WAITING` exists; assert `emitTicketNotification(nextId, { type: ALMOST_TURN })` (will fail on unfixed code).

**Expected Counterexamples**:

- `emitTicketNotification` and `sendNotification` mocks recording zero calls after a successful serving action.
- Root cause confirmed: production code contains no call sites and `NotificationService` is not injected.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected turn-alerts (Property 1).

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  effects := F'(X)
  ASSERT effects.emitTicketNotification CALLED WITH (X.ticket.id, { type: expectedType(X), counterName? })
  IF X.ticket.customerProfileId != null THEN
    ASSERT effects.sendNotification CALLED WITH (X.ticket.id, X.ticket.customerProfileId, expectedType(X))
  ELSE
    ASSERT effects.sendNotification NOT CALLED FOR X.ticket.id
  END IF
  IF X.action = CALL_NEXT AND existsNextWaiting(X.service) THEN
    next := frontOfLineWaitingAfter(X.ticket, X.service)
    ASSERT effects.emitTicketNotification CALLED WITH (next.id, { type: ALMOST_TURN })
    IF next.customerProfileId != null THEN
      ASSERT effects.sendNotification CALLED WITH (next.id, next.customerProfileId, ALMOST_TURN)
    END IF
  END IF
  ASSERT noDuplicateAlerts(effects)          // at most one alert per type per ticket per transition (R2.7)
  ASSERT effects.queueActionSucceeded = true // delivery failure never fails the action (R2.8)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original; and that even for buggy-condition inputs the pre-existing emissions and return value are unchanged (Property 2).

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR

FOR ALL X WHERE isBugCondition(X) DO
  ASSERT F'(X).emitQueueUpdate  = F(X).emitQueueUpdate    // queue:update + ticket:update unchanged (R3.1)
  ASSERT F'(X).emitTicketCalled = F(X).emitTicketCalled   // queue:ticket-called unchanged (R3.2)
  ASSERT F'(X).authorization    = F(X).authorization      // staff-auth + validation unchanged (R3.4)
  ASSERT F'(X).returnValue      = F(X).returnValue        // response shape unchanged (R3.5)
END FOR
```

**Testing Approach**: Property-based testing (Jest + fast-check, the repo's style) is recommended for preservation because it generates many inputs across the domain and catches edge cases manual tests miss. Mock `PrismaService` + `QueueGateway` + `NotificationService`; generate ticket/counter/profile permutations (profiled vs anonymous, with/without a next waiting ticket, each action type) and assert the new-alert call patterns while asserting the pre-existing emit call args and return value are identical to a captured baseline.

**Test Plan**: Observe `F` behavior first (existing green suite), then add tests that (a) assert new alerts for buggy-condition inputs and (b) assert the pre-existing `emitQueueUpdate`/`emitTicketCalled` calls and return values are unchanged. Confirm `joinQueue`/`complete`/`rejoin`/`cancelTicket` emit no `emitTicketNotification`/`sendNotification` (R3.3).

**Test Cases**:

1. **Existing emissions preserved**: for each of `callNext`/`recall`/`skip`, assert `emitQueueUpdate` and (where applicable) `emitTicketCalled` are still called once with the same payload after the fix.
2. **Non-triggering actions untouched**: `joinQueue`, `complete`, `rejoin`, `cancelTicket` never call `emitTicketNotification` or `sendNotification`.
3. **Authorization/validation preserved**: forbidden-org, not-found, invalid-status, max-recall all still throw before any alert (no `emitTicketNotification`/`sendNotification` calls).
4. **Return shape preserved**: each action returns the updated ticket with its existing `include` relations, unchanged.
5. **Existing suites green**: `queue-cancel-ticket.test.ts`, `queue-daily-volume.test.ts`, `notification.service.spec.ts` all continue to pass unchanged (R3.6, R3.7).

### Unit Tests

- `callNext`: YOUR_TURN socket payload includes `counterName`; push fired iff `customerProfileId`; ALMOST_TURN sent to next waiting ticket when present, none when absent (R2.1, 2.2, 2.5, 2.6).
- `recall`: YOUR_TURN on both channels using the ticket's existing counter name (R2.3).
- `skip`: SKIPPED on both channels, no `counterName` in payload (R2.4).
- Anonymous ticket (null `customerProfileId`): socket only, `sendNotification` not called (R2.9).
- Profiled ticket without push token: `sendNotification` still called (record-only handled inside the service) (R2.10, R2.11).
- Graceful degradation: when `emitTicketNotification` throws or `sendNotification` rejects, the action still returns the updated ticket (R2.8).
- Idempotency: exactly one `emitTicketNotification` and at most one `sendNotification` per affected ticket per transition (R2.7).

### Property-Based Tests

- Generate random combinations of action type, profiled/anonymous affected ticket, and presence/absence of a next waiting ticket; assert the dual-channel and ALMOST_TURN rules hold and that pre-existing emissions/return values are unchanged.
- Generate injected delivery failures (socket throw, push reject, next-waiting lookup throw) and assert the queue action always completes successfully (R2.8).

### Integration Tests

- Full flow: a customer subscribed to `ticket:<id>` receives `ticket:notification` on `callNext`, and a registered profile gets a `Notification` record; Display screens still receive `queue:ticket-called`.
- Context flow: call front-of-line, assert the next waiting ticket receives `ALMOST_TURN`; call again and assert the new next ticket is alerted (one alert per transition).
- Skip flow: skip a called ticket and assert the `SKIPPED` alert reaches the ticket room while `queue:update` still fires.

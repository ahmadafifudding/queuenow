# Bugfix Requirements Document

## Introduction

The customer turn-alert feature is not wired end-to-end on the backend. The mobile app (`apps/mobile`) correctly consumes turn alerts — its `Notification_Manager` listens for `ticket:notification`, surfaces in-app banners and local notifications, and registers Expo push tokens — but the backend queue-serving actions never produce those alerts.

Two delivery mechanisms exist but are never invoked by production code:

- `QueueGateway.emitTicketNotification(ticketId, payload)` emits `ticket:notification` to the `ticket:<ticketId>` room, but is never called anywhere.
- `NotificationService.sendNotification(ticketId, customerId, type)` records and delivers an Expo push (with graceful degradation), but is only ever called from tests.

As a result, none of the turn-alert types defined in `@queuenow/shared-types` (`YOUR_TURN`, `ALMOST_TURN`, `SKIPPED`) fire when staff call, recall, or skip tickets. Every consumer that depends on them — the mobile `ticket:notification` listener, the in-app banner, local notifications, and Expo push — never activates.

This bugfix wires the existing emit/push primitives into the queue-serving actions (`QueueService.callNext`, `recall`, `skip`) so turn alerts fire for the correct ticket transitions, while preserving all currently working real-time behavior (`queue:update`, `ticket:update`, `queue:ticket-called`), staff authorization on serving endpoints, and the existing queue test suite.

### Scope notes

- **Producer-side only.** The defect is the missing producer wiring in `apps/api`. The mobile consumer contract (described in the `customer-mobile-app` design "Notifications" section and R5/R13) is already correct and is treated as the fixed contract the backend must satisfy.
- **Payload contract.** The mobile `Notification_Manager` reads `type` from the `ticket:notification` payload, and for `YOUR_TURN` it reads/normalizes a `counterName`. The emitted socket payload must carry at least `{ type, counterName }` for `YOUR_TURN` and `{ type }` for `SKIPPED`/`ALMOST_TURN` (with any additional fields the manager normalizes).
- **Two independent channels per transition.** The socket emit (`emitTicketNotification`) reaches any device subscribed to `ticket:<id>` and works for anonymous tickets. Push (`sendNotification`) requires a `customerProfileId`. The two channels are governed separately (see clauses below).

## Open Questions

- **OQ-1 (ALMOST_TURN timing):** The exact moment `ALMOST_TURN` should fire is not yet fully pinned. The working assumption captured below (clause 2.5) is: when `callNext` consumes the current front-of-line `WAITING` ticket, the _new_ front-of-line `WAITING` ticket for that same service (the next ticket by FIFO `createdAt` ordering, i.e. the one that would be returned by the next `callNext`) receives a single `ALMOST_TURN` notification. Alternatives to confirm during design: (a) fire on join when a ticket lands within N positions of the front; (b) fire only when a counter is free; (c) suppress if the next ticket was _just_ notified. The bug condition and properties for `ALMOST_TURN` are written against the working assumption and may be refined.
- **OQ-2 (recall vs first call for push):** On `recall`, should push (`sendNotification`) fire again, or only the socket emit? Working assumption (clause 2.3): both socket and push fire on recall, because recall is an explicit staff re-summon and the idempotency rule (clause 2.7) only suppresses duplicates for the _same_ transition occurrence, not across distinct recall actions.

## Bug Analysis

### Current Behavior (Defect)

The following describe what currently happens (function `F`, the unfixed code) when staff perform serving actions.

1.1 WHEN `QueueService.callNext` transitions a ticket to `CALLED` THEN the system emits `queue:update`, `ticket:update`, and `queue:ticket-called`, but does NOT call `emitTicketNotification`, so no `ticket:notification` (`YOUR_TURN`) reaches the called ticket's subscribers.

1.2 WHEN `QueueService.callNext` transitions a ticket to `CALLED` AND that ticket has a `customerProfileId` with a registered `pushToken` THEN the system does NOT call `sendNotification`, so no `YOUR_TURN` push is delivered and no `Notification` record is created.

1.3 WHEN `QueueService.recall` re-summons a `CALLED` ticket THEN the system emits `queue:update` and `queue:ticket-called` (with `isRecall`), but does NOT call `emitTicketNotification` or `sendNotification`, so no `YOUR_TURN` turn-alert (socket or push) reaches the customer.

1.4 WHEN `QueueService.skip` transitions a `CALLED` ticket to `SKIPPED` THEN the system emits `queue:update`, but does NOT call `emitTicketNotification` or `sendNotification`, so no `SKIPPED` turn-alert (socket or push) reaches the customer.

1.5 WHEN `QueueService.callNext` consumes the front-of-line `WAITING` ticket for a service THEN the system does NOT notify the new front-of-line `WAITING` ticket, so no `ALMOST_TURN` turn-alert is ever produced.

1.6 WHEN any queue-serving action that should trigger a turn-alert runs THEN the system never invokes `emitTicketNotification` or `sendNotification` from production code (they are referenced only by tests), so the `YOUR_TURN` / `ALMOST_TURN` / `SKIPPED` alert types defined in `@queuenow/shared-types` never fire in production.

### Expected Behavior (Correct)

The following describe what should happen (function `F'`, the fixed code) for the same conditions.

2.1 WHEN `QueueService.callNext` transitions a ticket to `CALLED` THEN the system SHALL call `emitTicketNotification(ticketId, payload)` for that ticket with a payload carrying at least `{ type: NotificationType.YOUR_TURN, counterName }` (the counter the ticket was called to), in addition to the existing `queue:update` / `ticket:update` / `queue:ticket-called` emissions.

2.2 WHEN `QueueService.callNext` transitions a ticket to `CALLED` AND that ticket has a non-null `customerProfileId` THEN the system SHALL call `sendNotification(ticketId, customerProfileId, NotificationType.YOUR_TURN)` so a `Notification` record is created and push delivery is attempted (subject to the graceful-degradation rules in 2.9–2.11).

2.3 WHEN `QueueService.recall` re-summons a `CALLED` ticket THEN the system SHALL call `emitTicketNotification` with `{ type: NotificationType.YOUR_TURN, counterName }` for that ticket, AND (when the ticket has a non-null `customerProfileId`) SHALL call `sendNotification(ticketId, customerProfileId, NotificationType.YOUR_TURN)`. (See OQ-2.)

2.4 WHEN `QueueService.skip` transitions a `CALLED` ticket to `SKIPPED` THEN the system SHALL call `emitTicketNotification(ticketId, { type: NotificationType.SKIPPED, ... })` for that ticket, AND (when the ticket has a non-null `customerProfileId`) SHALL call `sendNotification(ticketId, customerProfileId, NotificationType.SKIPPED)`.

2.5 WHEN `QueueService.callNext` consumes the front-of-line `WAITING` ticket for a service AND a subsequent `WAITING` ticket exists for that same service THEN the system SHALL send a single `ALMOST_TURN` turn-alert to the new front-of-line `WAITING` ticket (the next ticket by FIFO `createdAt` ordering after the called one): `emitTicketNotification(nextTicketId, { type: NotificationType.ALMOST_TURN, ... })`, AND (when that next ticket has a non-null `customerProfileId`) `sendNotification(nextTicketId, customerProfileId, NotificationType.ALMOST_TURN)`. (Working assumption — see OQ-1.)

2.6 WHEN `QueueService.callNext` consumes the front-of-line `WAITING` ticket AND no subsequent `WAITING` ticket exists for that service THEN the system SHALL NOT produce any `ALMOST_TURN` alert.

2.7 WHEN a single ticket transition occurs (one `callNext` / `recall` / `skip` invocation) THEN the system SHALL send at most one turn-alert of a given type per affected ticket for that transition (no duplicate `ticket:notification` emissions and no duplicate `Notification` records for the same transition occurrence).

2.8 WHEN `emitTicketNotification` or `sendNotification` fails (socket error, push provider error, missing token) THEN the system SHALL NOT fail or roll back the queue-serving action; the ticket transition and its existing emissions SHALL complete successfully (delivery failures are recorded/logged per existing graceful degradation, not propagated).

2.9 WHEN a notified ticket is anonymous (null `customerProfileId`) THEN the system SHALL emit the `ticket:notification` socket event only and SHALL NOT call `sendNotification` (socket-only delivery; no push, no `Notification` record).

2.10 WHEN a notified ticket has a `customerProfileId` but no registered `pushToken` THEN the system SHALL still call `sendNotification` so the `Notification` is recorded, and push delivery SHALL be skipped gracefully (per existing `NotificationService` behavior — record only, no throw).

2.11 WHEN a notified ticket has a `customerProfileId` with a registered `pushToken` THEN the system SHALL call `sendNotification` and push delivery SHALL be attempted via Expo, with the record marked `SENT`/`FAILED` per the existing `NotificationService` delivery logic.

### Unchanged Behavior (Regression Prevention)

The following describe behavior that must be preserved (for all inputs, `F'` must behave identically to `F`).

3.1 WHEN any queue action calls `emitQueueUpdate` THEN the system SHALL CONTINUE TO emit `queue:update` to the `org:<orgId>` room and the `org:<orgId>:service:<serviceId>` room, and `ticket:update` to the `ticket:<id>` room, with unchanged payloads — so mobile live position tracking keeps working.

3.2 WHEN `callNext` or `recall` runs THEN the system SHALL CONTINUE TO emit `queue:ticket-called` to the `org:<orgId>` room with its existing payload (including `isRecall`/`recallCount` for recall) — so Display screens keep working.

3.3 WHEN a ticket transitions through `joinQueue`, `complete`, `rejoin`, or `cancelTicket` THEN the system SHALL CONTINUE TO emit exactly the same events it currently emits, with no new turn-alert side effects added to those actions.

3.4 WHEN staff invoke `callNext`, `recall`, or `skip` THEN the system SHALL CONTINUE TO enforce the existing staff org-access authorization (`validateStaffOrgAccess`) and existing not-found / invalid-status / max-recall validation, unchanged.

3.5 WHEN a queue-serving action returns its result THEN the system SHALL CONTINUE TO return the same response shape (the updated ticket with its existing `include` relations) — adding turn-alert side effects SHALL NOT change return values.

3.6 WHEN the existing queue and notification test suites run THEN they SHALL CONTINUE TO pass unchanged (green).

3.7 WHEN `NotificationService.sendNotification` is invoked THEN it SHALL CONTINUE TO behave exactly as today for all its inputs (record `PENDING`, resolve token + orgId, deliver or degrade, mark `SENT`/`FAILED`, never throw) — this bugfix wires callers to it but does not modify its internal logic.

## Bug Condition and Properties

These formalize the defect using the bug-condition methodology. `F` is the current code; `F'` is the fixed code.

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ServingAction   // a callNext / recall / skip invocation with its resulting ticket transition
  OUTPUT: boolean

  // The bug is triggered by any serving action that SHOULD produce a turn-alert
  // but currently produces none.
  RETURN (X.action = CALL_NEXT  AND X.resultStatus = CALLED)        // expects YOUR_TURN (called ticket) + maybe ALMOST_TURN (next)
      OR (X.action = RECALL     AND X.resultStatus = CALLED)        // expects YOUR_TURN
      OR (X.action = SKIP       AND X.resultStatus = SKIPPED)       // expects SKIPPED
END FUNCTION
```

### Property: Fix Checking

```pascal
// For every serving action that should alert, the fixed code emits the socket
// notification (and pushes when a customer profile is attached).
FOR ALL X WHERE isBugCondition(X) DO
  effects ← F'(X)

  // Socket channel always fires for the directly affected ticket.
  ASSERT effects.emitTicketNotification CALLED WITH ticketId = X.ticket.id
         AND payload.type = expectedType(X)            // YOUR_TURN | SKIPPED
         AND (expectedType(X) = YOUR_TURN IMPLIES payload.counterName = X.counter.name)

  // Push channel fires iff the affected ticket has a customerProfileId.
  IF X.ticket.customerProfileId ≠ null THEN
    ASSERT effects.sendNotification CALLED WITH (X.ticket.id, X.ticket.customerProfileId, expectedType(X))
  ELSE
    ASSERT effects.sendNotification NOT CALLED FOR X.ticket.id
  END IF

  // ALMOST_TURN for the new front-of-line ticket on callNext (working assumption, OQ-1).
  IF X.action = CALL_NEXT AND existsNextWaiting(X.service) THEN
    next ← frontOfLineWaitingAfter(X.ticket, X.service)
    ASSERT effects.emitTicketNotification CALLED WITH ticketId = next.id AND payload.type = ALMOST_TURN
    IF next.customerProfileId ≠ null THEN
      ASSERT effects.sendNotification CALLED WITH (next.id, next.customerProfileId, ALMOST_TURN)
    END IF
  END IF

  // Idempotency: at most one alert of a given type per affected ticket per transition.
  ASSERT noDuplicateAlerts(effects)

  // Side-effect isolation: the queue action still succeeds even if delivery throws.
  ASSERT effects.queueActionSucceeded = true
END FOR
```

### Property: Preservation Checking

```pascal
// For every input that is NOT a turn-alert-producing serving action, and for the
// pre-existing emissions of the actions that are, the fixed code is identical to F.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR

// Plus: even for buggy-condition inputs, the PRE-EXISTING emissions and return
// value are unchanged (only NEW turn-alert side effects are added).
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT F'(X).emitQueueUpdate    = F(X).emitQueueUpdate       // queue:update + ticket:update unchanged
  ASSERT F'(X).emitTicketCalled   = F(X).emitTicketCalled      // queue:ticket-called unchanged (callNext/recall)
  ASSERT F'(X).authorization      = F(X).authorization         // staff-auth + validation unchanged
  ASSERT F'(X).returnValue        = F(X).returnValue           // response shape unchanged
END FOR
```

**Key definitions:**

- **F** — the queue-serving code before the fix (no turn-alert wiring).
- **F'** — the queue-serving code after the fix (turn-alert wiring added to `callNext`, `recall`, `skip`).
- **expectedType(X)** — `YOUR_TURN` for `CALL_NEXT`/`RECALL`, `SKIPPED` for `SKIP`.
- **frontOfLineWaitingAfter(ticket, service)** — the next `WAITING` ticket for the service by FIFO `createdAt` ordering once `ticket` has been called (the ticket the next `callNext` would return). Subject to OQ-1.

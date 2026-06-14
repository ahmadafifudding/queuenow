# Implementation Plan: QueueNow Customer Mobile App (apps/mobile)

## Overview

This plan converts the design into incremental coding tasks for the new `apps/mobile` React Native (Expo) app. It is sequenced by delivery phase so the MVP slice (discovery → join → live ticket tracking → turn alerts) is completable and shippable first, then account features (history, favorites, notifications list), then the three backend dependencies, then offline hardening and cross-cutting quality gates.

The architecture is established once in Phase 1: scaffold first (Expo + Metro monorepo config + workspace deps on all three shared packages + env validation + `tsconfig` extending `tsconfig.base.json`), then the core `lib/` layer (REST client, query client/keys, error-map, socket client + reconnect/backoff, secure-store/auth manager + `deviceFingerprint`, notification manager, offline cache/connectivity, timezone formatting) before any feature screens. Feature modules are thin layers on top of that core.

Property-based tests use **fast-check** (minimum **100 runs**), one test per design property (Properties 1–21), colocated near the code they validate, and tagged `// Feature: customer-mobile-app, Property N: ...`. Example/integration tests cover the critical flows the design's Testing Strategy calls out. Test sub-tasks are marked optional with `*`.

The three BACKEND DEPENDENCIES (R11, R12, R13) are scoped explicitly: each has backend-side work in `apps/api` (clearly labelled `[apps/api]`) and app-side wiring in `apps/mobile` (labelled `[apps/mobile]`) with graceful degradation until the backend lands.

Language: **TypeScript (strict mode)**, per the design. Conventions follow `.kiro/steering/project-standards.md` and `.kiro/steering/frontend-web.md`.

## Tasks

- [x] 1. Scaffold Expo foundation, monorepo wiring, and env validation
  - [x] 1.1 Initialize the `apps/mobile` Expo + TypeScript-strict project
    - Set up Expo (SDK 56, RN 0.85, React 19.2), TypeScript strict mode, and expo-router (file-based routing)
    - Create the feature-based folder structure (`app/` routes, `src/features/`, `src/lib/`, `src/components/`, `src/i18n/`) and the thin route files (`_layout.tsx`, `index.tsx`, `scan.tsx`, `join/[orgId].tsx`, `ticket/[orgId]/[ticketId].tsx`, `(account)/*`, `+not-found.tsx`)
    - Add `tsconfig.json` extending `tsconfig.base.json`; add `package.json` scripts including `typecheck`
    - _Requirements: 14.1, 14.2_

  - [x] 1.2 Configure Metro for the monorepo and declare workspace dependencies
    - Configure Metro to watch `packages/*` and resolve symlinked workspace packages
    - Declare `workspace:*` dependencies on `@queuenow/shared-types`, `@queuenow/shared-validation`, and `@queuenow/shared-constants` in `apps/mobile/package.json`
    - Add a boot presence-assertion module that imports a sentinel from each shared package so a missing package fails the Metro/TypeScript build rather than degrading to a subset
    - _Requirements: 14.3, 14.4, 14.5_

  - [x] 1.3 Implement the env validator and `app.config.ts`
    - Create `src/lib/env.ts` with a Zod schema validating `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WS_URL`, exporting a frozen typed `env`; fail-fast with a named error listing offending variables (no hardcoded URLs)
    - Wire `app.config.ts` to read public env and register Expo plugins (expo-camera, expo-secure-store, expo-notifications)
    - _Requirements: 14.1, 14.2_

- [x] 2. Build the REST client layer and shared query infrastructure
  - [x] 2.1 Implement the REST client (`src/lib/api/client.ts`)
    - Base URL from validated `env`; success-envelope unwrap returning `{ data, meta }`; typed `ApiError(code, message, details, httpStatus)` on error envelopes; non-JSON / unrecognized shape / network / timeout → synthetic `ApiError(INTERNAL_ERROR)` so the UI can offer retry
    - Auth header: read access token from the Auth_Manager; for `authenticated` requests fail closed (throw, never send without the header) when the token cannot be obtained
    - Single-flight `401` refresh-and-retry against `POST /customers/refresh` (configurable path); retry the original request once; on failure clear tokens and signal return-to-sign-in; treat `404`/`501` as a refresh failure (no loop) for graceful degradation
    - _Requirements: 10.1, 10.2, 10.3, 6.4, 6.5, 12.1, 12.3, 12.4_

  - [x] 2.2 Create the QueryClient, query keys, and invalidation helpers
    - Implement `src/lib/api/query-client.ts` (retry off for 4xx, default staleTime, error handler keyed on `ApiError.code`) and `src/lib/api/query-keys.ts` central factory (`orgStatus`, `ticket`, `history`, `favorites`, `notifications`)
    - Implement invalidation/removal helpers: join → invalidate `orgStatus`; ticket events → invalidate `ticket`; favorite mutations → invalidate `favorites`; sign-out → **remove** `history`/`favorites`/`notifications` from the cache
    - _Requirements: 10.1, 7.4_

  - [x] 2.3 Add the i18n string catalog and error-code message map
    - Create `src/i18n/` (English MVP catalog) and `src/lib/api/error-map.ts` translating `ERROR_CODES` from `@queuenow/shared-constants` to friendly copy with a generic fallback; key only on the code, never on message text; `QUEUE_FULL` → queue-full copy
    - _Requirements: 10.2, 10.4, 2.5_

  - [x] 2.4 Build the boundary test harness
    - Provide a mock REST client (returns envelopes / throws `ApiError`), a mock socket (emits synthetic `ticket:update` / `ticket:notification` and connection-state transitions), an in-memory secure-store adapter with injectable write/read failures, a fake `NetInfo`/`AppState`, and a fake notifications module
    - _Supports: Testing Strategy (Properties 1–21); no real backend, keychain, or live socket_
    - _Requirements: 10.5_

  - [x]\* 2.5 Write property test for envelope unwrapping and failure normalization
    - **Property 19: Response envelope unwrapping and failure normalization**
    - **Validates: Requirements 10.1, 10.2, 10.3**
    - Location: `src/lib/api/__tests__/client-envelope.property.test.ts`

  - [x]\* 2.6 Write property test for the authenticated-request auth header
    - **Property 15: Authenticated requests attach the Bearer token or fail closed**
    - **Validates: Requirements 6.4, 6.5**
    - Location: `src/lib/api/__tests__/client-auth-header.property.test.ts`

  - [x]\* 2.7 Write property test for single-flight 401 refresh-and-retry
    - **Property 21: Single-flight 401 refresh-and-retry is bounded**
    - **Validates: Requirements 12.1, 12.3, 12.4**
    - Location: `src/lib/api/__tests__/client-refresh.property.test.ts`

  - [x]\* 2.8 Write property test for the error-code-to-message map
    - **Property 20: Error-code-to-message mapping depends only on the code**
    - **Validates: Requirements 2.5, 10.2, 10.4, 11.4**
    - Location: `src/lib/api/__tests__/error-map.property.test.ts`

- [x] 3. Build the realtime socket client and resilience layer
  - [x] 3.1 Implement the Realtime Client and subscription bridge (`src/lib/socket.ts`)
    - One `socket.io-client` connection on `/queue`; ref-counted subscription registry; `subscribeTicket`/`unsubscribeTicket`/`subscribeRoom`/`unsubscribeRoom` emitting only `WS_EVENTS` names; re-subscribe every tracked entry on connect/reconnect
    - Bridge: on `ticket:update` for a tracked ticket, invalidate `queryKeys.ticket(orgId, ticketId)` within 2s; on `ticket:notification`, hand the payload to the Notification_Manager
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 3.3_

  - [x] 3.2 Implement bounded connect-and-resubscribe retry and reconnect triggers
    - After (re)connect await subscription acknowledgement within a window; on failure retry the whole connect-and-resubscribe cycle with exponential backoff (`min(base * factor^n, cap)`, bounded max attempts); settle on `disconnected` and surface a manual-reconnect affordance when exhausted
    - Triggers: socket connection loss, `NetInfo` change to connected, `AppState` → active, explicit `reconnectNow()`; expose status via a small Zustand store
    - _Requirements: 4.4, 4.5, 9.3_

  - [x]\* 3.3 Write property test for the ticket-update bridge key targeting
    - **Property 6: Ticket-update bridge targets the matching query key**
    - **Validates: Requirements 3.3**
    - Location: `src/lib/__tests__/socket-bridge.property.test.ts`

  - [x]\* 3.4 Write property test for subscription lifecycle
    - **Property 7: Subscription lifecycle is consistent across mount, unmount, and reconnect**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6**
    - Location: `src/lib/__tests__/subscription-lifecycle.property.test.ts`

  - [x]\* 3.5 Write property test for reconnect re-issuing tracked subscriptions
    - **Property 8: Reconnect re-issues exactly the tracked subscriptions**
    - **Validates: Requirements 4.4, 9.3**
    - Location: `src/lib/__tests__/reconnect-resubscribe.property.test.ts`

  - [x]\* 3.6 Write property test for the retry backoff schedule
    - **Property 9: Connect-and-resubscribe retry schedule is bounded with exponential backoff**
    - **Validates: Requirements 4.5**
    - Location: `src/lib/__tests__/retry-backoff.property.test.ts`

- [x] 4. Build the Auth Manager, secure token storage, and device fingerprint
  - [x] 4.1 Implement secure-store, auth-store, and device fingerprint
    - Create `src/lib/auth/secure-store.ts` (expo-secure-store read/write/confirm), `src/lib/auth/auth-store.ts` (Zustand in-memory session mirror), and `src/lib/auth/fingerprint.ts` (stable `deviceFingerprint` generated once and persisted in secure storage on first launch)
    - _Requirements: 6.7, 6.8, 6.9, 2.3_

  - [x] 4.2 Implement the Auth Manager (`src/lib/auth/auth-manager.ts`)
    - `register`/`login` call the REST client, write both tokens, then **read them back** to confirm the write before flipping to "signed in"; on storage failure surface an error and remain signed-out
    - `signOut` deletes both tokens, clears the in-memory mirror, and removes account-scoped query data; `getAccessToken`/`getDeviceFingerprint`/`isSignedIn`; validate account input with `customerRegisterSchema`/`loginSchema` before sending
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.10, 7.4_

  - [x]\* 4.3 Write property test for the secure-token write-confirmation invariant
    - **Property 14: Secure-token write-confirmation invariant**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 6.9**
    - Location: `src/lib/auth/__tests__/secure-token.property.test.ts`

  - [x]\* 4.4 Write property test for account-input schema validation
    - **Property 16: Account input validates against the shared schema before sending**
    - **Validates: Requirements 6.10**
    - Location: `src/lib/auth/__tests__/account-validation.property.test.ts`

  - [x]\* 4.5 Write property test for account data isolation when signed out
    - **Property 17: Account data isolation when signed out**
    - **Validates: Requirements 7.4**
    - Location: `src/lib/auth/__tests__/account-isolation.property.test.ts`

- [x] 5. Build timezone formatting and offline cache/connectivity utilities
  - [x] 5.1 Implement timezone-aware formatting (`src/lib/format.ts`)
    - Format displayed times in the org timezone (`IOrganization.timezone`, IANA) via `Intl.DateTimeFormat` with explicit `timeZone`; render wait estimates in human terms; serialize dates sent to the API as ISO-8601
    - _Requirements: 3.1_

  - [x] 5.2 Implement the offline cache and connectivity bridge
    - Create `src/lib/api/persist.ts` (read-only persistence of the last-known Active_Ticket details on every successful load) and `src/lib/connectivity.ts` (NetInfo + AppState bridge exposing connectivity and a "may be out of date" staleness signal, plus live-action gating state)
    - _Requirements: 9.1, 9.2, 9.5_

  - [x]\* 5.3 Write property test for offline cache round-trip, staleness, and action gating
    - **Property 18: Offline cache round-trip, staleness, and action gating**
    - **Validates: Requirements 9.1, 9.2, 9.5**
    - Location: `src/lib/api/__tests__/offline-cache.property.test.ts`

- [x] 6. Build the Notification Manager and push registration
  - [x] 6.1 Implement the Notification Manager (`src/lib/notifications/manager.ts`)
    - Map `NotificationType` from `ticket:notification` events to alerts: `ALMOST_TURN` → "almost your turn"; `YOUR_TURN` → "your turn" with counter name; `SKIPPED` → "ticket skipped"; alerts surface only in response to events (never proactively)
    - Channel selection: OS local notification when permission granted; otherwise (denied + foreground/active) a persistent in-app banner and/or audible alert
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.2 Implement push-token registration and deep-link on activation (`src/lib/notifications/push.ts`)
    - When signed-in and permission granted, obtain an Expo/native push token and register it via `POST /notifications/push-token`; on a delivered push for an Active_Ticket, deep-link to `/ticket/[orgId]/[ticketId]` on activation; foreground-only v1 coverage until backend delivery lands (no push token registered → in-app/foreground alerts remain the guaranteed path)
    - _Requirements: 13.1, 13.3, 13.4_

  - [x]\* 6.3 Write property test for turn-notification mapping
    - **Property 10: Turn-notification mapping is exhaustive and event-driven**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6**
    - Location: `src/lib/notifications/__tests__/turn-mapping.property.test.ts`

  - [x]\* 6.4 Write property test for notification channel selection
    - **Property 11: Notification channel selection**
    - **Validates: Requirements 5.5, 13.4**
    - Location: `src/lib/notifications/__tests__/channel-selection.property.test.ts`

  - [x]\* 6.5 Write example test for push payload deep-linking
    - Delivered push payload for an Active_Ticket resolves to the `/ticket/[orgId]/[ticketId]` route on activation
    - _Requirements: 13.3_

- [x] 7. Implement organization and service discovery (MVP)
  - [x] 7.1 Implement QR/deep-link parsing, manual code entry, and service resolution
    - Parse a scanned `{base}/join/{slug}?service={serviceId}` URL into a `DiscoveryTarget`; manual code entry on `index.tsx`; QR scanner on `scan.tsx` (expo-camera); resolve active services via `GET /organizations/:orgId/queue/status`; compute the join-availability decision (join action iff active org with ≥1 active service); show an error with no join action for `ORG_NOT_FOUND`/`ORG_INACTIVE`; require service selection when more than one active service
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x]\* 7.2 Write property test for QR/deep-link parse round-trip
    - **Property 1: QR / deep-link parse round-trips**
    - **Validates: Requirements 1.1**
    - Location: `src/features/discovery/__tests__/qr-parse.property.test.ts`

  - [x]\* 7.3 Write property test for the discovery join-availability decision
    - **Property 2: Discovery join-availability decision**
    - **Validates: Requirements 1.3, 1.4**
    - Location: `src/features/discovery/__tests__/join-availability.property.test.ts`

  - [x]\* 7.4 Write example test for the manual-code discovery happy path
    - Manual code resolves the org and renders its active services
    - _Requirements: 1.2_

- [x] 8. Implement join queue and ticket result (MVP)
  - [x] 8.1 Implement join request construction and the join/result screen
    - On `join/[orgId].tsx`: build the join request (always a non-empty `deviceFingerprint`; `customerName`/`customerPhone` when provided; `customerProfileId` when signed in); validate with `joinQueueSchema` before sending; `POST /organizations/:orgId/queue/join`; display the returned `ticketNumber`, `position`, and `estimatedWaitMinutes` verbatim (no client offset); on `QUEUE_FULL` show the mapped message and issue no ticket
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x]\* 8.2 Write property test for join request construction and validation
    - **Property 3: Join request construction and validation**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.6, 2.7**
    - Location: `src/features/queue/__tests__/build-join-request.property.test.ts`

  - [x]\* 8.3 Write property test for verbatim position and wait
    - **Property 4: Position and wait are displayed verbatim (no client offset)**
    - **Validates: Requirements 2.4**
    - Location: `src/features/queue/__tests__/verbatim-position.property.test.ts`

- [x] 9. Implement active-ticket tracking, realtime, offline, and turn alerts (MVP)
  - [x] 9.1 Implement the active-ticket tracking screen
    - On `ticket/[orgId]/[ticketId].tsx`: fetch via `GET /organizations/:orgId/queue/ticket/:ticketId`; project the status view (live `position`/`estimatedWaitMinutes` only when `WAITING`; counter name when `CALLED`; terminal flag with no live position/wait when `COMPLETED`/`SKIPPED`); subscribe via the Realtime Client on mount and unsubscribe on leave; update displayed status/position within 2s of `ticket:update`
    - Wire offline behavior: render the cached ticket with a stale indicator while offline, disable live actions with a stated reason, refetch + re-subscribe on connectivity restore, and pull-to-refresh manual refetch; route `ticket:notification` events to the Notification_Manager for turn alerts
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.3, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]\* 9.2 Write property test for ticket status projection
    - **Property 5: Ticket status projection**
    - **Validates: Requirements 3.1, 3.4, 3.5**
    - Location: `src/features/queue/__tests__/project-ticket-status.property.test.ts`

  - [x]\* 9.3 Write example test for the ticket-view fetch
    - Opening the ticket view calls `GET /organizations/:orgId/queue/ticket/:ticketId`
    - _Requirements: 3.2_

  - [x]\* 9.4 Write integration test for socket subscribe-on-view
    - Against a mock socket, the ticket view connects to `/queue` and emits `subscribe:ticket` for the Active_Ticket
    - _Requirements: 4.1_

- [x] 10. Checkpoint - Phase 1 (MVP) complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement the optional account auth screens (Phase 2)
  - [x] 11.1 Build register, sign-in, and sign-out screens
    - On `(account)/register.tsx` and `(account)/sign-in.tsx`: forms using `customerRegisterSchema`/`loginSchema`; call `authManager.register`/`login`; on invalid credentials show the mapped message and store no token; sign-out clears tokens and removes account-scoped query data
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.10_

  - [x]\* 11.2 Write example tests for the auth flow
    - Register/login success and failure, sign-out clears state, submit disabled while pending
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

- [x] 12. Implement ticket history (Phase 2)
  - [x] 12.1 Implement the history screen
    - On `(account)/history.tsx`: when signed in retrieve `GET /customers/history`; render each row's organization name, service name, `ticketNumber`, and `TicketStatus`; order most-recent-first; when signed out present an account prompt and hide all history content (including cached history)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]\* 12.2 Write property test for reverse-chronological ordering
    - **Property 12: Reverse-chronological ordering**
    - **Validates: Requirements 5.7, 7.3**
    - Location: `src/features/history/__tests__/ordering.property.test.ts`

  - [x]\* 12.3 Write property test for required list-row fields
    - **Property 13: List rows expose their required fields** (history and favorites)
    - **Validates: Requirements 7.2, 8.4**
    - Location: `src/features/history/__tests__/list-rows.property.test.ts`

  - [x]\* 12.4 Write integration test for the history hook
    - The history query calls `GET /customers/history`
    - _Requirements: 7.1_

- [x] 13. Implement favorite organizations (Phase 2)
  - [x] 13.1 Implement the favorites screen and mutations
    - On `(account)/favorites.tsx`: retrieve `GET /customers/favorites`; add via `POST /customers/favorites/:orgId` and remove via `DELETE /customers/favorites/:orgId` (invalidate `favorites()` on success); render each favorite's organization name and a view-services action
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]\* 13.2 Write integration test for favorites list/add/remove
    - The hooks call the correct list/add/remove paths and methods
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 14. Implement the notifications list and push registration wiring (Phase 2)
  - [x] 14.1 Implement the notifications list screen
    - On `(account)/notifications.tsx`: when signed in retrieve `GET /notifications` and display entries in reverse chronological order
    - _Requirements: 5.7_

  - [x]\* 14.2 Write integration test for notifications list and push-token registration
    - The notifications query calls `GET /notifications`; push-token registration calls `POST /notifications/push-token` when signed-in and permission granted
    - _Requirements: 5.7, 13.1_

- [x] 15. Checkpoint - Phase 2 (account features) complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. R11 — Customer leave/cancel ticket (Backend Dependency)
  - [x] 16.1 [apps/api] Add the public, ownership-scoped cancel endpoint to the queue module
    - Add `POST /organizations/:orgId/queue/ticket/:ticketId/cancel` (`@Public()`) with body `{ deviceFingerprint?: string; customerProfileId?: string }`; authorize by ownership (matching `deviceFingerprint` or `customerProfileId`); transition the caller's own `WAITING` ticket out of the active queue; reject non-`WAITING` tickets with `QUEUE_INVALID_STATUS`; emit `queue:update`/`ticket:update`
    - _Requirements: 11.2_

  - [x]\* 16.2 [apps/api] Write tests for the cancel endpoint
    - Ownership acceptance/rejection, non-`WAITING` rejection with the mapped code, and event emission
    - _Requirements: 11.2, 11.4_

  - [x] 16.3 [apps/mobile] Wire the Leave/cancel flow with graceful degradation
    - Add a Leave action on the ticket screen that requests cancellation; on success update the view to "no longer in queue" and stop live tracking (unsubscribe); on a non-`WAITING` error show the mapped message and refetch the ticket; on `404`/`501` show a "not available yet" message and keep the ticket visible (no client-side faking)
    - _Requirements: 11.1, 11.3, 11.4_

- [x] 17. R12 — Customer token refresh (Backend Dependency)
  - [x] 17.1 [apps/api] Add the customer refresh endpoint to the customer module
    - Add `POST /customers/refresh` (`@Public()`) accepting `{ refreshToken }` in the body; verify the customer refresh JWT, validate and rotate the backing `CustomerSession`, and return the `ICustomerLoginResponse` token-pair shape; map invalid/expired refresh to `AUTH_TOKEN_EXPIRED`/`AUTH_UNAUTHORIZED`
    - _Requirements: 12.2_

  - [x]\* 17.2 [apps/api] Write tests for the refresh endpoint
    - Valid refresh rotates the session and returns a new pair; invalid/expired returns the auth error code
    - _Requirements: 12.2, 12.4_

  - [x] 17.3 [apps/mobile] Finalize the refresh-and-retry wiring with degradation
    - Point the REST client refresh path at `POST /customers/refresh`; on success replace stored tokens and retry once; on failure (including `404`/`501`) clear tokens and route to sign-in without looping
    - _Requirements: 12.1, 12.3, 12.4_

- [x] 18. R13 — Push notification delivery (Backend Dependency)
  - [x] 18.1 [apps/api] Implement push delivery in `NotificationService.sendNotification`
    - Integrate a push provider (FCM/APNs or Expo Push) to deliver `YOUR_TURN`, `ALMOST_TURN`, and `SKIPPED` notifications to the stored `pushToken`; the `POST /notifications/push-token` registration endpoint is unchanged
    - _Requirements: 13.2_

  - [x]\* 18.2 [apps/api] Write tests for push delivery
    - The provider is invoked per notification type for a registered token; missing/unregistered token is handled without delivery
    - _Requirements: 13.2_

  - [x] 18.3 [apps/mobile] Wire the background-delivered push handler and deep link
    - Handle a backend-delivered (background/closed-app) push by deep-linking to `/ticket/[orgId]/[ticketId]` on activation; until backend delivery lands, coverage remains foreground/in-app only via the Realtime_Client + Notification_Manager
    - _Requirements: 13.1, 13.3, 13.4_

- [x] 19. Checkpoint - Phase 3 (backend dependencies) complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Offline hardening and cross-cutting quality gates (Phase 4)
  - [x] 20.1 Harden app-wide offline behavior and connectivity restore
    - Ensure every action requiring a live request is disabled offline with a stated reason across all screens; verify connectivity-restore refetch and Realtime_Client re-subscription app-wide; ensure the stale indicator is consistent wherever cached data is shown
    - _Requirements: 9.2, 9.3, 9.5_

  - [x] 20.2 Establish the accessibility baseline
    - Ensure interactive elements have accessible labels/roles and visible focus; verify the foreground turn-alert banner is announced and the audible-alert fallback is reachable; support dynamic type and sufficient contrast on key screens
    - _Requirements: 5.5, 14.1_

  - [x]\* 20.3 Write integration tests for connectivity restore and manual refresh
    - On connectivity restore the ticket refetches and subscriptions re-establish; manual pull-to-refresh refetches the ticket
    - _Requirements: 9.3, 9.4_

  - [x]\* 20.4 Add build/smoke and strict-typecheck quality gates
    - Assert all three shared packages resolve and the build fails when one is missing; assert no local redefinition of shared types via type-check + lint; run a strict `typecheck` that fails on type errors and any use of `any`; verify the app builds for the iOS and Android Expo runtimes in CI
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 10.5_

- [x] 21. Final checkpoint - all phases complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP, but each property test maps one-to-one to a design property (Properties 1–21) and each example/integration test covers a critical flow named in the design's Testing Strategy.
- Property-based tests use **fast-check**, run a minimum of **100** generated cases, are colocated near the code they validate, and carry the traceability tag `// Feature: customer-mobile-app, Property N: ...`.
- All app-side tests mock external boundaries (REST client, socket, secure-store, `NetInfo`/`AppState`, notifications) via the harness from task 2.4 — no real backend, device keychain, or live socket.
- Backend-dependency tasks are split between `[apps/api]` (backend work) and `[apps/mobile]` (app-side wiring with graceful degradation). App-side R11/R12 control flow is additionally covered by Properties 7, 20, and 21; R13 channel selection by Property 11.
- Phase 1 (tasks 1–9) is the first shippable MVP slice; Phase 2 adds account features; Phase 3 lands the backend dependencies; Phase 4 hardens offline behavior and enforces quality gates.
- TypeScript strict mode throughout, per `.kiro/steering/project-standards.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1", "5.1", "16.1", "17.1", "18.1"] },
    { "id": 3, "tasks": ["2.1", "3.1", "5.2", "6.1", "16.2", "17.2", "18.2"] },
    { "id": 4, "tasks": ["2.4", "4.2", "3.2", "6.2", "17.3"] },
    {
      "id": 5,
      "tasks": [
        "2.5",
        "2.6",
        "2.7",
        "2.8",
        "3.3",
        "3.4",
        "3.5",
        "3.6",
        "4.3",
        "4.4",
        "4.5",
        "5.3",
        "6.3",
        "6.4",
        "6.5",
        "7.1",
        "18.3"
      ]
    },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "9.4", "11.1", "12.1", "13.1", "14.1", "16.3"] },
    { "id": 9, "tasks": ["11.2", "12.2", "12.3", "12.4", "13.2", "14.2", "20.1", "20.2"] },
    { "id": 10, "tasks": ["20.3", "20.4"] }
  ]
}
```

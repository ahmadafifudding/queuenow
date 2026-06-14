# Implementation Plan: QueueNow Web Frontend (apps/web)

## Overview

This plan converts the design into incremental coding tasks for the `apps/web` React frontend. It is sequenced by delivery phase so Phase 1 (MVP) is completable and shippable first, then Phase 2, then Phase 3, with cross-cutting accessibility and quality gates last.

The architecture is established once in Phase 1: scaffold first, then the shared core (`lib/` — API client, query client/keys, socket client, polling fallback, theme, formatting, i18n/error-map), then auth/session, guards/RBAC, the staff queue panel, and the public Display. Phases 2 and 3 only add thin feature modules on top of that core.

Property-based tests (fast-check + Vitest, minimum 100 runs, tagged `// Feature: web-app, Property N: ...`) are colocated near the code they validate, one test per design property (Properties 1–17). Example-based tests cover the auth flow, queue serving actions, and route guards. Test sub-tasks are marked optional with `*`.

Language: TypeScript (strict mode), per the design. Conventions follow `.kiro/steering/frontend-web.md` and `.kiro/steering/project-standards.md`.

## Tasks

- [x] 1. Scaffold project foundation and environment validation
  - [x] 1.1 Initialize the `apps/web` Vite + React 19 + TypeScript-strict project
    - Set up Vite, React 19, TypeScript strict mode, Tailwind CSS, and shadcn/ui
    - Add TanStack Router (file-based) and TanStack Query providers; create `router.tsx` and the feature-based folder structure (`routes/`, `features/`, `components/ui/`, `lib/`, `hooks/`, `types/`, `i18n/`)
    - Add `package.json` scripts including `generate:api` (openapi-typescript) and `typecheck`; configure route lazy-loading so `display.$orgId` and `kiosk.$orgId` are code-split out of the Dashboard entry
    - _Requirements: 1.1, 1.2, 1.7, 1.8_

  - [x] 1.2 Implement the Env_Validator and `.env.example`
    - Create `lib/env.ts` with a Zod schema validating `VITE_API_URL` and `VITE_WS_URL` from `import.meta.env`, exporting a frozen typed `env`; throw a named error on failure for `main.tsx` to render a fatal-config screen (fail-fast)
    - Create `apps/web/.env.example` listing every required variable
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x]\* 1.3 Write property test for environment validation
    - **Property 16: Env validation accepts iff required vars are present and well-formed**
    - **Validates: Requirements 1.3, 1.4**
    - Location: `lib/__tests__/env.property.test.ts`

- [x] 2. Build the API client layer and shared query infrastructure
  - [x] 2.1 Generate API types and implement the API_Client
    - Run `generate:api` to produce `lib/api/schema.d.ts`; wire `@queuenow/shared-types` for domain enums/interfaces
    - Implement `lib/api/client.ts`: base URL from `env`, `credentials: 'include'`, Bearer header from Auth_Store when present, success-envelope unwrapping returning `{ data, meta }`, typed `ApiError(code, message, details, httpStatus)` on error envelopes, network-failure → synthetic `INTERNAL_ERROR`, and the single-flight 401 refresh-and-retry (retry once)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.5, 4.6_

  - [x] 2.2 Create the QueryClient, query keys, and invalidation helpers
    - Implement `lib/api/query-client.ts` (retry off for 4xx, default staleTime, error handler keyed on `ApiError.code`) and `lib/api/query-keys.ts` central factory (`queue`, `services`, `counters`, `staff`, `org`)
    - _Requirements: 2.1_

  - [x] 2.3 Add the i18n string catalog and error-code message map
    - Create `i18n/` English string catalog (default language) and `lib/api/error-map.ts` translating `ERROR_CODES` from `@queuenow/shared-constants` to friendly copy with a generic fallback (never surface raw backend messages)
    - _Requirements: 2.6, 14.1, 14.2_

  - [x] 2.4 Build the boundary test harness
    - Provide a mock API_Client (returns envelopes / throws `ApiError`), a mock Socket_Client (emits synthetic `queue:update` / `queue:ticket-called` and connection-state transitions), and a `QueryClient` factory with retries disabled
    - _Requirements: 15.1_

  - [x]\* 2.5 Write property test for API_Client envelope, errors, auth header, and refresh policy
    - **Property 1: Success envelope unwrapping preserves data and meta**
    - **Property 2: Error envelope surfaces the error code**
    - **Property 3: Authenticated requests attach the in-memory token**
    - **Property 5: A 401 triggers at most one refresh and one retry**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 4.6**
    - Location: `lib/api/__tests__/client.property.test.ts`

  - [x]\* 2.6 Write property test for mutation invalidation
    - **Property 9: Successful feature mutations invalidate that feature's query keys**
    - **Validates: Requirements 8.5, 9.5, 10.4**
    - Location: `lib/api/__tests__/mutation-invalidation.property.test.ts`

- [x] 3. Build the realtime WebSocket client and resilience layer
  - [x] 3.1 Implement the Socket_Client, subscription registry, and event bridge
    - Create `lib/socket.ts`: one `/queue` connection per session, Dashboard handshake with in-memory token (reconnect on token change), public token-less connect for Display/Kiosk, a room subscription registry, `subscribe`/`unsubscribe` using `WS_EVENTS` from `@queuenow/shared-constants`, re-subscribe on reconnect, and `queue:update` / `queue:ticket-called` handlers that invalidate/patch matching query keys
    - Add the shared `hooks/useSocketSubscription.ts` (emit subscribe on mount, unsubscribe + remove listeners on unmount)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10_

  - [x] 3.2 Implement the polling fallback hook and connection indicator
    - Create `hooks/usePollingFallback.ts` (begin invalidating queue keys every 10s after >15s disconnect; stop on reconnect) and `components/ConnectionIndicator.tsx` (non-blocking reconnecting banner)
    - _Requirements: 3.8, 3.9, 3.11, 7.9_

  - [x]\* 3.3 Write property test for the socket-to-query bridge and subscription lifecycle
    - **Property 8: Socket queue events invalidate the matching query key**
    - **Property 11: Subscription lifecycle is consistent across mount, unmount, and reconnect**
    - **Validates: Requirements 3.5, 3.6, 3.7, 3.10, 6.12, 7.3**
    - Location: `lib/__tests__/socket-bridge.property.test.ts`

  - [x]\* 3.4 Write property test for the polling fallback timing
    - **Property 12: Polling fallback is active only while disconnected beyond the threshold**
    - **Validates: Requirements 3.8, 3.9, 7.9**
    - Location: `hooks/__tests__/polling-fallback.property.test.ts` (fake timers)

- [x] 4. Build theming and timezone formatting utilities
  - [x] 4.1 Implement the theme injector
    - Create `lib/theme.ts`: default CSS-variable design tokens, `applyBranding(primaryColor)` writing the brand value into the `--primary` CSS variable at runtime, and light/dark via the Tailwind `class` strategy on the document root
    - _Requirements: 11.3, 11.4, 11.5_

  - [x] 4.2 Implement org-timezone formatting utilities
    - Create `lib/format.ts`: format displayed times in the Org_Timezone independent of the browser timezone, and serialize dates to the backend as ISO-8601 strings
    - _Requirements: 7.10, 14.3_

  - [x]\* 4.3 Write property test for branding injection
    - **Property 14: Branding primary color is injected verbatim as a CSS variable**
    - **Validates: Requirements 11.3**
    - Location: `lib/__tests__/theme.property.test.ts`

  - [x]\* 4.4 Write property test for timezone and ISO handling
    - **Property 13: Times format in the org timezone and serialize to the backend as ISO**
    - **Validates: Requirements 7.10, 14.3**
    - Location: `lib/__tests__/format.property.test.ts`

- [x] 5. Build shared data-region UI components
  - [x] 5.1 Implement DataRegion and ErrorBoundary
    - Create `components/DataRegion.tsx` with explicit loading (skeleton) / empty / error states and `components/ErrorBoundary.tsx` for recoverable render/runtime errors, preserving shadcn/Radix ARIA semantics
    - _Requirements: 6.13, 7.7, 8.7, 9.7, 10.7, 13.2_

- [x] 6. Implement authentication and session management
  - [x] 6.1 Implement the Auth_Store
    - Create `features/auth/stores/auth-store.ts` (Zustand, no persistence middleware): in-memory `accessToken`, `user`, `organization` (incl. role), `status`; `setSession`, `setAccessToken`, `clear`; token kept out of `localStorage`/`sessionStorage`/non-httpOnly cookies
    - _Requirements: 4.3, 4.4_

  - [x] 6.2 Wire the boot silent refresh and refresh-and-retry lifecycle
    - In `main.tsx`, validate env then attempt a single silent `POST /auth/refresh` before rendering the router (set `authenticated`/`unauthenticated`); connect the API_Client refresh callback to update the Auth_Store and, on refresh failure, clear the store and redirect to `/login`
    - _Requirements: 4.5, 4.6, 4.7_

  - [x] 6.3 Implement login/register forms and logout
    - Build login and register forms with react-hook-form + Zod resolver using `loginSchema`/`registerSchema` from `@queuenow/shared-validation`; disable submit while pending; map `error.details` onto fields via `setError`; implement logout (`POST /auth/logout` → clear store → redirect to `/login`)
    - _Requirements: 4.1, 4.2, 4.8, 4.9, 4.10_

  - [x]\* 6.4 Write property test for the token-persistence invariant
    - **Property 4: Access token is never written to web storage**
    - **Validates: Requirements 4.4**
    - Location: `features/auth/__tests__/token-persistence.property.test.ts`

  - [x]\* 6.5 Write property test for backend field-error mapping
    - **Property 6: Backend field errors map onto matching form fields**
    - **Validates: Requirements 4.10**
    - Location: `features/auth/__tests__/field-errors.property.test.ts`

  - [x]\* 6.6 Write example unit tests for the authentication flow
    - Login success/failure, boot silent-refresh restore, logout clears state and redirects, submit disabled while pending
    - _Requirements: 15.2_

- [x] 7. Implement route guards, role-based UI, and the app shell
  - [x] 7.1 Implement route guards
    - Create the `_authenticated` layout route with an auth `beforeLoad` that redirects unauthenticated users to `/login`; add role `beforeLoad` checks on role-restricted routes that redirect to `/dashboard` and queue a restriction toast
    - _Requirements: 5.1, 5.4_

  - [x] 7.2 Implement the capability matrix, role hooks, and gated app shell
    - Encode the steering capability matrix once; implement `useHasRole(...roles)` and `<RoleGate roles={[...]}>`; build the app shell/navigation that hides nav items and action controls per role
    - _Requirements: 5.2, 5.3, 5.5, 5.6, 5.7_

  - [x]\* 7.3 Write property test for role-based visibility
    - **Property 7: Role-based visibility equals the capability matrix**
    - **Validates: Requirements 5.2, 5.3, 5.5, 5.6, 5.7, 10.6, 11.7**
    - Location: `features/auth/__tests__/role-matrix.property.test.ts`

  - [x]\* 7.4 Write example unit tests for route-guard behavior
    - Unauthenticated access redirects to login; unauthorized role redirects to dashboard with a toast
    - _Requirements: 15.4_

- [x] 8. Implement the staff queue-serving panel
  - [x] 8.1 Implement queue status query and counter selector
    - Create `features/queue/api/useQueueStatus` and the counter selector (ephemeral Zustand slice); render per-service waiting count, currently called tickets, and the serving ticket via `<DataRegion>`
    - _Requirements: 6.1, 6.2, 6.13_

  - [x] 8.2 Implement serving mutation hooks with optimistic updates
    - Implement `useCallNextTicket`, `useRecallTicket`, `useSkipTicket`, `useCompleteTicket`, `useRejoinTicket` with `onMutate` snapshot+patch, success invalidation, socket `queue:update` reconciliation, rollback on failure, and error-code-mapped toasts (incl. `QUEUE_NO_WAITING`, `QUEUE_MAX_RECALL`)
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_

  - [x]\* 8.3 Write property test for optimistic rollback
    - **Property 10: Failed optimistic serving actions roll back to the snapshot**
    - **Validates: Requirements 6.10, 6.11**
    - Location: `features/queue/__tests__/optimistic-rollback.property.test.ts`

  - [x]\* 8.4 Write example unit tests for queue serving actions
    - Call next (incl. empty-queue message), recall (incl. max-recall advice), skip, complete, rejoin — asserting optimistic update and reconciliation
    - _Requirements: 15.3_

- [x] 9. Implement the public Display (TV) screen
  - [x] 9.1 Implement the Display route and board
    - Create the lazy `display.$orgId` route: public read-only board reading from a public queue query and public socket subscription; render called ticket numbers with counter names, update on `queue:ticket-called`, support fullscreen/unattended operation, fall back to polling when realtime is down, and format times in the Org_Timezone
    - _Requirements: 7.1, 7.2, 7.3, 7.8, 7.9, 7.10_

  - [x] 9.2 Implement audio announcements and accessible presentation
    - Add the audio announcer (chime then Web Speech API announce, chime-only fallback), a mute control, a one-time "tap to enable sound" overlay, and large high-contrast presentation that does not rely on color alone for the called state
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 13.3_

  - [x]\* 9.3 Write example unit tests for Display audio behavior
    - Chime + TTS announce with chime fallback, mute toggle, tap-to-enable-sound overlay shown once
    - _Requirements: 15.1_

- [x] 10. Checkpoint - Phase 1 (MVP) complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement services management (Phase 2)
  - [x] 11.1 Implement the services list and mutations
    - `features/services`: `<DataRegion>`-wrapped list (name, prefix, active, sort order); create/edit/toggle forms validated with `createServiceSchema`/`updateServiceSchema`; mutation hooks invalidate `['services', orgId]` on success; error-code messages with field-error mapping
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x]\* 11.2 Write example unit tests for services create/edit/toggle flows
    - _Requirements: 8.2, 8.3, 8.4, 8.6_

- [x] 12. Implement counters management (Phase 2)
  - [x] 12.1 Implement the counters list and mutations
    - `features/counters`: `<DataRegion>`-wrapped list (name, associated service, active); create/edit/toggle forms validated with `createCounterSchema`/`updateCounterSchema`; mutation hooks invalidate `['counters', orgId]`; error-code messages
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x]\* 12.2 Write example unit tests for counters create/edit/toggle flows
    - _Requirements: 9.2, 9.3, 9.4, 9.6_

- [x] 13. Implement staff management (Phase 2)
  - [x] 13.1 Implement the paginated staff list and invite flow
    - `features/staff`: paginated list (name, email, role, invitation status) using envelope `meta`, with pagination driven from route search params; invite form validated with `inviteStaffSchema`; mutations invalidate `['staff', orgId, page]`; hide staff-management UI for the STAFF role; `<DataRegion>` states
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x]\* 13.2 Write property test for staff pagination round-trip
    - **Property 15: Staff pagination round-trips through the URL search params**
    - **Validates: Requirements 10.2**
    - Location: `features/staff/__tests__/pagination.property.test.ts`

  - [x]\* 13.3 Write example unit tests for the staff invite flow
    - _Requirements: 10.3, 10.5_

- [x] 14. Checkpoint - Phase 2 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement organization settings and branding/theming (Phase 3)
  - [x] 15.1 Implement org details, branding, and queue-settings forms
    - `features/organization`: forms validated with `updateOrganizationSchema`, `updateBrandingSchema`, `updateQueueSettingsSchema`; call `applyBranding(primaryColor)` when the organization loads; gate the organization-deletion control to OWNER via `<RoleGate>`; error-code messages with field-error mapping
    - _Requirements: 11.1, 11.2, 11.3, 11.6, 11.7, 11.8_

  - [x]\* 15.2 Write example unit tests for settings/branding update flows
    - _Requirements: 11.1, 11.2, 11.6, 11.8_

- [x] 16. Implement the public Kiosk screen (Phase 3)
  - [x] 16.1 Implement the Kiosk flow
    - Create the lazy `kiosk.$orgId` route (public): present active services; collect name/phone required fields driven by `QueueSettings` and validated with `joinQueueSchema`; on confirm call join-queue and display the ticket number plus a tracking QR code; handle `QUEUE_FULL`; reset to the start screen after an idle timeout; use touch-friendly targets
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x]\* 16.2 Write property test for kiosk required-field gating
    - **Property 17: Kiosk required-field set matches QueueSettings**
    - **Validates: Requirements 12.3**
    - Location: `features/kiosk/__tests__/required-fields.property.test.ts`

  - [x]\* 16.3 Write example unit tests for the kiosk join flow
    - Join + ticket/QR display, `QUEUE_FULL` handling, idle reset (fake timers)
    - _Requirements: 12.4, 12.5, 12.6, 12.7_

- [x] 17. Checkpoint - Phase 3 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Cross-cutting accessibility and quality gates
  - [x] 18.1 Establish keyboard/focus and ARIA baseline
    - Ensure all interactive elements are keyboard-reachable with visible focus states and that shadcn/Radix ARIA semantics are preserved in wrappers across key screens
    - _Requirements: 13.1, 13.2_

  - [x]\* 18.2 Write accessibility and code-splitting smoke tests
    - Automated `axe` checks for keyboard reachability/focus and ARIA on key screens; assert Display/Kiosk chunks are split from the dashboard entry; assert presence of `.env.example`, the `generate:api` script, and generated `schema.d.ts` usage
    - _Requirements: 13.1, 13.2, 13.3, 1.6, 1.7, 1.8, 2.7_

  - [x]\* 18.3 Add the strict-typecheck quality gate
    - Wire a `typecheck` run that fails on type errors and any use of `any`
    - _Requirements: 15.5_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP, but each property test maps one-to-one to a design property and each example test covers a required critical flow.
- Property-based tests use fast-check + Vitest, run a minimum of 100 generated cases, and carry the traceability tag `// Feature: web-app, Property N: ...`.
- All tests mock the API_Client and Socket_Client at the boundary (no real backend); the shared harness from task 2.4 keeps tests fast and deterministic.
- Each task references the specific requirements it implements; checkpoints provide incremental validation at phase boundaries.
- Phase 1 (tasks 1–9) is the first shippable slice; Phases 2 and 3 add feature modules onto the Phase 1 core.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "4.1", "4.2", "5.1", "6.1"] },
    { "id": 2, "tasks": ["1.3", "2.1", "3.1", "4.3", "4.4", "7.1", "7.2"] },
    { "id": 3, "tasks": ["2.4", "3.2", "6.2", "6.3"] },
    { "id": 4, "tasks": ["2.5", "2.6", "3.3", "3.4", "6.4", "6.5", "6.6", "7.3", "7.4", "8.1"] },
    { "id": 5, "tasks": ["8.2", "9.1"] },
    { "id": 6, "tasks": ["8.3", "8.4", "9.2"] },
    { "id": 7, "tasks": ["9.3", "11.1", "12.1", "13.1", "15.1", "16.1"] },
    { "id": 8, "tasks": ["11.2", "12.2", "13.2", "13.3", "15.2", "16.2", "16.3", "18.1"] },
    { "id": 9, "tasks": ["18.2", "18.3"] }
  ]
}
```

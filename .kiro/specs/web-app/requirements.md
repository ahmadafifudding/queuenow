# Requirements Document

## Introduction

This document specifies requirements for the QueueNow React web frontend (`apps/web`), the staff/admin and public-screen application for a multi-tenant SaaS Queue Management System. The NestJS backend API is the sole source of data; the frontend communicates with it over HTTP (REST) and WebSocket (socket.io, namespace `/queue`). All conventions are governed by the `.kiro/steering/frontend-web.md` steering file, which is authoritative for tech choices, folder structure, auth strategy, realtime handling, and UX.

The application hosts three surfaces in a single Vite-built app:

1. **Dashboard** — authenticated, for the OWNER, ADMIN, and STAFF roles.
2. **Display (TV)** — public, read-only "now serving" board at `/display/:orgId` with audio announcements.
3. **Kiosk** — public, on-site ticket-taking at `/kiosk/:orgId`, phone-based tracking (no physical printer).

Because this is a large surface, requirements are organized into delivery phases so the team can ship incrementally. **Phase 1 (MVP / first shippable slice)** covers foundation/scaffolding, authentication, the staff queue-serving panel, and the public Display screen. Later phases add services/counters/staff management, organization settings/branding, and the kiosk. Each requirement is tagged with its phase. The full feature set is captured here regardless of phase.

### Phasing Summary

- **Phase 1 (MVP):** Requirements 1, 2, 3, 4, 5, 6, 7 — project foundation, API/client layer, realtime client, authentication & session, route guards & role-based UI, staff queue-serving panel, public Display screen.
- **Phase 2:** Requirements 8, 9, 10 — services management, counters management, staff management.
- **Phase 3:** Requirements 11, 12 — organization settings & branding/theming, public Kiosk.
- **Cross-cutting (apply across all phases):** Requirements 13, 14, 15 — accessibility, internationalization readiness, testing & quality gates.

## Glossary

- **Web_App**: The `apps/web` React application as a whole, including all three surfaces.
- **API_Client**: The single typed fetch wrapper in `lib/api/client.ts` that handles base URL, credentials, the access-token header, the 401 refresh-and-retry flow, and envelope unwrapping.
- **Socket_Client**: The single socket.io-client connection (namespace `/queue`) created in `lib/socket.ts`.
- **Auth_Store**: The Zustand store holding the in-memory access token, the authenticated user, and the active organization/role.
- **Route_Guard**: The auth/role check performed in a TanStack Router `beforeLoad` for protected routes.
- **Dashboard**: The authenticated surface for OWNER/ADMIN/STAFF users.
- **Staff_Panel**: The queue-serving UI within the Dashboard used to call, recall, skip, and complete tickets.
- **Display_Screen**: The public read-only "now serving" board at `/display/:orgId`.
- **Kiosk_Screen**: The public ticket-taking flow at `/kiosk/:orgId`.
- **Env_Validator**: The Zod-based environment validation in `lib/env.ts` that runs on boot.
- **Role**: One of `OWNER`, `ADMIN`, `STAFF` (from `UserRoleType`), taken from the login/refresh response `organization.role`.
- **Ticket**: A queue ticket with lifecycle status `WAITING -> CALLED -> SERVING -> COMPLETED/SKIPPED` (from `TicketStatus`).
- **API_Envelope**: The standard backend response shape `{ success, data, meta }` for success and `{ success, error }` for failure.
- **Org_Timezone**: The `Organization.timezone` value used to format all displayed times.
- **Branding**: The per-organization `OrganizationBranding` values (logo, `primaryColor`, QR text).
- **Queue_Settings**: The per-organization `QueueSettings` (e.g. `requireName`, `requirePhone`, `maxRecall`).

---

## Requirements

### Requirement 1: Project Foundation and Environment Configuration (Phase 1)

**User Story:** As a frontend developer, I want a scaffolded `apps/web` project with validated configuration, so that I can build features on a consistent, fail-fast foundation.

#### Acceptance Criteria

1. THE Web_App SHALL be built with React 19, TypeScript in strict mode, Vite, TanStack Router (file-based), TanStack Query, Zustand, Tailwind CSS, and shadcn/ui.
2. THE Web_App SHALL organize source code under the feature-based folder structure defined in the frontend-web steering file (`routes/`, `features/`, `components/ui/`, `lib/`, `hooks/`, `types/`).
3. WHEN the Web_App boots, THE Env_Validator SHALL validate that `VITE_API_URL` and `VITE_WS_URL` are present and well-formed.
4. IF a required environment variable is missing or malformed, THEN THE Env_Validator SHALL halt startup and display an error message naming the missing variable.
5. THE Web_App SHALL read all environment values through the validated `env` object and SHALL access configuration only via `import.meta.env`.
6. THE Web_App SHALL provide an `apps/web/.env.example` file listing every required environment variable.
7. THE Web_App SHALL provide a `generate:api` script that produces `lib/api/schema.d.ts` from the backend Swagger document using `openapi-typescript`.
8. THE Web_App SHALL code-split routes so that Display and Kiosk code is lazy-loaded and excluded from the Dashboard's initial bundle.

### Requirement 2: API Client Layer (Phase 1)

**User Story:** As a frontend developer, I want a single typed API client that unwraps the standard response envelope, so that feature hooks receive domain data directly and errors are handled consistently.

#### Acceptance Criteria

1. THE API_Client SHALL be the single entry point for all REST interaction, and feature code SHALL access the backend only through TanStack Query hooks colocated in each feature's `api/` folder.
2. THE API_Client SHALL send every request with `credentials: 'include'` so the refresh cookie is transmitted.
3. WHEN an authenticated request is made, THE API_Client SHALL attach the in-memory access token from the Auth_Store as the authorization header.
4. WHEN the backend returns a successful API_Envelope, THE API_Client SHALL unwrap the response and return the `data` field to the caller.
5. WHEN the backend returns a paginated API_Envelope, THE API_Client SHALL expose the `meta` page, limit, and total values to the caller.
6. IF the backend returns an error API_Envelope, THEN THE API_Client SHALL surface the `error.code` so callers can map it to a user-facing message.
7. THE Web_App SHALL derive REST request and response types from the generated `lib/api/schema.d.ts` and SHALL use `@queuenow/shared-types` for shared domain enums and interfaces.

### Requirement 3: Realtime WebSocket Client (Phase 1)

**User Story:** As a user of any surface, I want the screen to update live as queue events occur, so that the displayed state stays consistent with the backend without manual refresh.

#### Acceptance Criteria

1. THE Socket_Client SHALL maintain one connection per app session on the `/queue` namespace.
2. WHERE the surface is the Dashboard, THE Socket_Client SHALL include the in-memory access token in the connection handshake `auth` payload.
3. WHEN the access token is refreshed, THE Socket_Client SHALL reconnect using the new token.
4. WHERE the surface is the Display_Screen or Kiosk_Screen, THE Socket_Client SHALL connect without a token and SHALL subscribe only to public `orgId` rooms.
5. WHEN a subscribing component mounts, THE Socket_Client SHALL emit the `subscribe` event for the relevant `orgId` (and optionally `serviceId`) using the event names from `@queuenow/shared-constants`.
6. WHEN a `queue:update` or `queue:ticket-called` event is received, THE Web_App SHALL invalidate or patch the matching TanStack Query keys rather than maintaining a separate queue-state store.
7. WHEN the Socket_Client reconnects after a disconnection, THE Socket_Client SHALL re-subscribe to its previously subscribed rooms.
8. WHILE the Socket_Client is disconnected beyond 15 seconds, THE Web_App SHALL poll queue status over REST every 10 seconds until the connection is restored.
9. WHEN the Socket_Client reconnects, THE Web_App SHALL stop the REST polling fallback.
10. WHEN a subscribing component unmounts, THE Socket_Client SHALL emit `unsubscribe` for its rooms and remove its event listeners.
11. WHILE the Socket_Client is reconnecting, THE Web_App SHALL display a non-blocking reconnecting indicator.

### Requirement 4: Authentication and Session Management (Phase 1)

**User Story:** As a staff member, I want to log in and stay signed in across reloads, so that I can access the Dashboard without re-entering credentials unnecessarily.

#### Acceptance Criteria

1. THE Web_App SHALL provide a login form validated with the `loginSchema` from `@queuenow/shared-validation` via TanStack Form's Standard Schema validator.
2. THE Web_App SHALL provide a registration form validated with the `registerSchema` from `@queuenow/shared-validation`.
3. WHEN login succeeds, THE Auth_Store SHALL store the access token in memory together with the authenticated user and the organization role from the response.
4. THE Web_App SHALL store the access token only in the Auth_Store memory and SHALL keep it out of `localStorage`, `sessionStorage`, and non-httpOnly cookies.
5. WHEN the Web_App boots, THE API_Client SHALL attempt a single silent refresh against `POST /auth/refresh` to restore the session from the httpOnly refresh cookie.
6. WHEN an API request returns `401`, THE API_Client SHALL attempt one silent refresh, update the access token, and retry the original request once.
7. IF the silent refresh fails, THEN THE Web_App SHALL clear the Auth_Store and redirect the user to the login route.
8. WHEN the user logs out, THE Web_App SHALL call `POST /auth/logout`, clear the Auth_Store, and redirect to the login route.
9. WHEN a form submission is pending, THE Web_App SHALL disable the submit control until the request resolves.
10. IF the backend returns field-level error details, THEN THE Web_App SHALL map those details onto the corresponding form fields.

### Requirement 5: Route Guards and Role-Based UI (Phase 1)

**User Story:** As an organization, I want the Dashboard to show each role only the actions it is permitted to perform, so that the interface matches each user's capabilities.

#### Acceptance Criteria

1. WHEN an unauthenticated user requests a route under the `_authenticated` layout, THE Route_Guard SHALL redirect to the login route in `beforeLoad`.
2. THE Web_App SHALL provide a `useHasRole(...roles)` hook and a `<RoleGate roles={[...]}>` component for conditional rendering.
3. WHERE the user's Role lacks a capability defined in the steering capability matrix, THE Web_App SHALL hide the corresponding navigation items and action controls.
4. WHEN a user whose Role is not permitted requests a role-restricted route, THE Route_Guard SHALL redirect to the dashboard route and display a toast explaining the restriction.
5. THE Web_App SHALL render the queue-serving capability for the OWNER, ADMIN, and STAFF roles.
6. THE Web_App SHALL restrict services, counters, staff management, and organization settings UI to the OWNER and ADMIN roles.
7. THE Web_App SHALL restrict billing and organization-deletion UI to the OWNER role.

### Requirement 6: Staff Queue-Serving Panel (Phase 1)

**User Story:** As a staff member, I want to call the next customer, recall, skip, and complete tickets from a counter, so that I can serve the queue efficiently.

#### Acceptance Criteria

1. THE Staff_Panel SHALL display the current queue state per service, including the waiting count, currently called tickets, and the ticket the staff member is serving.
2. THE Staff_Panel SHALL allow the staff member to select an active counter before performing serving actions.
3. WHEN the staff member triggers "call next" for a selected counter, THE Web_App SHALL call the call-next endpoint with the counter identifier and reflect the newly CALLED ticket.
4. IF no customers are waiting when "call next" is triggered, THEN THE Web_App SHALL display a message indicating the queue is empty.
5. WHEN the staff member triggers "recall" on a CALLED ticket, THE Web_App SHALL call the recall endpoint and reflect the updated recall count.
6. IF the recall request is rejected because the maximum recall limit is reached, THEN THE Web_App SHALL display a message advising the staff member to skip the ticket.
7. WHEN the staff member triggers "skip" on a CALLED ticket, THE Web_App SHALL call the skip endpoint and remove the ticket from the active serving list.
8. WHEN the staff member triggers "complete" on a CALLED or SERVING ticket, THE Web_App SHALL call the complete endpoint and mark the ticket COMPLETED.
9. WHEN the staff member triggers "rejoin" on a SKIPPED ticket, THE Web_App SHALL call the rejoin endpoint and return the ticket to the WAITING list.
10. WHEN the staff member performs a call-next, recall, skip, or complete action, THE Staff_Panel SHALL apply an optimistic update and SHALL reconcile with the server response or the incoming socket event.
11. IF a serving action fails, THEN THE Staff_Panel SHALL roll back the optimistic update and display an error message mapped from the error code.
12. WHEN a `queue:update` event for the active service is received, THE Staff_Panel SHALL update the displayed queue state.
13. THE Staff_Panel SHALL provide explicit loading, empty, and error states for the queue data region.

### Requirement 7: Public Display (TV) Screen (Phase 1)

**User Story:** As a walk-in customer, I want to watch a "now serving" board, so that I know when my ticket number is called and which counter to go to.

#### Acceptance Criteria

1. THE Display_Screen SHALL render at `/display/:orgId` without requiring authentication and SHALL perform no mutating actions.
2. THE Display_Screen SHALL show the currently called ticket numbers with their counter names for the organization.
3. WHEN a `queue:ticket-called` event arrives, THE Display_Screen SHALL update the board to show the called ticket number and counter name.
4. WHEN a `queue:ticket-called` event arrives, THE Display_Screen SHALL play an audio chime and announce the ticket number and counter using text-to-speech, falling back to the chime when speech is unavailable.
5. THE Display_Screen SHALL provide a mute control for the audio announcements.
6. WHEN the Display_Screen first loads, THE Display_Screen SHALL show a one-time "tap to enable sound" overlay to satisfy the browser audio-unlock gesture requirement.
7. THE Display_Screen SHALL present ticket information with large typography and high contrast, and SHALL not rely on color alone to convey the called state.
8. THE Display_Screen SHALL support fullscreen presentation and SHALL operate unattended after initial setup.
9. WHILE the realtime connection is unavailable, THE Display_Screen SHALL fall back to REST polling of queue status so the board continues to update.
10. THE Display_Screen SHALL format all displayed times in the Org_Timezone.

### Requirement 8: Services Management (Phase 2)

**User Story:** As an admin, I want to create, edit, activate, and order services, so that customers can join the correct queue.

#### Acceptance Criteria

1. THE Web_App SHALL display a list of the organization's services with name, prefix, active state, and sort order.
2. WHEN an authorized user creates a service, THE Web_App SHALL validate the input with the `createServiceSchema` from `@queuenow/shared-validation` and call the create-service endpoint.
3. WHEN an authorized user edits a service, THE Web_App SHALL validate the input with the `updateServiceSchema` and call the update-service endpoint.
4. WHEN an authorized user toggles a service active state, THE Web_App SHALL call the update-service endpoint and reflect the new state.
5. WHEN a service mutation succeeds, THE Web_App SHALL invalidate the services query keys so the list reflects current data.
6. IF a service mutation fails, THEN THE Web_App SHALL display an error message mapped from the error code and SHALL map field errors onto the form.
7. THE Web_App SHALL provide explicit loading, empty, and error states for the services list.

### Requirement 9: Counters Management (Phase 2)

**User Story:** As an admin, I want to manage counters and associate them with services, so that staff can serve from defined positions.

#### Acceptance Criteria

1. THE Web_App SHALL display a list of the organization's counters with name, associated service, and active state.
2. WHEN an authorized user creates a counter, THE Web_App SHALL validate the input with the `createCounterSchema` from `@queuenow/shared-validation` and call the create-counter endpoint.
3. WHEN an authorized user edits a counter, THE Web_App SHALL validate the input with the `updateCounterSchema` and call the update-counter endpoint.
4. WHEN an authorized user toggles a counter active state, THE Web_App SHALL call the update-counter endpoint and reflect the new state.
5. WHEN a counter mutation succeeds, THE Web_App SHALL invalidate the counters query keys.
6. IF a counter mutation fails, THEN THE Web_App SHALL display an error message mapped from the error code.
7. THE Web_App SHALL provide explicit loading, empty, and error states for the counters list.

### Requirement 10: Staff Management (Phase 2)

**User Story:** As an admin, I want to invite and manage staff members and their roles, so that the right people can serve the queue.

#### Acceptance Criteria

1. THE Web_App SHALL display a paginated list of staff members with name, email, role, and invitation status, using the API_Envelope `meta` for pagination.
2. THE Web_App SHALL drive list pagination from the route search parameters so the current page is shareable and back-button friendly.
3. WHEN an authorized user invites a staff member, THE Web_App SHALL validate the input with the `inviteStaffSchema` from `@queuenow/shared-validation` and call the invite-staff endpoint.
4. WHEN a staff mutation succeeds, THE Web_App SHALL invalidate the staff query keys.
5. IF a staff mutation fails, THEN THE Web_App SHALL display an error message mapped from the error code.
6. WHERE the active Role is STAFF, THE Web_App SHALL hide the staff-management UI.
7. THE Web_App SHALL provide explicit loading, empty, and error states for the staff list.

### Requirement 11: Organization Settings and Branding/Theming (Phase 3)

**User Story:** As an owner or admin, I want to update organization details and branding, so that the screens reflect my organization's identity.

#### Acceptance Criteria

1. WHEN an authorized user updates organization details, THE Web_App SHALL validate the input with the `updateOrganizationSchema` and call the update-organization endpoint.
2. WHEN an authorized user updates branding, THE Web_App SHALL validate the input with the `updateBrandingSchema` and call the update-branding endpoint.
3. WHEN the organization loads, THE Web_App SHALL inject the Branding `primaryColor` as a CSS custom property consumed by Tailwind and shadcn theming.
4. THE Web_App SHALL read the brand color from the injected CSS variable and SHALL not hardcode the brand color in components.
5. THE Web_App SHALL support light and dark themes using the Tailwind `class` strategy.
6. WHEN an authorized user updates queue settings, THE Web_App SHALL validate the input with the `updateQueueSettingsSchema` and call the queue-settings endpoint.
7. WHERE the active Role is OWNER, THE Web_App SHALL display the organization-deletion control.
8. IF an organization or branding mutation fails, THEN THE Web_App SHALL display an error message mapped from the error code and SHALL map field errors onto the form.

### Requirement 12: Public Kiosk Screen (Phase 3)

**User Story:** As an on-site customer, I want to take a ticket from a kiosk, so that I join the queue and can track my position on my phone.

#### Acceptance Criteria

1. THE Kiosk_Screen SHALL render at `/kiosk/:orgId` without requiring authentication.
2. THE Kiosk_Screen SHALL present the organization's active services for the customer to choose from.
3. WHERE the Queue_Settings require a name or phone, THE Kiosk_Screen SHALL collect the required fields and validate them with the `joinQueueSchema` from `@queuenow/shared-validation`.
4. WHEN the customer confirms the selection, THE Kiosk_Screen SHALL call the join-queue endpoint and display the assigned ticket number.
5. WHEN a ticket is issued, THE Kiosk_Screen SHALL display a QR code linking to the phone-based tracking page for that ticket.
6. IF the join-queue request is rejected because the daily queue is full, THEN THE Kiosk_Screen SHALL display a message indicating the queue is full.
7. WHEN the Kiosk_Screen has been idle past a configured timeout, THE Kiosk_Screen SHALL reset to the service-selection start screen.
8. THE Kiosk_Screen SHALL present touch-friendly interactive targets.

### Requirement 13: Accessibility (Cross-cutting)

**User Story:** As a user relying on assistive technology, I want the interface to be operable and perceivable, so that I can use the application effectively.

#### Acceptance Criteria

1. THE Web_App SHALL make all interactive elements reachable by keyboard and SHALL render visible focus states.
2. THE Web_App SHALL preserve the ARIA semantics provided by shadcn/Radix primitives when wrapping them.
3. THE Display_Screen SHALL convey the "now serving" state using more than color alone.

### Requirement 14: Internationalization Readiness (Cross-cutting)

**User Story:** As a product owner, I want copy kept translatable, so that a second language can be added later without refactoring.

#### Acceptance Criteria

1. THE Web_App SHALL default the user interface language to English.
2. THE Web_App SHALL centralize user-facing strings so additional languages can be added without restructuring components.
3. THE Web_App SHALL format displayed dates and times in the Org_Timezone and SHALL send dates to the backend as ISO strings.

### Requirement 15: Testing and Quality Gates (Cross-cutting)

**User Story:** As a maintainer, I want automated tests for critical flows, so that regressions are caught before release.

#### Acceptance Criteria

1. THE Web_App SHALL use Vitest and React Testing Library and SHALL mock the API_Client and Socket_Client at the boundary in unit tests.
2. THE Web_App SHALL include tests covering the authentication flow.
3. THE Web_App SHALL include tests covering the queue serving actions (call next, recall, skip, complete).
4. THE Web_App SHALL include tests covering the Route_Guard behavior for unauthenticated and unauthorized access.
5. THE Web_App SHALL pass TypeScript strict-mode type checking with no use of the `any` type.

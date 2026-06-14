# Requirements Document

## Introduction

QueueNow uses a **flat organization model**: every branch or location is a
separate `Organization`, and a single `User` may be a member of many
organizations at once. Membership is modeled by the Prisma `UserRole` record,
which is unique per `(userId, orgId)`, so a user holds exactly one role per
organization and can hold different roles across different organizations
(for example `OWNER` of one org and `STAFF` of another).

This feature adds **organization switching** so multi-org membership is actually
usable. Today there is a latent **single-org lock** bug: `auth.service.ts`
`login()` and `refreshToken()` both hardcode `primaryRole = user.roles[0]` and
bake a single `orgId` + `role` into the JWT. A user invited to a second
organization is silently locked to `roles[0]` and can never reach the others,
and there is no endpoint to change the active organization. This spec defines:

1. A backend endpoint to **list** the organizations the current user belongs to.
2. A backend endpoint to **switch** the active organization, re-issuing tokens
   scoped to the chosen org and role without re-entering the password.
3. **Refresh consistency** so the selected organization persists across token
   refresh instead of reverting to `roles[0]` (the core bug fix).
4. A **deterministic default organization** at login.
5. A **frontend org-switcher** in the authenticated AppShell.
6. **Security/isolation** guarantees and **error paths** that reuse the existing
   `ERROR_CODES`.

This feature preserves the existing authentication model: the access token lives
only in memory (web Zustand store), the refresh token lives in an httpOnly,
`SameSite=Lax` cookie scoped to the `/api/v1/auth` path, and all responses use
the standard `{ success, data, meta }` / error envelope. Customer-facing Display
and Kiosk surfaces, billing, and plan logic are untouched.

### Out of Scope (Backlog)

- **Branch hierarchy.** The flat model (one Organization per branch) plus a
  switcher is the chosen design. A nested parent/child branch hierarchy is
  explicitly out of scope and remains a backlog item.
- **Bahasa Melayu (MS) localization for the Display / Kiosk surfaces.** Deferred
  to the backlog; this feature does not add or change customer-facing
  localization.
- Inviting users to organizations, creating organizations, and billing/plan
  changes are existing or separate concerns and are not modified here.

## Glossary

- **User**: An authenticated staff/admin/owner account (`User` model), identified
  by `userId` (`User.id`). The same User may belong to multiple Organizations.
- **Organization**: A single branch or location (`Organization` model) identified
  by `orgId` (`Organization.id`), with `name`, `slug`, `isActive`, and a `plan`.
- **Membership**: A `UserRole` record linking one User to one Organization with a
  single `role` (`UserRoleType`: `OWNER`, `ADMIN`, or `STAFF`). Unique per
  `(userId, orgId)`. "Membership" and `UserRole` are used interchangeably.
- **Role**: The User's `UserRoleType` within a specific Organization. A User's
  role can differ from one Organization to another.
- **Active_Organization**: The Organization the User's current tokens are scoped
  to — the `orgId` (and matching `role`) encoded in the issued JWT payload
  `{ sub, orgId, role, type: 'staff' }`.
- **Access_Token**: Short-lived JWT (15 min) returned in the JSON response body
  and held only in web memory. Encodes `sub` (userId), `orgId`, `role`, `type`.
- **Refresh_Token**: Long-lived JWT (7 days) returned ONLY as an httpOnly cookie
  (`refresh_token`, path `/api/v1/auth`) and persisted as a **Session** row.
- **Session**: A `Session` record (`refreshToken` unique + `expiresAt`) that backs
  a Refresh_Token. Refreshing rotates the Session (old row deleted, new created).
- **AppShell**: The authenticated web layout (the `_authenticated` route group)
  that hosts the dashboard navigation and the Org_Switcher.
- **Org_Switcher**: The frontend control in the AppShell that lists the User's
  Organizations, shows the Active_Organization, and triggers a switch.
- **Auth_API**: The NestJS authentication module exposing the `/api/v1/auth`
  endpoints (`AuthController` + `AuthService`).
- **Web_App**: The React staff/admin application in `apps/web`.

## Requirements

### Requirement 1: List the current user's organization memberships

**User Story:** As a multi-org user, I want to retrieve every organization I
belong to with my role in each, so that I can see and choose where to work.

#### Acceptance Criteria

1. WHEN an authenticated request is received at `GET /api/v1/auth/organizations`, THE Auth_API SHALL return the list of all Organizations in which the requesting User has a Membership.
2. WHEN the Auth_API returns the organization list, THE Auth_API SHALL include for each entry the Organization `id`, `name`, `slug`, `isActive`, and the User's `role` in that Organization.
3. THE Auth_API SHALL include in the list Organizations whose `isActive` is false, distinguished solely by the `isActive` field, so the client can surface the inactive state.
4. WHEN the Auth_API returns the organization list, THE Auth_API SHALL order entries by Membership `createdAt` ascending, tie-broken by `orgId` in ascending Unicode code-point order, matching the default-organization rule (Requirement 4).
5. WHEN the Auth_API returns the organization list, THE Auth_API SHALL mark as the Active_Organization the single entry whose `id` equals the `orgId` claim of the presented Access_Token, and SHALL mark none active when no entry matches.
6. WHEN the Auth_API returns the organization list, THE Auth_API SHALL wrap the list in the standard `{ success: true, data, meta }` response envelope.
7. WHEN the requesting User has exactly one Membership, THE Auth_API SHALL return a list containing exactly that one Organization entry.
8. IF the requesting User has zero Memberships, THEN THE Auth_API SHALL return a success response with an empty list and no entry marked active.
9. IF the request to `GET /api/v1/auth/organizations` carries no valid Access_Token, THEN THE Auth_API SHALL reject the request with error code `AUTH_UNAUTHORIZED` and SHALL NOT return any list.
10. THE Auth_API SHALL exclude from the returned list any Organization in which the requesting User has no Membership.

### Requirement 2: Switch the active organization

**User Story:** As a multi-org user, I want to switch my active organization
without logging in again, so that I can work in another branch using my role
there.

#### Acceptance Criteria

1. WHEN an authenticated request is received at `POST /api/v1/auth/switch-organization` with a target `orgId` that matches an active Membership of the requesting User, THE Auth_API SHALL issue a new Access_Token and a new Refresh_Token scoped to the target `orgId` and the User's `role` in that Organization.
2. WHEN the Auth_API completes a successful switch, THE Auth_API SHALL return the same response shape as login: a `user` object, an `organization` object containing `id`, `name`, `slug`, and `role`, and `tokens` containing the Access_Token.
3. WHEN the Auth_API issues new tokens during a switch, THE Auth_API SHALL set the new Refresh_Token as the httpOnly, `Secure` (outside development), `SameSite=Lax` `refresh_token` cookie scoped to the `/api/v1/auth` path and SHALL omit the Refresh_Token from the JSON response body.
4. WHEN the Auth_API issues new tokens during a switch, THE Auth_API SHALL create a new Session for the new Refresh_Token, consistent with the existing login and refresh token-issuance flow.
5. WHEN the Auth_API completes a switch, THE Auth_API SHALL delete the Session backing the Refresh_Token presented with the switch request, so no Session scoped to the previously Active_Organization remains valid.
6. THE Auth_API SHALL complete a switch without requiring the User to re-enter a password.
7. IF the target `orgId` refers to an Organization in which the requesting User has no Membership, THEN THE Auth_API SHALL reject the request with error code `AUTH_FORBIDDEN` and SHALL NOT issue new tokens.
8. IF the target `orgId` refers to an Organization that does not exist, THEN THE Auth_API SHALL reject the request with error code `AUTH_FORBIDDEN` (not distinguishing a non-existent Organization from one the User is not a member of, to prevent organization enumeration) and SHALL NOT issue new tokens.
9. WHERE the requesting User has a Membership in the target Organization but that Organization's `isActive` is false, THE Auth_API SHALL reject the request with error code `ORG_INACTIVE` and SHALL NOT issue new tokens.
10. WHEN an authenticated request targets the already-Active_Organization, THE Auth_API SHALL treat it as a successful switch, issuing fresh tokens and rotating the Session as in any other successful switch.
11. IF the request to `POST /api/v1/auth/switch-organization` carries no valid Access_Token, THEN THE Auth_API SHALL reject the request with error code `AUTH_UNAUTHORIZED`.
12. IF the request body omits the target `orgId` or provides a value that is not a valid identifier, THEN THE Auth_API SHALL reject the request with a validation error and SHALL NOT issue new tokens.
13. WHEN the Auth_API issues a new Access_Token during a switch, THE Auth_API SHALL encode the target `orgId` and the User's role in that Organization into the token payload `{ sub, orgId, role, type: 'staff' }`.

### Requirement 3: Selected organization persists across token refresh

**User Story:** As a multi-org user who has switched organizations, I want a token
refresh to keep me in my selected organization, so that reloading the app or
silently refreshing does not throw me back to a different organization.

#### Acceptance Criteria

1. WHEN a token refresh is performed at `POST /api/v1/auth/refresh`, THE Auth_API SHALL read the Active_Organization `orgId` from the `orgId` claim encoded in the presented Refresh_Token JWT payload `{ sub, orgId, role, type: 'staff' }`, and SHALL NOT derive the Active_Organization from the User's first Membership nor from the Session row (which persists only `refreshToken`, `expiresAt`, and `userId`).
2. WHILE a User's Active_Organization is an Organization other than their default Membership, WHEN that User performs a token refresh, THE Auth_API SHALL issue new tokens whose `orgId` equals the `orgId` claim of the presented Refresh_Token.
3. WHEN the Auth_API performs a refresh, THE Auth_API SHALL re-validate that the User still has a Membership in the `orgId` claim of the presented Refresh_Token, and SHALL set the issued tokens' `role` to the User's current `role` in that Membership, even when that role differs from the `role` claim carried by the presented Refresh_Token.
4. IF, at refresh time, the User no longer has a Membership in the `orgId` claim of the presented Refresh_Token, THEN THE Auth_API SHALL reject the refresh with error code `AUTH_FORBIDDEN` and SHALL NOT issue new tokens.
5. WHEN the Auth_API performs a successful refresh, THE Auth_API SHALL return, within the standard `{ success: true, data, meta }` envelope, the `organization` object (`id`, `name`, `slug`, `role`) corresponding to the preserved Active_Organization, matching the response shape of login and switch.
6. FOR ALL sequences of switch-then-refresh operations, the `orgId` returned by the refresh SHALL equal the `orgId` established by the most recent successful switch (round-trip consistency).
7. WHEN the Auth_API issues new tokens during a successful refresh, THE Auth_API SHALL set the new Refresh_Token as the httpOnly `refresh_token` cookie scoped to the `/api/v1/auth` path, SHALL omit the Refresh_Token from the JSON response body, and SHALL rotate the Session by deleting the prior Session row and creating a new one, consistent with the existing login and switch token-issuance flow.
8. IF the request to `POST /api/v1/auth/refresh` carries no Refresh_Token, or carries a Refresh_Token that is expired or has no matching Session row, THEN THE Auth_API SHALL reject the request with error code `AUTH_UNAUTHORIZED` and SHALL NOT issue new tokens.
9. WHERE the User retains a Membership in the `orgId` claim of the presented Refresh_Token but that Organization's `isActive` is false, THE Auth_API SHALL reject the refresh with error code `ORG_INACTIVE` and SHALL NOT issue new tokens.

### Requirement 4: Deterministic default organization at login

**User Story:** As a multi-org user, I want a predictable organization selected
when I log in, so that login behavior is consistent and testable.

#### Acceptance Criteria

1. WHEN a User with multiple eligible Memberships logs in at `POST /api/v1/auth/login`, THE Auth_API SHALL select as the Active_Organization the eligible Membership with the earliest `Membership.createdAt` timestamp.
2. WHERE two or more eligible Memberships share the same earliest `Membership.createdAt` timestamp (equal to the millisecond), THE Auth_API SHALL select the Membership whose `orgId` sorts first in ascending Unicode code-point order, so that the default is deterministic.
3. WHEN a User with exactly one eligible Membership logs in, THE Auth_API SHALL select that single Membership as the Active_Organization.
4. WHEN selecting the Active_Organization at login, THE Auth_API SHALL consider only eligible Memberships, where an eligible Membership is one whose associated Organization has `isActive` equal to true, and SHALL exclude any Membership belonging to an Organization with `isActive` equal to false.
5. WHEN login selects the Active_Organization, THE Auth_API SHALL encode the corresponding `orgId` and `role` into the issued tokens and SHALL return the matching `organization` object (`id`, `name`, `slug`, `role`).
6. IF a User has zero eligible Memberships when attempting to log in (the User has no Memberships, or every Membership belongs to an Organization with `isActive` equal to false), THEN THE Auth_API SHALL reject the login with error code `AUTH_FORBIDDEN`, SHALL NOT issue any access or refresh tokens, and SHALL return an error response indicating that no active organization is assigned to the User.

### Requirement 5: Frontend organization switcher in the AppShell

**User Story:** As a multi-org user, I want an organization switcher in the app,
so that I can change my active organization and immediately see that
organization's data.

#### Acceptance Criteria

1. WHEN the AppShell renders for an authenticated User, THE Web_App SHALL display an Org_Switcher listing the User's Organizations retrieved from `GET /api/v1/auth/organizations`.
2. IF retrieving the User's Organizations fails, THEN THE Web_App SHALL leave the previously Active_Organization unchanged and SHALL surface the failure without switching.
3. WHEN the Org_Switcher is displayed, THE Web_App SHALL render a persistent visual selected-state marker on exactly the one list entry that is the current Active_Organization.
4. WHEN the User selects an Organization in the Org_Switcher that is NOT the current Active_Organization, THE Web_App SHALL call `POST /api/v1/auth/switch-organization` with the selected `orgId`.
5. WHEN the User selects the already-Active_Organization in the Org_Switcher, THE Web_App SHALL perform no network call and leave state unchanged.
6. WHILE a switch request is in flight, THE Web_App SHALL show a pending state on the Org_Switcher and SHALL ignore further selections until it resolves.
7. WHEN the switch request succeeds, THE Web_App SHALL replace the in-memory Access_Token with the newly issued Access_Token.
8. WHEN the switch request succeeds, THE Web_App SHALL update the auth store's `organization` (`id`, `name`, `slug`, `role`) from the response so the AppShell header and role-gated UI reflect the new Organization and the User's role in it.
9. WHEN the in-memory Access_Token changes after a switch, THE Web_App SHALL reconnect the realtime socket using the new Access_Token.
10. WHEN the switch request succeeds, THE Web_App SHALL invalidate all org-scoped TanStack Query caches so that no data from the previous Organization remains displayed.
11. WHERE the User has exactly one Membership, THE Web_App SHALL hide or disable the Org_Switcher control.
12. IF the switch request fails, THEN THE Web_App SHALL keep the previous Active_Organization, Access_Token, and query caches unchanged and SHALL display an error message derived from the response `error.code`.

### Requirement 6: Security and tenant isolation on switch

**User Story:** As the platform operator, I want switching to be authorized on the
backend for every request, so that a user can never reach an organization they do
not belong to.

#### Acceptance Criteria

1. WHEN the Auth_API processes a switch request, THE Auth_API SHALL verify the requesting User has an active Membership in the target Organization before generating or returning any Access_Token or Refresh_Token.
2. IF a switch is attempted to an Organization the User is not a member of, THEN THE Auth_API SHALL deny the switch, SHALL NOT grant any access to that Organization, and SHALL leave the User's current Active_Organization and existing tokens unchanged.
3. WHEN tokens are issued for the Active_Organization, THE Auth_API SHALL set the token `orgId` and `role` claims from the User's Membership in that Organization, where `role` may differ from the role in the previously Active_Organization.
4. WHEN any subsequent authenticated request is processed, THE Auth_API SHALL authorize it using only the `orgId` and `role` encoded in the presented Access_Token, and SHALL NOT trust any organization identifier supplied by the client elsewhere in the request.
5. IF an Access_Token is presented whose `orgId` the User no longer has a Membership in, THEN THE Auth_API SHALL reject the request with error code `AUTH_FORBIDDEN`.
6. THE Web_App SHALL treat hiding or disabling the Org_Switcher as a usability measure only, SHALL perform no client-side organization authorization, and SHALL rely on the Auth_API as the sole authorization boundary for organization access.

### Requirement 7: Authorization and error handling

**User Story:** As an API consumer, I want consistent, well-coded errors from the
organization endpoints, so that clients can handle failures predictably.

#### Acceptance Criteria

1. WHEN the Auth_API evaluates a switch request, THE Auth_API SHALL apply checks in the order authentication → membership → organization active status, returning on the first failure.
2. IF an unauthenticated request is made to `GET /api/v1/auth/organizations` or `POST /api/v1/auth/switch-organization`, THEN THE Auth_API SHALL respond with error code `AUTH_UNAUTHORIZED`.
3. IF a switch targets an Organization the User does not belong to OR an Organization that does not exist, THEN THE Auth_API SHALL respond with error code `AUTH_FORBIDDEN`, deliberately NOT distinguishing the two cases so a non-member cannot enumerate which organizations exist.
4. WHERE the target Organization exists and the User is a member but the Organization `isActive` is false, THE Auth_API SHALL reject the switch with error code `ORG_INACTIVE` and SHALL leave the current Active_Organization unchanged.
5. WHEN the Auth_API returns any error from these endpoints, THE Auth_API SHALL use the standard error envelope `{ success: false, error: { code, message, details } }` and SHALL NOT include internal exception details or stack traces in `details`.
6. THE Auth_API SHALL reuse the existing `ERROR_CODES` values (`AUTH_UNAUTHORIZED`, `AUTH_FORBIDDEN`, `ORG_INACTIVE`, and `VALIDATION_ERROR` for malformed bodies) and SHALL NOT introduce a new error code, since the existing codes fully cover the failure cases for this feature.

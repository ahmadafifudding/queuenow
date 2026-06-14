# Backlog: Plans/Billing & Organization Switching

> **Status: NOT scheduled.** This is a lightweight backlog note, not an active
> spec. It captures decisions and known gaps while context is fresh so we can
> plan properly when the time comes. Do **not** start building from this file —
> promote the relevant section into a real spec (requirements → design → tasks)
> when prioritized.

_Last updated: 2026-06-14_

---

## 1. Decision

- **Defer billing/payment integration** (Stripe, invoices, dunning, upgrade flow)
  until there is validated demand / intent to charge. Building it now is
  premature and slows delivery.
- Plan **tiers and limits are already defined** in
  `packages/shared-constants/src/index.ts` (`PLAN_LIMITS`) and
  `packages/shared-types` (`PlanType`: `FREE | BASIC | PRO | ENTERPRISE`). New
  orgs default to `FREE`.

### Defined plan limits (already in code, for reference)

| Plan       | maxServices | maxCounters | maxQueuePerDay | maxStaff | tvDisplay | analytics |
| ---------- | :---------: | :---------: | :------------: | :------: | :-------: | :-------: |
| FREE       |      1      |      1      |       30       |    2     |    no     |    no     |
| BASIC      |      3      |      3      |    ∞ (null)    |    5     |    yes    |    no     |
| PRO        |  ∞ (null)   |  ∞ (null)   |    ∞ (null)    | ∞ (null) |    yes    |    yes    |
| ENTERPRISE |  ∞ (null)   |  ∞ (null)   |    ∞ (null)    | ∞ (null) |    yes    |    yes    |

---

## 2. Known gaps (current behavior)

- **Limits are not enforced anywhere.** A `FREE` org can currently create
  unlimited services/counters/staff and use the TV Display — `PLAN_LIMITS` is a
  constant that nothing reads. (Observed: a `FREE` org created 4 services with
  no error; the Display board is freely accessible despite `FREE.tvDisplay =
false`.)
- **No plan/usage UI.** Settings does not show the current plan, usage vs. limit,
  or an upgrade path.
- **No upgrade / billing flow.** No pricing page, no plan management, no payment.
- **RBAC placeholder only.** A "Billing / plan" capability is gated to OWNER in
  the steering capability matrix (Requirement 5.7), but there is no billing
  surface behind it (the web nav item was intentionally omitted — no route).

---

## 3. Latent bug — single-org lock (org switching)

A user can belong to multiple organizations (`UserRole` is unique per
`(userId, orgId)`), but `auth.login` and `auth.refresh` hardcode
`primaryRole = user.roles[0]` and bake a single `orgId` into the JWT. There is
**no way to switch organizations**.

- **Impact:** a staff member invited to a second org is silently locked to their
  first org (`roles[0]`) and cannot access the others.
- **Scope to fix (small):** backend `GET /auth/organizations` (list memberships)
  - `POST /auth/switch-organization` (validate membership → issue new
    token/cookie scoped to the chosen org); frontend org-switcher in the AppShell
    (the auth store + socket already reconnect on token change; invalidate all
    org-scoped queries on switch).
- **Priority:** low unless multi-branch / franchise customers are targeted, but
  cheap to build and it closes the latent bug above.

---

## 4. Suggested sequence when prioritized

1. **Enforce plan limits (backend).** Reject creates beyond the plan with a
   `PLAN_LIMIT_EXCEEDED` error; gate plan-only features (TV Display, analytics).
   Cheap, meaningful, and gives a real reason to upgrade.
2. **Surface plan + usage (UI).** Show current plan and usage (e.g. "1 / 1
   services"), and an upgrade prompt when a limit is hit.
3. **Billing / payment (Stripe).** Pricing page, plan management, checkout,
   webhooks. Largest effort — defer until ready to charge (manual upgrades are
   fine initially).
4. **Organization switching.** Build alongside or before billing if multi-org
   membership becomes common.

---

## 5. Acceptance-criteria sketch (for the future enforcement spec)

These are starting points to expand into EARS requirements later — not final:

- WHEN an org on a plan with `maxServices = N` already has `N` services AND an
  authorized user attempts to create another, THE API SHALL reject it with
  `PLAN_LIMIT_EXCEEDED` and SHALL NOT create the service. (Same shape for
  counters, staff, daily queue volume.)
- WHERE a plan has `tvDisplay = false`, THE system SHALL deny access to the TV
  Display surface for that org.
- WHERE a plan has `analytics = false`, THE system SHALL hide/deny analytics
  features for that org.
- THE web app SHALL display the org's current plan and per-resource usage
  against its limit, and SHALL prompt to upgrade when a limit is reached.
- Enforcement is the security boundary on the backend; the UI only mirrors it
  (consistent with the existing RBAC convention).

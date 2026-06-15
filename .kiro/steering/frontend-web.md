---
inclusion: fileMatch
fileMatchPattern: 'apps/web/**'
---

# Frontend Web — Standards & Conventions

These conventions apply to `apps/web` (the React staff/admin/display/kiosk app).
They extend `project-standards.md`; where this file is more specific, it wins.

## Tech Stack (Frontend)

| Concern      | Choice                                              |
| ------------ | --------------------------------------------------- |
| Framework    | React 19 + TypeScript (strict)                      |
| Routing      | TanStack Router (file-based, type-safe)             |
| Server state | TanStack Query                                      |
| Client state | Zustand (minimal — UI/ephemeral state only)         |
| Styling      | Tailwind CSS + shadcn/ui (Base UI primitives)       |
| Forms        | TanStack Form (`@tanstack/react-form`)              |
| Validation   | Zod schemas from `@queuenow/shared-validation`      |
| API types    | `openapi-typescript` generated from backend Swagger |
| Realtime     | `socket.io-client`                                  |
| Toasts       | `sonner`                                            |
| Testing      | Vitest + React Testing Library                      |
| Build        | Vite                                                |

## App Surfaces (Route Groups)

`apps/web` hosts three surfaces in one app. They share the component library,
design tokens, API client, and WebSocket client.

| Surface      | Path              | Auth           | Audience                             |
| ------------ | ----------------- | -------------- | ------------------------------------ |
| Dashboard    | `/` and nested    | Required (JWT) | Owner, Admin, Staff                  |
| Display (TV) | `/display/:orgId` | Public         | Walk-in customers (read-only screen) |
| Kiosk        | `/kiosk/:orgId`   | Public         | Customers taking a ticket on-site    |

The customer mobile experience lives in `apps/mobile` (Expo) — do NOT add
customer-app screens here.

## Folder Structure

Feature-based. Group by domain, not by file type.

```
apps/web/src/
├── main.tsx
├── router.tsx                 # TanStack Router setup
├── routes/                    # File-based routes (thin — delegate to features)
│   ├── __root.tsx
│   ├── index.tsx
│   ├── _authenticated/        # Layout route with auth guard
│   │   ├── dashboard.tsx
│   │   ├── queue.tsx
│   │   ├── services.tsx
│   │   ├── counters.tsx
│   │   ├── staff.tsx
│   │   └── settings.tsx
│   ├── display.$orgId.tsx     # Public TV display
│   └── kiosk.$orgId.tsx       # Public kiosk
├── features/                  # Domain logic & UI
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/             # useLogin, useRegister, useAuth
│   │   ├── api/               # query/mutation hooks
│   │   └── stores/           # auth zustand store (in-memory token)
│   ├── queue/
│   ├── services/
│   ├── counters/
│   ├── staff/
│   ├── organization/
│   └── display/
├── components/                # Shared, domain-agnostic UI
│   └── ui/                    # shadcn/ui components (Base UI primitives)
├── lib/
│   ├── api/                   # generated client + fetch wrapper
│   │   ├── schema.d.ts        # openapi-typescript output (generated)
│   │   ├── client.ts          # typed fetch wrapper + auth/refresh
│   │   └── query-client.ts    # TanStack Query client config
│   ├── socket.ts              # socket.io-client singleton
│   ├── theme.ts               # branding → CSS variable injection
│   └── utils.ts               # cn() etc.
├── hooks/                     # Shared cross-feature hooks
└── types/                     # App-local types (not API types)
```

Rules:

- `routes/` files stay thin: parse params, render a feature component.
- A feature never imports from another feature's internals. Share via
  `components/`, `hooks/`, or `lib/`.
- shadcn components (built on Base UI primitives) live in `components/ui/` and
  are not edited ad-hoc; wrap them for customization.

## Environment Config

- All frontend env vars are prefixed `VITE_` and read via `import.meta.env`.
  Never reference `process.env` in client code.
- Required vars:

  | Var            | Purpose                                             |
  | -------------- | --------------------------------------------------- |
  | `VITE_API_URL` | REST base URL (e.g. `http://localhost:4000/api/v1`) |
  | `VITE_WS_URL`  | Socket.io base URL (e.g. `http://localhost:4000`)   |

- Validate env on boot with a Zod schema in `lib/env.ts`; fail fast with a clear
  error if a required var is missing (mirrors the backend's fail-fast rule).
- Provide `apps/web/.env.example` listing every var. Never commit real `.env`.
- Do not hardcode URLs anywhere — always go through the validated `env` object.

## Authentication

Token strategy: **access token in memory, refresh token in httpOnly cookie.**

- The access token is stored ONLY in a Zustand store (memory). Never write it to
  `localStorage`, `sessionStorage`, or a non-httpOnly cookie.
- The refresh token is set by the backend as an httpOnly, Secure, SameSite cookie.
  Frontend never reads it directly.
- All API requests use `credentials: 'include'` so the refresh cookie is sent.
- On `401`, the API client attempts a single silent refresh
  (`POST /auth/refresh`), updates the in-memory access token, and retries the
  original request once. If refresh fails, clear auth state and redirect to login.
- On app boot (hard reload), attempt a silent refresh to restore the session,
  since the in-memory access token is gone but the refresh cookie persists.
- Route guards: the `_authenticated` layout route checks auth state in
  `beforeLoad` and redirects to `/login` when unauthenticated.

## Role-Based UI

The backend roles are `OWNER`, `ADMIN`, `STAFF` (see `UserRoleType`). The frontend
must gate UI to match. Hiding UI is never the security boundary — the backend
authorizes every request — but the UI should not show actions a role cannot perform.

- The active role lives in the auth store (from the login/refresh response
  `organization.role`).
- Provide a `useHasRole(...roles)` hook and a `<RoleGate roles={[...]}>` component
  in `features/auth/`. Use them to conditionally render nav items, buttons, and routes.
- Capability guideline (UI visibility):

  | Area                                    | OWNER | ADMIN | STAFF |
  | --------------------------------------- | :---: | :---: | :---: |
  | Serve queue (call/recall/skip/complete) |   ✓   |   ✓   |   ✓   |
  | Services / Counters CRUD                |   ✓   |   ✓   |   –   |
  | Staff management                        |   ✓   |   ✓   |   –   |
  | Org settings / branding                 |   ✓   |   ✓   |   –   |
  | Billing / plan                          |   ✓   |   –   |   –   |
  | Delete organization                     |   ✓   |   –   |   –   |

- Route-level: protect role-restricted routes in `beforeLoad`, redirecting
  unauthorized roles to the dashboard with a toast, not a blank screen.

## API Layer

- Generate types from the backend Swagger doc into `lib/api/schema.d.ts` using
  `openapi-typescript`. Treat this file as generated — do not hand-edit.
  Add a script: `pnpm --filter @queuenow/web generate:api`.
- `lib/api/client.ts` is the single typed fetch wrapper. It handles base URL,
  `credentials: 'include'`, the access-token header, the 401 refresh-and-retry
  flow, and unwrapping the standard `{ success, data, meta }` envelope.
- All server interaction goes through TanStack Query hooks colocated in each
  feature's `api/` folder. No raw `fetch`/client calls inside components.
- Query keys are arrays namespaced by feature, e.g.
  `['queue', orgId, serviceId]`, `['staff', orgId]`.
- Mutations invalidate the relevant query keys on success. Prefer invalidation
  over manual cache writes unless optimistic UI is required.
- Unwrap the API envelope in the client so hooks return `data` directly. Map
  `ApiErrorResponse.error.code` to user-facing messages.

## Realtime (WebSocket)

- One `socket.io-client` connection per app session, created in `lib/socket.ts`,
  namespace `/queue`.
- **Authentication:**
  - Dashboard (authenticated): pass the in-memory access token in the socket
    handshake `auth` payload (`io(url, { auth: { token } })`). On token refresh,
    reconnect the socket with the new token.
  - Display & Kiosk (public): connect without a token and only `subscribe` to
    public `orgId` rooms. Never send authenticated actions from these surfaces.
- Subscribe with the documented events from `@queuenow/shared-constants`
  (`WS_EVENTS`): `subscribe`, `unsubscribe`, `subscribe:ticket`. Subscribe by
  `orgId` (and optionally `serviceId`).
- Bridge socket events into TanStack Query: on `queue:update` /
  `queue:ticket-called`, invalidate or patch the matching query keys so the UI
  stays consistent with REST data. Do not keep a parallel ad-hoc store of queue
  state.
- **Resilience (required for always-on Display/Kiosk):**
  - Enable auto-reconnect with backoff (socket.io default); surface a subtle
    "reconnecting" indicator.
  - If disconnected beyond a short threshold, fall back to REST polling of queue
    status (e.g. every 10s) until reconnected, then stop polling.
  - Re-`subscribe` to rooms automatically on every reconnect.
- Always `unsubscribe` and remove listeners on unmount.

## Display & Kiosk Surfaces

These public, on-site screens have different requirements from the dashboard.

**Display (TV) — `/display/:orgId`:**

- Read-only "now serving" board. No authentication, no mutations.
- **Audio announcement:** when a `queue:ticket-called` event arrives, play a chime
  then announce the ticket number + counter (Web Speech API / TTS, with an audio
  chime fallback). Provide a mute toggle. Browsers require a user gesture to unlock
  audio — show a one-time "tap to enable sound" overlay.
- Large typography, high contrast, no color-only signalling for the called state.
- Support fullscreen; assume no interaction after setup — must run unattended.
- Resilient to network drops (see Realtime resilience above).

**Kiosk — `/kiosk/:orgId`:**

- Public ticket-taking flow: pick service → (optional name/phone if the org's
  `QueueSettings` require it) → confirm → show ticket number + QR to track on phone.
- MVP delivery is **phone-based**: the customer scans/opens a tracking link; no
  physical thermal-printer integration. (Revisit if on-site printing is needed.)
- Touch-friendly targets; auto-reset to the start screen after a short idle
  timeout so the next customer gets a clean state.

## Dates, Times & Formatting

- The org timezone comes from `Organization.timezone` (e.g. `Asia/Kuala_Lumpur`).
- Format all displayed times in the org's timezone, not the browser's. Centralize
  formatting in `lib/format.ts` (wrap `Intl.DateTimeFormat` / a date lib with the
  org timezone).
- Show wait estimates and durations in human terms ("~15 min"); show absolute
  times consistently (e.g. `HH:mm`).
- Never send locale-formatted dates to the API — use ISO strings.

## UX Conventions

- **Toasts:** use a single toast library (`sonner`). Use toasts for transient
  success/failure of actions; use inline messages for form/field errors and for
  empty/error states of data regions. Don't toast routine query successes.
- **Loading & empty states:** every data region has explicit loading (skeleton),
  empty, and error states — never a bare spinner-only screen for primary content.
- **Errors:** wrap route subtrees in error boundaries. Map `error.code` to
  friendly copy; never surface raw backend messages or stack traces.
- **Optimistic updates:** apply for high-frequency staff actions (call next,
  recall, skip, complete) so the panel feels instant; roll back on error and
  reconcile via query invalidation / the incoming socket event.
- **Pagination:** the API returns `meta.page/limit/total`. Use a consistent
  paginated-query pattern (page state in the URL search params via TanStack
  Router) so lists are shareable and back-button friendly.

## Performance

- Code-split by route. Lazy-load the Display and Kiosk routes so dashboard users
  never download screen/kiosk code (and vice versa).
- Memoize expensive lists; virtualize long queue lists when needed.
- Keep the shared `components/ui` tree free of heavy dependencies.

## Internationalization

- Default UI language is English for MVP, but keep copy translatable: no hardcoded
  user-facing strings deep in components — centralize so EN/MS can be added later
  without refactoring. Defer a full i18n library until a second language is
  committed.

## Forms & Validation

- Use TanStack Form (`@tanstack/react-form`) with the shared Zod schemas as
  Standard Schema validators.
- Reuse schemas from `@queuenow/shared-validation` (e.g. `loginSchema`,
  `registerSchema`, `createServiceSchema`). Do NOT redefine validation on the
  client — import the shared schema. Pass it as the `validators.onSubmit`
  validator; for schemas that use `.default()`/transforms, wrap with the
  `zodFormValidator` helper in `lib/forms.ts` so the form data type stays
  concrete.
- Map backend field errors (`error.details`) back onto form fields: convert
  them with `toFieldErrors` and return `{ fields }` from the form's
  `onSubmitAsync` validator (a non-field error returns `{ form }` and toasts the
  code-mapped message).
- Disable submit while submitting (subscribe to `state.isSubmitting`); show
  inline field errors, not just toasts.

## Styling & Theming

- Tailwind utility-first. Use the `cn()` helper for conditional classes.
- Design tokens are CSS custom properties (HSL channels) consumed by Tailwind /
  shadcn theme config. Define a default theme in global CSS.
- Per-org branding: `OrganizationBranding.primaryColor` is injected at runtime as
  a CSS variable (e.g. `--primary`) via `lib/theme.ts` after the org loads. UI
  reads the variable — never hardcode the brand color in components.
- Support light/dark via the `class` strategy.
- Prefer composition over deeply conditional components.

## State Management

- Server data → TanStack Query. Never duplicate server data in Zustand.
- Zustand only for: auth (in-memory access token + user/org), and ephemeral UI
  state (sidebar open, active counter selection, etc.).
- Keep stores small and feature-scoped.

## TypeScript

- Strict mode; no `any` (use `unknown` + narrowing).
- Derive API request/response types from the generated `schema.d.ts`; use
  `@queuenow/shared-types` for shared domain enums/interfaces.
- Always type component props with an explicit interface.

## Testing

- Vitest + React Testing Library. Test behavior, not implementation.
- Mock the API client / socket at the boundary; do not hit a real backend in unit
  tests.
- Each feature owns its tests under `features/<name>/__tests__/` or colocated
  `*.test.tsx`.
- Minimum coverage targets for MVP: auth flow, queue actions (call/recall/skip/
  complete), and route guards.

## Accessibility

- All interactive elements keyboard-reachable; visible focus states.
- shadcn/Base UI primitives provide ARIA — keep their semantics when wrapping.
- Display (TV) screen: large type, high contrast, no reliance on color alone for
  "now serving" state.

## Naming (Frontend-specific)

- Components: PascalCase files (`QueueStatus.tsx`, `StaffPanel.tsx`).
- Hooks: `useXxx` camelCase (`useCallNext`, `useAuth`).
- Non-component files: kebab-case (`query-client.ts`, `theme.ts`).
- Query/mutation hooks named by intent (`useQueueStatus`, `useCallNextTicket`).

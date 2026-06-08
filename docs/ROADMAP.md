# QueueNow — Roadmap

## Current Status: Backend MVP ✅

---

## What's Done

### ✅ Planning & Architecture
- [x] Product specification (features, roles, modules)
- [x] Tech stack decisions
- [x] Database schema (16 tables)
- [x] API design (73 endpoints + 8 WebSocket events)
- [x] Auth strategy (separate staff vs customer)
- [x] Monorepo structure (Turborepo + pnpm)
- [x] Project standards & conventions

### ✅ Backend (NestJS) — Core Modules
- [x] Project setup (NestJS 11 + TypeScript)
- [x] Prisma schema + database models
- [x] Global config (env, CORS, helmet, rate limiting)
- [x] Global exception filter (consistent error responses)
- [x] Global response interceptor (wrap success responses)
- [x] Logging interceptor
- [x] JWT auth guard + roles guard
- [x] Custom decorators (@CurrentUser, @Public, @Roles)

### ✅ Backend — Feature Modules (Full Implementation)
- [x] **Auth** — Register, login, refresh token, logout
- [x] **Organization** — Get, update, stats
- [x] **Service** — CRUD with prefix uniqueness validation
- [x] **Counter** — CRUD with service assignment
- [x] **Staff** — Invite (with token), list, remove, cancel invitation
- [x] **Queue** — Join, call next (FIFO), recall (max 2x), skip, complete, rejoin, status
- [x] **Display** — TV display data, now serving, branding
- [x] **Customer** — Register, login, profile, history, favorites
- [x] **Notification** — Push token registration, notification list
- [x] **QR Code** — Generate org/service QR URLs
- [x] **WebSocket Gateway** — Room-based subscriptions, real-time events

### ✅ Shared Packages
- [x] `@queuenow/shared-types` — Interfaces, enums, API response types, WS event types
- [x] `@queuenow/shared-validation` — Zod schemas for all inputs
- [x] `@queuenow/shared-constants` — Error codes, plan limits, default services, WS events

### ✅ Infrastructure
- [x] Docker Compose (PostgreSQL 16 + Redis 7)
- [x] Dockerfile (production build)
- [x] GitHub Actions CI (lint + test + build)
- [x] .env.example
- [x] .gitignore, .prettierrc

---

## What's Pending (By Priority)

### 🔴 Phase 1: Complete Backend (1-2 weeks)

| Task | Status | Priority |
|------|--------|----------|
| Google OAuth flow (full implementation) | ⬜ | High |
| Forgot/Reset password (with email) | ⬜ | High |
| Email verification flow | ⬜ | Medium |
| Staff accept invitation (create account from invite) | ⬜ | High |
| Staff assignment endpoints (pick/release counter) | ⬜ | High |
| Organization discovery endpoints | ⬜ | Medium |
| Super Admin module | ⬜ | Low (MVP) |
| Daily auto-reset (cron job / scheduled task) | ⬜ | High |
| Plan limit enforcement (check limits on actions) | ⬜ | Medium |
| Audit log triggers (log critical actions) | ⬜ | Medium |
| File upload (Cloudflare R2 — logos) | ⬜ | Medium |
| Proper DTOs for ALL endpoints (replace `any`) | ⬜ | High |
| Consistent error codes usage | ⬜ | Medium |
| Unit tests (queue logic, auth) | ⬜ | High |
| Integration tests (critical API flows) | ⬜ | Medium |

### 🟡 Phase 2: Frontend Web App (2-3 weeks)

| Task | Status | Priority |
|------|--------|----------|
| React + TanStack Router + Vite setup | ⬜ | High |
| Tailwind CSS + shadcn/ui setup | ⬜ | High |
| Auth pages (login, register) | ⬜ | High |
| Organization onboarding wizard | ⬜ | High |
| Dashboard page | ⬜ | High |
| Services management page | ⬜ | High |
| Counters management page | ⬜ | Medium |
| Staff management page | ⬜ | Medium |
| Staff panel (queue serving UI) | ⬜ | High |
| TV display page (fullscreen) | ⬜ | High |
| Settings page (branding, queue config) | ⬜ | Medium |
| QR code download page | ⬜ | Medium |
| Socket.io client integration | ⬜ | High |
| Sound alerts (Web Audio API) | ⬜ | Medium |

### 🟢 Phase 3: Mobile App — Customer (2-3 weeks)

| Task | Status | Priority |
|------|--------|----------|
| React Native + Expo setup | ⬜ | High |
| Auth screens (login, register, Google) | ⬜ | High |
| QR scanner (camera) | ⬜ | High |
| Join queue flow | ⬜ | High |
| Queue status tracking (real-time) | ⬜ | High |
| Organization discovery (search, categories) | ⬜ | Medium |
| Favorites | ⬜ | Medium |
| Queue history | ⬜ | Medium |
| Profile management | ⬜ | Low |
| Push notifications (FCM) | ⬜ | High |
| Leave queue / rejoin | ⬜ | Medium |
| Offline handling | ⬜ | Low |

### 🔵 Phase 4: Polish & Deploy (1-2 weeks)

| Task | Status | Priority |
|------|--------|----------|
| Production deployment (Railway/DO) | ⬜ | High |
| Domain + SSL setup | ⬜ | High |
| Sentry integration (error tracking) | ⬜ | Medium |
| Database backup automation | ⬜ | Medium |
| Staging environment | ⬜ | Medium |
| Performance testing | ⬜ | Medium |
| Security audit | ⬜ | High |
| App Store submission (iOS) | ⬜ | High |
| Play Store submission (Android) | ⬜ | High |
| Client handover documentation | ⬜ | High |

---

## Phase 5: Post-Launch (Future)

| Feature | Description |
|---------|-------------|
| Sequential queue flow | Customer auto-moves through multiple services |
| Transfer customer | Move to different counter/service |
| Hold | Pause customer temporarily |
| Notes | Staff add notes per customer |
| SMS/WhatsApp notifications | Alternative to push |
| Multi-branch support | Same org, multiple locations |
| Advanced analytics | Charts, reports, export |
| Bahasa Melayu translation | i18n |
| Custom domain per org | Enterprise feature |
| API access for integrations | Enterprise feature |

---

## Timeline Estimate

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 | 1-2 weeks | Backend 100% complete |
| Phase 2 | 2-3 weeks | Web app functional |
| Phase 3 | 2-3 weeks | Mobile app functional |
| Phase 4 | 1-2 weeks | Deployed & live |
| **Total** | **~6-10 weeks** | **Full MVP** |

---

## How to Continue Development

1. Clone repo: `git clone https://github.com/ahmadafifudding/queuenow.git`
2. Follow `docs/SETUP_GUIDE.md` for local setup
3. Read `docs/PRODUCT_SPEC.md` for feature details
4. Check `docs/API_DESIGN.md` for endpoint specs
5. Check `docs/DATABASE_SCHEMA.md` for DB structure
6. Check `docs/TECH_STACK.md` for architecture decisions
7. Pick a task from Phase 1 above and start building!

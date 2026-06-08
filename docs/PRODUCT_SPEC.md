# QueueNow — Product Specification

## Overview

QueueNow is a multi-tenant SaaS Queue Management System designed for clinics, banks, restaurants, government offices, and any organization that needs to manage customer queues efficiently.

## Business Model

| Plan | Price (MYR) | Includes |
|------|-------------|----------|
| Free | RM0/month | 1 service, 1 counter, 30 queue/day |
| Basic | RM39/month | 3 services, 3 counters, unlimited queue |
| Pro | RM99/month | Unlimited services & counters, TV display, analytics, priority support |
| Enterprise | Custom | Multi-branch, API access, custom branding |

## Target Market

- Clinics (GP, specialist, dental)
- Banks & financial institutions
- Restaurants & F&B
- Government offices
- Any service-based organization

---

## Users & Roles

| # | Role | Platform | Description |
|---|------|----------|-------------|
| 1 | **Super Admin** | Web | System owner. Manages all organizations, billing, system settings |
| 2 | **Owner** | Web | Organization owner. Full control — services, counters, staff, settings, billing |
| 3 | **Admin** | Web | Org admin (assigned by owner). Same as owner EXCEPT billing & delete org |
| 4 | **Staff** | Web | Counter staff. Pick counter, serve queue (call, recall, skip, complete) |
| 5 | **Customer** | Mobile App / Browser | End user. Scan QR, join queue, view status |

### Role Permissions Matrix

| Action | Super Admin | Owner | Admin | Staff | Customer |
|--------|:-----------:|:-----:|:-----:|:-----:|:--------:|
| Manage all orgs | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create organization | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete organization | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage billing/plan | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage services | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage counters | ✅ | ✅ | ✅ | ❌ | ❌ |
| Invite/manage staff | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage settings/branding | ✅ | ✅ | ✅ | ❌ | ❌ |
| View analytics | ✅ | ✅ | ✅ | ❌ | ❌ |
| Pick counter | ❌ | ❌ | ❌ | ✅ | ❌ |
| Serve queue | ❌ | ❌ | ❌ | ✅ | ❌ |
| Scan QR & join queue | ❌ | ❌ | ❌ | ❌ | ✅ |
| View queue status | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Platforms

| Platform | Users | Purpose |
|----------|-------|---------|
| **Web App** | Owner, Admin, Staff | Dashboard, manage org, serve queue (responsive — works on phone too) |
| **Mobile Browser** | Customer (no app) | Scan QR → quick join queue (anonymous) |
| **Mobile App** | Customer (with app) | Full experience — history, explore orgs, favorites, push notifications |

---

## Modules

| # | Module | Description |
|---|--------|-------------|
| 1 | **Auth** | Sign up, login, logout, password reset, Google OAuth |
| 2 | **Organization** | Create, update, settings, branding, subscription/plan |
| 3 | **Service** | CRUD services, prefix, settings per service |
| 4 | **Counter** | CRUD counters, assign to service, status |
| 5 | **Staff** | Invite, manage, assign role, assign service |
| 6 | **Queue** | Join queue, ticket generation, status tracking, auto-reset |
| 7 | **Display** | TV display data, real-time updates, sound triggers |
| 8 | **Customer** | Optional info collection, session tracking, phone status |
| 9 | **QR Code** | Generate, customize, download QR codes |
| 10 | **Notification** | Sound alert, vibration, browser push, mobile push (FCM) |
| 11 | **Analytics** | Basic stats — total served, avg wait time, peak hours |
| 12 | **Settings** | Organization settings, branding, customer form config, reset config |

---

## Features (MVP)

### Web App Features (Owner/Admin/Staff)

| # | Feature | Detail |
|---|---------|--------|
| 1 | Organization Onboarding | Self-service sign up → create org → setup services → get QR code |
| 2 | Multi-service Setup | Parallel queues. Each service has name, prefix, counters |
| 3 | QR Code Generation | 1 QR per org OR 1 QR per service. Downloadable/printable |
| 4 | Staff Panel | Call next, recall (max 2x), skip, complete |
| 5 | TV Display | Now serving, upcoming, flash animation on call, DING sound |
| 6 | Staff Assign to Counter | Self-assign on login, 1 staff = 1 counter |
| 7 | Queue Position & Est. Wait | Position × avg serving time ÷ active counters |
| 8 | Sound Alert | TV: DING on call. Phone: sound + vibrate |
| 9 | Daily Auto-Reset | Reset ticket numbers at midnight (or custom time) |
| 10 | Optional Customer Info | Toggle: require name/phone/custom fields per org |
| 11 | Abuse Prevention | 1 device = 1 active ticket per service, rate limiting |
| 12 | Offline Handling | Show last known state + "Reconnecting..." |
| 13 | Organization Branding | Logo, primary color, QR text, custom URL slug |
| 14 | Organization Type Templates | Default services suggested based on type (clinic, bank, etc.) |
| 15 | Dashboard | Quick actions, today's stats |

### Mobile App Features (Customer)

| # | Feature | Detail |
|---|---------|--------|
| 1 | Join Queue | Scan QR or browse/search organizations |
| 2 | View Queue Status | Real-time tracking (position, est. wait, status) |
| 3 | Queue History | Past queues — date, org, wait time (90 days retention) |
| 4 | Edit Profile | Name, phone, avatar |
| 5 | Explore Organizations | Search by name, browse by category, scan QR |
| 6 | Favorites | Save frequent organizations |
| 7 | Push Notifications | "Your turn!", "Almost your turn", "You've been skipped" |
| 8 | Est. Wait Time Before Join | See wait time before deciding to join |
| 9 | Leave Queue | Cancel/leave before being called |
| 10 | Rejoin Queue | Rejoin after being skipped (back of queue, 1 free rejoin) |

---

## User Flows

### Flow 1: Organization Onboarding

```
Owner signs up (email/Google)
  → Create Organization (name, type, address)
    → System suggests default services based on type
      → Owner confirms/edits services
        → System generates QR code
          → Dashboard ready!
```

### Flow 2: Customer Join Queue (Browser — No App)

```
Customer scans QR at premise
  → Opens web page (no download needed)
    → Sees organization name + available services
      → Taps service (e.g., "Consultation")
        → Instantly gets ticket number (e.g., B-007)
          → Sees: position, est. wait, now serving
            → Real-time updates until called
              → "YOUR TURN! Counter 2" + sound + vibrate
```

### Flow 3: Staff Serving Queue

```
Staff logs in → Picks available counter
  → Sees: "Now serving: —" + queue count
    → Clicks "Next" → System calls oldest WAITING ticket (FIFO)
      → TV displays: "B-007 → Counter 2" + DING
        → Customer arrives → Staff serves
          → Clicks "Complete" → Ready for next
            → (or "Recall" if no show, max 2x)
              → (or "Skip" if still no show)
```

### Flow 4: Customer Join Queue (Mobile App)

```
Customer opens app
  → Browse/search organizations OR scan QR
    → Sees services + est. wait time
      → Joins queue (optional: with profile info)
        → Gets push notification when turn is near
          → "YOUR TURN!" push notification
```

---

## Queue Logic Rules

| Rule | Detail |
|------|--------|
| FIFO ordering | First in, first out. Oldest WAITING ticket called first |
| Ticket format | PREFIX + 3-digit number (e.g., A-001, B-012) |
| Daily reset | Numbers reset to 001 at midnight (or custom time) |
| Max recall | 2 times (configurable). After max → suggest skip |
| Rejoin after skip | Back of queue (not priority). 1 free rejoin per ticket |
| Complete before next | Staff must Complete or Skip before calling Next |
| Position calculation | Count of WAITING tickets created before current |
| Est. wait formula | (Position ÷ Active Counters) × Avg Serving Time |

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Response time | < 200ms for API calls |
| Real-time latency | < 500ms for WebSocket events |
| Uptime | 99.5% |
| Max concurrent per org | 200 users (MVP) |
| Data retention (customer) | 90 days |
| Data retention (org analytics) | 1 year |
| Mobile app size | < 20MB |
| Browser support | Chrome, Safari, Firefox (latest 2 versions) |

---

## Decisions Log

| Decision | Rationale |
|----------|-----------|
| Separate auth (staff vs customer) | Different tables, different security needs, different platforms |
| Parallel queues first (sequential in Phase 2) | Simpler, covers 80% use cases (bank, restaurant) |
| Optional customer info (default OFF) | Zero friction. Org can enable if needed |
| pnpm + Turborepo monorepo | Shared code, atomic changes, single repo |
| NestJS over Hono | Structured, enterprise-grade, built-in WebSocket, guards, swagger |
| Self-managed stack (no Supabase) | Full control, no vendor lock-in, production-grade |
| SaaS (multi-tenant) | Scalable, recurring revenue, org just signs up & uses |
| English default + i18n ready | Wider market, add BM later |
| Self-service onboarding | Scalable, 24/7, less admin work |
| Docker for DB/Redis only (dev) | Code runs native for fast hot-reload |

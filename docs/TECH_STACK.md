# QueueNow — Tech Stack

## Overview

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend (Web)** | React + TanStack Router + TypeScript + Tailwind CSS + shadcn/ui | React 19.x |
| **Backend** | NestJS + TypeScript + Prisma | NestJS 11.x, Prisma 7.x |
| **WebSocket** | Socket.io (via NestJS Gateway) | Socket.io 4.8.x |
| **Database** | PostgreSQL | 16+ |
| **Cache** | Redis | 7+ |
| **Auth** | Passport.js + JWT + bcrypt | Custom implementation |
| **Storage** | Cloudflare R2 | — |
| **Email** | Resend | — |
| **Logging** | Winston + Sentry | — |
| **Testing** | Jest + Supertest (backend), Vitest (frontend) | — |
| **API Docs** | Swagger/OpenAPI (auto-generated from NestJS) | — |
| **Mobile** | React Native (Expo SDK 56) | RN 0.85, React 19.2 |
| **Monorepo** | Turborepo 2.6 + pnpm 10.x | — |
| **Containerization** | Docker + Docker Compose | — |
| **CI/CD** | GitHub Actions | — |
| **Deploy** | Railway / DigitalOcean | — |

---

## Monorepo Structure

```
queuenow/
├── apps/
│   ├── api/              ← NestJS backend + Socket.io
│   ├── web/              ← React frontend (Owner, Admin, Staff)
│   └── mobile/           ← React Native Expo (Customer)
├── packages/
│   ├── shared-types/     ← TypeScript interfaces & enums
│   ├── shared-validation/← Zod schemas (shared between FE & BE)
│   └── shared-constants/ ← Error codes, plan limits, defaults
├── docker/
│   └── compose.yml       ← PostgreSQL + Redis for local dev
├── docs/                 ← Project documentation
├── .github/workflows/    ← CI/CD
├── package.json          ← Root workspace config
├── pnpm-workspace.yaml   ← Workspace definitions
├── turbo.json            ← Turborepo task config
└── tsconfig.base.json    ← Shared TypeScript config
```

---

## Technology Decisions & Justifications

### Why NestJS (not Hono/Express)?

| Factor | Decision |
|--------|----------|
| **Project type** | Production SaaS, not a side project |
| **Structure** | NestJS enforces Module → Controller → Service pattern |
| **Long-term maintainability** | Built-in patterns keep code organized at scale |
| **Built-in features** | WebSocket Gateway, Guards, Interceptors, Swagger — all native |
| **Team scalability** | New devs understand NestJS = understand project |
| **Testing** | Built-in testing utilities |
| **Enterprise-proven** | Used by large companies in production |

### Why Prisma (not TypeORM/Drizzle)?

| Factor | Decision |
|--------|----------|
| **Type-safety** | Auto-generates TypeScript types from schema |
| **Migration** | `prisma migrate` — simple, reliable |
| **Prisma 7** | Rust-free, 3x faster queries, 90% smaller bundles |
| **Developer experience** | Prisma Studio, intuitive API |
| **NestJS integration** | Official support |

### Why React + TanStack Router (not Next.js)?

| Factor | Decision |
|--------|----------|
| **SPA for admin panel** | No SEO needed for dashboard — SPA is fine |
| **Separate backend** | Backend is NestJS — don't need Next.js API routes |
| **Type-safe routing** | TanStack Router has first-class TypeScript support |
| **Lighter** | No SSR overhead for an admin dashboard |
| **Mobile API sharing** | Same backend serves web + mobile |

### Why Socket.io (not Supabase Realtime)?

| Factor | Decision |
|--------|----------|
| **Full control** | No vendor dependency for critical real-time features |
| **NestJS native** | Built-in WebSocket Gateway support |
| **Scalable** | Can run multiple instances with Redis adapter |
| **Room-based** | Perfect for per-org, per-service, per-ticket subscriptions |
| **No limits** | Supabase free tier = 200 concurrent. Self-managed = unlimited |

### Why Self-Managed (not Supabase/Firebase)?

| Factor | Decision |
|--------|----------|
| **Production SaaS** | Need full control over infrastructure |
| **No vendor lock-in** | Can migrate to any provider |
| **Data sovereignty** | Control where data lives |
| **Custom auth** | Full control over token structure, flows |
| **Cost predictable** | No surprise pricing at scale |
| **Professional** | Client confidence in robust architecture |

### Why pnpm + Turborepo?

| Factor | Decision |
|--------|----------|
| **pnpm** | Fast, disk-efficient, strict (no phantom deps), native workspace support |
| **Turborepo** | Task caching, parallel execution, simple config |
| **Shared packages** | Types, validation, constants shared across all apps |
| **Atomic commits** | Change API + frontend in 1 commit |
| **React Native fits** | Same monorepo, shared types |

### Why Docker (for development)?

| Factor | Decision |
|--------|----------|
| **PostgreSQL + Redis** | One command to start all dependencies |
| **Consistent environment** | Every developer gets same DB version |
| **No local install** | Don't pollute machine with services |
| **Production parity** | Same versions as production |
| **NOT for code** | Code runs native (fast hot-reload). Docker only for infra |

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                      CLIENTS                              │
├──────────────┬───────────────┬───────────────────────────┤
│  React Web   │  Mobile App   │   TV Display              │
│  (Staff/Admin)│  (Customer)  │   (Public)                │
│  TanStack    │  React Native │   React (fullscreen)      │
│  Router      │  Expo SDK 56  │                           │
└──────┬───────┴───────┬───────┴───────────┬───────────────┘
       │               │                   │
       │    HTTP/REST  │                   │  WebSocket
       └───────────────┼───────────────────┘
                       │
              ┌────────▼────────┐
              │   NestJS API    │
              │   + Socket.io   │
              │   (Port 4000)   │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
   ┌──────▼──────┐ ┌──▼─────┐ ┌───▼────────┐
   │ PostgreSQL  │ │ Redis  │ │Cloudflare R2│
   │   (Data)   │ │(Cache) │ │  (Storage)  │
   │  Port 5432 │ │Port 6379│ │  (Logos)   │
   └─────────────┘ └────────┘ └────────────┘
```

---

## Security Stack

| Layer | Implementation |
|-------|---------------|
| **HTTP Headers** | Helmet middleware |
| **CORS** | Whitelist domains only (no wildcard in production) |
| **Rate Limiting** | @nestjs/throttler (60 req/min default) |
| **Input Validation** | class-validator + DTOs on ALL endpoints |
| **Password Hashing** | bcrypt with 12 salt rounds |
| **JWT Access Token** | 15 minutes expiry |
| **JWT Refresh Token** | 7 days expiry, stored in DB |
| **SQL Injection** | Prevented by Prisma parameterized queries |
| **XSS** | Input sanitization + Helmet headers |
| **Brute Force** | Account lockout after 5 failed login attempts |

---

## DevOps & Deployment

| Item | Tool/Service |
|------|-------------|
| **Local Dev** | Docker Compose (PostgreSQL + Redis) |
| **CI/CD** | GitHub Actions (lint → test → build → deploy) |
| **Staging** | Railway / DigitalOcean (separate environment) |
| **Production** | Railway / DigitalOcean (Docker containers) |
| **Monitoring** | Sentry (errors) + Winston (logs) |
| **Health Check** | `/api/v1/health` endpoint |
| **Backup** | Daily automated PostgreSQL backup |
| **Environment Config** | `.env` files (never committed) |

---

## Package Dependencies (Key)

### Backend (`apps/api`)

| Package | Purpose |
|---------|---------|
| `@nestjs/core` | Framework |
| `@nestjs/config` | Environment config |
| `@nestjs/jwt` | JWT token generation/verification |
| `@nestjs/passport` | Authentication strategies |
| `@nestjs/platform-socket.io` | WebSocket support |
| `@nestjs/swagger` | Auto-generated API docs |
| `@nestjs/event-emitter` | Cross-module event communication |
| `@nestjs/throttler` | Rate limiting |
| `@prisma/client` | Database ORM |
| `bcrypt` | Password hashing |
| `class-validator` | DTO validation |
| `helmet` | HTTP security headers |
| `ioredis` | Redis client |
| `passport-jwt` | JWT auth strategy |
| `socket.io` | Real-time communication |
| `winston` | Structured logging |
| `zod` | Schema validation (shared) |
| `resend` | Transactional emails |

### Frontend (`apps/web`) — Planned

| Package | Purpose |
|---------|---------|
| `react` | UI library |
| `@tanstack/react-router` | Type-safe routing |
| `@tanstack/react-query` | Server state management |
| `tailwindcss` | Utility-first CSS |
| `shadcn/ui` | Component library |
| `socket.io-client` | WebSocket client |
| `zustand` | Client state (minimal) |
| `zod` | Form validation (shared schemas) |

### Mobile (`apps/mobile`) — Planned

| Package | Purpose |
|---------|---------|
| `expo` | React Native framework |
| `expo-router` | File-based routing |
| `@tanstack/react-query` | Server state |
| `socket.io-client` | Real-time updates |
| `expo-notifications` | Push notifications |
| `expo-camera` | QR code scanning |

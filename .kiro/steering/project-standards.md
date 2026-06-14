# Queue Management System — Project Standards

## Overview

This is a multi-tenant SaaS Queue Management System built as a monorepo using Turborepo + pnpm workspaces.

## Tech Stack

| Layer          | Tech                                                                                 | Version                            |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| Frontend (Web) | React + TanStack Router + TypeScript + Tailwind CSS + shadcn/ui (Base UI primitives) | React 19.x, TanStack Router latest |
| Backend        | NestJS + TypeScript + Prisma                                                         | NestJS 11.x, Prisma 7.x            |
| WebSocket      | Socket.io (NestJS Gateway)                                                           | Socket.io 4.8.x                    |
| Database       | PostgreSQL                                                                           | 16+                                |
| Cache          | Redis                                                                                | 7+                                 |
| Auth           | Passport.js + JWT + bcrypt                                                           | Custom implementation              |
| Storage        | Cloudflare R2                                                                        |                                    |
| Email          | Resend                                                                               |                                    |
| Logging        | Winston + Sentry                                                                     |                                    |
| Testing        | Jest + Supertest (backend), Vitest (frontend)                                        |                                    |
| API Docs       | Swagger/OpenAPI (auto-generated)                                                     |                                    |
| Mobile         | React Native (Expo SDK 56)                                                           | RN 0.85, React 19.2                |
| Monorepo       | Turborepo 2.6 + pnpm                                                                 |                                    |
| Deploy         | Docker + GitHub Actions + Railway                                                    |                                    |

## Monorepo Structure

```
queue-system/
├── apps/
│   ├── web/              ← React frontend (Owner, Admin, Staff)
│   ├── api/              ← NestJS backend + Socket.io
│   └── mobile/           ← React Native Expo (Customer)
├── packages/
│   ├── shared-types/     ← TypeScript interfaces & enums
│   ├── shared-validation/← Zod schemas (shared between FE & BE)
│   └── shared-constants/ ← Enums, config values, error codes
├── docker/
│   ├── Dockerfile.api
│   └── docker-compose.yml
├── .github/
│   └── workflows/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## Naming Conventions

### Files & Folders

- **Folders:** kebab-case (`queue-ticket/`, `staff-assignment/`)
- **TypeScript files:** kebab-case (`queue-ticket.service.ts`, `create-organization.dto.ts`)
- **React components:** PascalCase file (`QueueStatus.tsx`, `StaffPanel.tsx`)
- **Constants/enums:** UPPER_SNAKE_CASE for values (`TICKET_STATUS.WAITING`)

### Code

- **Variables & functions:** camelCase (`getNextTicket`, `ticketNumber`)
- **Classes & interfaces:** PascalCase (`QueueTicket`, `IQueueService`)
- **Enums:** PascalCase name, UPPER_SNAKE_CASE values
- **Database tables:** snake_case (`queue_tickets`, `staff_assignments`)
- **Database columns:** snake_case (`created_at`, `org_id`)
- **API routes:** kebab-case (`/api/v1/queue-tickets`, `/api/v1/staff-assignments`)

### NestJS Specific

- **Modules:** `*.module.ts`
- **Controllers:** `*.controller.ts`
- **Services:** `*.service.ts`
- **Repositories:** `*.repository.ts`
- **DTOs:** `create-*.dto.ts`, `update-*.dto.ts`
- **Entities:** `*.entity.ts`
- **Guards:** `*.guard.ts`
- **Interceptors:** `*.interceptor.ts`
- **Filters:** `*.filter.ts`
- **Gateways:** `*.gateway.ts`

## Git Conventions

### Branch Naming

- `main` — production
- `develop` — staging
- `feat/feature-name` — new features
- `fix/bug-description` — bug fixes
- `chore/task-description` — maintenance
- `hotfix/critical-fix` — production hotfix

### Commit Messages (Conventional Commits)

```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

Scope examples: `auth`, `queue`, `organization`, `staff`, `display`, `mobile`, `web`

Examples:

- `feat(queue): add call-next endpoint`
- `fix(auth): handle expired refresh token`
- `chore(docker): update postgres version`

## Architecture Patterns

### Backend (NestJS)

1. **Module pattern** — each feature is a NestJS module
2. **Controller → Service → Repository** — clear separation
3. **DTOs** — validate all input with class-validator decorators
4. **Custom exceptions** — domain-specific errors extend HttpException
5. **Event-driven** — use NestJS EventEmitter for cross-module communication
6. **Guards** — JWT auth + role-based access control
7. **Interceptors** — response transformation, logging

### Frontend (React)

1. **Feature-based structure** — group by feature, not by type
2. **Custom hooks** — extract business logic into hooks
3. **TanStack Router** — file-based routing with type-safe params
4. **TanStack Query** — server state management
5. **Zustand** — client state (minimal usage)
6. **Component composition** — prefer composition over inheritance

## API Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "TICKET_NOT_FOUND",
    "message": "Queue ticket not found",
    "details": {}
  }
}
```

## TypeScript Rules

- Strict mode enabled (`"strict": true`)
- No `any` type — use `unknown` if type is uncertain
- Always define return types for functions
- Use interfaces for object shapes, types for unions/intersections
- Prefer `const` over `let`
- No unused variables or imports

## Error Handling

- All errors go through NestJS exception filters
- Use custom exception classes per domain
- Log errors with context (request ID, user ID, org ID)
- Never expose internal errors to client — return safe error messages

## Security Standards

- Helmet middleware for HTTP headers
- CORS whitelist (no wildcard in production)
- Rate limiting on all endpoints
- Input validation on ALL endpoints (no exceptions)
- Bcrypt with 12 rounds for password hashing
- JWT access token: 15 minutes expiry
- JWT refresh token: 7 days expiry, stored in Redis
- No sensitive data in JWT payload
- SQL injection prevention via Prisma parameterized queries

## Environment Variables

- Use `.env` files (never commit to git)
- Provide `.env.example` with all required variables
- Validate env vars on app startup (fail fast)
- Different configs: `.env.development`, `.env.staging`, `.env.production`

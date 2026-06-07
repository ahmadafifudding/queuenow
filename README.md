# Queue Management System

A multi-tenant SaaS Queue Management System for clinics, banks, restaurants, and any organization that needs to manage customer queues.

## Tech Stack

- **Frontend:** React 19 + TanStack Router + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** NestJS 11 + TypeScript + Prisma 7
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **Realtime:** Socket.io (via NestJS Gateway)
- **Mobile:** React Native (Expo SDK 56)
- **Monorepo:** Turborepo + pnpm

## Project Structure

```
queue-system/
├── apps/
│   ├── api/          # NestJS backend
│   ├── web/          # React frontend (staff/admin)
│   └── mobile/       # React Native (customer app)
├── packages/
│   ├── shared-types/       # TypeScript interfaces & enums
│   ├── shared-validation/  # Zod schemas
│   └── shared-constants/   # Error codes, plan limits, defaults
├── docker/
│   ├── Dockerfile.api
│   └── docker-compose.yml
└── .github/workflows/
```

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 10
- Docker & Docker Compose (for local DB & Redis)

### Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd queue-system

# 2. Install dependencies
pnpm install

# 3. Start PostgreSQL and Redis
cd docker && docker compose up -d && cd ..

# 4. Copy environment variables
cp apps/api/.env.example apps/api/.env

# 5. Run database migrations
pnpm db:migrate

# 6. Generate Prisma client
pnpm db:generate

# 7. Start development
pnpm dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run tests |
| `pnpm format` | Format code with Prettier |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:studio` | Open Prisma Studio (DB viewer) |

### API Documentation

When running in development, Swagger docs available at:
```
http://localhost:4000/docs
```

## Architecture

### Modules

| Module | Description |
|--------|-------------|
| Auth | Registration, login, JWT, OAuth |
| Organization | CRUD, settings, branding |
| Service | Queue services management |
| Counter | Counter management |
| Staff | Invite, manage staff |
| Queue | Core queue logic (join, call, skip, complete) |
| Display | TV display data |
| Customer | Mobile app customer features |
| Notification | Push notifications |
| QR Code | QR code generation |

### Roles

| Role | Access |
|------|--------|
| Super Admin | System-wide management |
| Owner | Full org control |
| Admin | Org management (except billing) |
| Staff | Serve queue |
| Customer | Join queue, view status |

## License

Private - All rights reserved.

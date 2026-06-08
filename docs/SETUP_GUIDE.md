# QueueNow — Setup Guide (From Scratch)

This guide walks you through setting up the entire QueueNow project from scratch on your local machine.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22+ | JavaScript runtime |
| pnpm | 10+ | Package manager |
| Docker Desktop | Latest | PostgreSQL + Redis containers |
| Git | Latest | Version control |

---

## Step 1: Install Node.js 22

```bash
# Using nvm (recommended)
nvm install 22
nvm use 22
node --version    # v22.x.x
```

Or download from: https://nodejs.org

---

## Step 2: Enable pnpm

```bash
# pnpm is included via Corepack (built into Node.js)
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version    # 10.x.x
```

---

## Step 3: Install Global Tools

```bash
# Turborepo CLI
pnpm add -g turbo

# NestJS CLI
pnpm add -g @nestjs/cli

# Verify
turbo --version   # 2.x.x
nest --version    # 11.x.x
```

---

## Step 4: Install Docker Desktop

1. Download from: https://www.docker.com/products/docker-desktop/
2. Install and start Docker Desktop
3. Verify:

```bash
docker --version           # Docker 27.x+
docker compose version     # v2.x+
```

---

## Step 5: Create Monorepo

### Option A: Using create-turbo (quickest)

```bash
npx create-turbo@latest queuenow
# Select: pnpm as package manager
cd queuenow
```

Then clean up the template files and restructure.

### Option B: Manual (recommended for this project)

```bash
# Create project directory
mkdir queuenow && cd queuenow

# Initialize
pnpm init

# Create workspace file
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

# Create directory structure
mkdir -p apps packages docs docker .github/workflows

# Install turbo as dev dependency
pnpm add -D turbo typescript prettier
```

---

## Step 6: Configure Turborepo

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

---

## Step 7: Configure TypeScript Base

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 8: Create NestJS Backend

```bash
cd apps

# Generate NestJS project
nest new api --package-manager pnpm --strict

cd api

# Rename in package.json: "name": "@queuenow/api"
```

### Install backend dependencies:

```bash
# Core NestJS packages
pnpm add @nestjs/config @nestjs/jwt @nestjs/passport @nestjs/platform-socket.io @nestjs/websockets @nestjs/swagger @nestjs/event-emitter @nestjs/throttler

# Database
pnpm add prisma @prisma/client

# Auth
pnpm add bcrypt passport passport-jwt passport-google-oauth20

# Utilities
pnpm add class-transformer class-validator helmet ioredis socket.io rxjs zod winston resend reflect-metadata

# Dev dependencies
pnpm add -D @types/bcrypt @types/passport-jwt @types/passport-google-oauth20 @types/express

cd ../..
```

---

## Step 9: Initialize Prisma

```bash
cd apps/api

# Init Prisma with PostgreSQL
npx prisma init --datasource-provider postgresql

cd ../..
```

This creates:
- `apps/api/prisma/schema.prisma`
- `apps/api/.env`

Copy the full schema from `apps/api/prisma/schema.prisma` in this repo.

---

## Step 10: Setup Docker (PostgreSQL + Redis)

Create `docker/compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: queuenow-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: queuenow
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: queuenow-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

### Start containers:

```bash
cd docker
docker compose up -d
docker compose ps    # Verify both healthy
cd ..
```

---

## Step 11: Configure Environment Variables

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

```env
# Application
NODE_ENV=development
PORT=4000
API_PREFIX=api/v1

# Database (matches Docker compose)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/queuenow?schema=public

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (generate your own secrets!)
JWT_ACCESS_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Step 12: Create Shared Packages

```bash
# shared-types
mkdir -p packages/shared-types/src
cd packages/shared-types
pnpm init
# Edit package.json: "name": "@queuenow/shared-types", "main": "./src/index.ts"
cd ../..

# shared-validation
mkdir -p packages/shared-validation/src
cd packages/shared-validation
pnpm init
# Edit package.json: "name": "@queuenow/shared-validation", "main": "./src/index.ts"
pnpm add zod
cd ../..

# shared-constants
mkdir -p packages/shared-constants/src
cd packages/shared-constants
pnpm init
# Edit package.json: "name": "@queuenow/shared-constants", "main": "./src/index.ts"
cd ../..
```

Add workspace references in `apps/api/package.json`:
```json
{
  "dependencies": {
    "@queuenow/shared-types": "workspace:*",
    "@queuenow/shared-validation": "workspace:*",
    "@queuenow/shared-constants": "workspace:*"
  }
}
```

Then:
```bash
pnpm install
```

---

## Step 13: Run Database Migration

```bash
cd apps/api

# Create tables
npx prisma migrate dev --name init

# Generate TypeScript client
npx prisma generate

cd ../..
```

---

## Step 14: Add Root Scripts

Edit root `package.json`:

```json
{
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "test": "turbo test",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "clean": "turbo clean && rm -rf node_modules",
    "db:generate": "pnpm --filter @queuenow/api exec prisma generate",
    "db:migrate": "pnpm --filter @queuenow/api exec prisma migrate dev",
    "db:push": "pnpm --filter @queuenow/api exec prisma db push",
    "db:studio": "pnpm --filter @queuenow/api exec prisma studio"
  }
}
```

---

## Step 15: Run The Application

```bash
# Make sure Docker is running
docker compose -f docker/compose.yml ps

# Start API
pnpm --filter @queuenow/api start:dev

# Or start everything via turbo
pnpm dev
```

Expected:
```
🚀 Application is running on: http://localhost:4000/api/v1
📚 Swagger docs: http://localhost:4000/docs
```

---

## Step 16: Verify

```bash
# Test register
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@klinik.com",
    "password": "Password123!",
    "fullName": "Dr. Ahmad",
    "organizationName": "Klinik ABC",
    "organizationType": "CLINIC"
  }'
```

Open Swagger: http://localhost:4000/docs

---

## Everyday Workflow

```bash
# Start (morning)
cd docker && docker compose up -d && cd ..
pnpm dev

# Stop (end of day)
docker compose -f docker/compose.yml down
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `pnpm: command not found` | `corepack enable` |
| Port 5432 in use | `sudo service postgresql stop` or change port in compose.yml |
| Port 6379 in use | `sudo service redis-server stop` |
| Prisma migration fails | Ensure Docker PostgreSQL is running |
| Module not found | `pnpm install` from root |
| Permission denied (Docker) | Run Docker Desktop, or add user to docker group |
| `Cannot connect to database` | Check DATABASE_URL in .env matches compose.yml |

---

## References

- Turborepo Docs: https://turbo.build/docs/getting-started
- NestJS Docs: https://docs.nestjs.com
- Prisma Docs: https://www.prisma.io/docs
- Docker Compose: https://docs.docker.com/compose/
- pnpm Workspaces: https://pnpm.io/workspaces
- Socket.io + NestJS: https://docs.nestjs.com/websockets/gateways

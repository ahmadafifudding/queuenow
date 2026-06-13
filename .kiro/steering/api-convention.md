---
inclusion: fileMatch
fileMatchPattern: "apps/api/**"
---

# API Conventions

## Project Structure

- Monorepo: Turborepo with pnpm
- API: NestJS 11 + TypeScript + Prisma + Socket.IO
- Database package: `@queuenow/db` (workspace dependency)
- Runtime: tsx (dev), tsc + node (production)

## Module Pattern

- Each feature has: module, controller, service, dto/ folder
- DTOs use class-validator decorators for validation
- Services handle business logic, controllers handle HTTP concerns
- Export services that are consumed by other modules
- Module file: `feature.module.ts`, not mixed with service files

## Auth Architecture

- Two user types: Staff (User model) and Customer (CustomerProfile model)
- Separate JWT strategies/tokens for each
- Staff token payload: `{ sub, orgId, role, type: "staff" }`
- Customer token payload: `{ sub, type: "customer" }`
- `IAuthenticatedUser` for staff endpoints, `IAuthenticatedCustomer` for customer endpoints
- WebSocket: hybrid auth (token optional, anonymous = read-only)

## Naming

- Files: kebab-case (`queue-ticket.service.ts`)
- Classes: PascalCase (`QueueService`)
- Methods: camelCase (`joinQueue`)
- Database columns: snake_case via `@map()` in Prisma schema
- API routes: kebab-case (`/queue-tickets`)
- DTOs: PascalCase with suffix (`CreateServiceDto`, `UpdateProfileDto`)

## API Design

- Global prefix: `api/v1`
- Use proper HTTP methods: GET (read), POST (create), PATCH (update), DELETE (remove)
- Return 201 for creation, 200 for success, 204 for no-content deletes
- Pagination: use `limit` and `offset` query params
- Always include Swagger decorators: `@ApiTags`, `@ApiOperation`, `@ApiParam`, `@ApiBearerAuth`

## Real-time (WebSocket)

- Namespace: `/queue`
- Rooms: `org:{orgId}`, `org:{orgId}:service:{serviceId}`, `ticket:{ticketId}`
- Events: `queue:update`, `queue:ticket-called`, `ticket:update`, `ticket:notification`
- Anonymous clients can subscribe (display screens, customer tracking)
- Authenticated clients get full scope

# Code Standards

## Production Readiness

- Write production-ready code. No placeholder TODOs, no incomplete implementations.
- Always search for latest documentation before writing code for any library.
- Prefer official documentation over blog posts or outdated examples.
- Every feature must be complete — error handling, edge cases, validation included.

## TypeScript

- Strict mode enabled — no `any` types, no type assertions unless absolutely necessary.
- Use `verbatimModuleSyntax` — use `import type` for type-only imports.
- Target ES2022, module ESNext, bundler resolution.
- Prefer `satisfies` over type assertions where possible.

## NestJS Patterns

- All services must use `@Injectable()` decorator.
- All guards must properly implement their logic (never return `true` unconditionally).
- Use appropriate HTTP exceptions: 401 for auth failures, 403 for authorization, 404 for not found, 409 for conflicts.
- Always add `@Param()`, `@Body()`, `@CurrentUser()` decorators — never leave parameters undecorated.
- Route parameters use colon syntax: `@Get(":id")` not `@Get("id")`.
- Controllers handle HTTP concerns only — business logic belongs in services.

## Security

- Never log sensitive data (tokens, passwords, secrets, PII).
- All authenticated endpoints must use `JwtAuthGuard`.
- Role-restricted endpoints must use both `JwtAuthGuard` and `RolesGuard` with `@Roles()`.
- Use `@Public()` decorator explicitly for unauthenticated endpoints.
- Validate and sanitize all user inputs.

## Database (Prisma)

- Use transactions for multi-step operations that must be atomic.
- Always validate entity existence before update/delete operations.
- Use `findMany` for list endpoints, never `findFirst` when expecting multiple results.
- Add proper indexes for frequently queried fields.
- Use pagination for all list endpoints.

## Error Handling

- Use NestJS built-in exceptions (never throw plain `Error`).
- Provide meaningful error messages.
- Return consistent response shapes via the global transform interceptor.

## Code Style

- Sort imports alphabetically.
- Group: external packages first, then internal modules.
- Use descriptive variable and method names.
- Add JSDoc comments for public service methods.

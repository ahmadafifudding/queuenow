# Deployment

QueueNow deploys as **four** runtime pieces:

| Piece      | What                          | Source                                |
| ---------- | ----------------------------- | ------------------------------------- |
| PostgreSQL | Primary database              | managed (Railway/RDS/etc.)            |
| Redis      | Cache / realtime support      | managed (Railway/Upstash/etc.)        |
| **API**    | NestJS + Socket.io server     | `docker/Dockerfile.api` → port `4000` |
| **Web**    | React/Vite SPA (static+nginx) | `docker/Dockerfile.web` → port `80`   |

> The Display/Kiosk/Track surfaces are part of the Web app (same build).

## Images

Both Dockerfiles are multi-stage and build from the repo root context.

```bash
# API
docker build -f docker/Dockerfile.api -t queuenow-api .

# Web — Vite inlines env at BUILD time, so the prod URLs are build args:
docker build -f docker/Dockerfile.web \
  --build-arg VITE_API_URL=https://api.YOURDOMAIN.com/api/v1 \
  --build-arg VITE_WS_URL=https://api.YOURDOMAIN.com \
  -t queuenow-web .
```

## API environment variables

Set these on the API service (see `apps/api/.env.example` for the full list):

- `DATABASE_URL` — managed Postgres connection string
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — **strong random secrets**
- `NODE_ENV=production`, `PORT=4000`, `API_PREFIX=api/v1`
- `APP_BASE_URL` — the Web app's public URL (e.g. `https://app.YOURDOMAIN.com`)
- `CORS_ORIGINS` — comma-separated; include the Web app origin
- Optional integrations: `GOOGLE_*`, `R2_*`, `RESEND_*`, `SENTRY_DSN`

> `NODE_ENV=production` makes the refresh cookie `Secure` — the API must be
> served over HTTPS, and the Web app must call it cross-origin with
> `credentials: 'include'` (already wired). Ensure `CORS_ORIGINS` lists the Web
> origin or auth cookies will be blocked.

## Database migrations

Run on each release **before** the new API starts (one-off, not in the image
CMD so multiple instances don't race):

```bash
pnpm --filter @queuenow/db migrate:deploy
```

The API image includes the schema + Prisma CLI, so this can be a Railway
"pre-deploy"/release command, or `docker run --rm queuenow-api pnpm --filter @queuenow/db migrate:deploy`.

## Railway (suggested)

1. Create a project; add the **PostgreSQL** and **Redis** plugins.
2. **API service** → deploy from repo using `docker/Dockerfile.api`.
   - Set env vars above (reference the Postgres/Redis plugin vars for
     `DATABASE_URL` / `REDIS_*`).
   - Pre-deploy command: `pnpm --filter @queuenow/db migrate:deploy`.
   - Expose port `4000`; give it a public domain (e.g. `api.YOURDOMAIN.com`).
3. **Web service** → deploy from repo using `docker/Dockerfile.web`.
   - Build args `VITE_API_URL` / `VITE_WS_URL` = the API's public URL.
   - Serves on port `80`; give it a public domain (e.g. `app.YOURDOMAIN.com`).
4. Set the API's `APP_BASE_URL` + `CORS_ORIGINS` to the Web domain, redeploy.
5. Smoke test: register an org, create a service/counter, call next, open the
   Display/Kiosk/Track URLs.

## Notes

- Web env is **baked at build time** — changing the API URL requires a Web
  rebuild, not just a restart.
- `apps/web` types are generated from the API Swagger
  (`pnpm --filter @queuenow/web generate:api`); the committed `schema.d.ts` is
  used at build time, so no live API is needed to build the Web image.

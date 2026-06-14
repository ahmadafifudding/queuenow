# Plan Limit Enforcement — UAT / Demo Checklist (R10)

This checklist walks a tester through every plan-limit enforcement behavior end to end,
including direct API calls without the web app. Work through each section in order and tick
each `- [ ]` box once the **Expected result** is observed.

The API is the authoritative enforcement boundary; the web app only mirrors it. Every
rejection below returns the standard error envelope with HTTP **403** and
`error.code = "PLAN_LIMIT_EXCEEDED"`.

---

## Prerequisites

- [ ] Postgres and Redis are running (e.g. `docker compose -f docker/docker-compose.yml up -d`).
- [ ] Backend API is running: `pnpm --filter @queuenow/api start:dev`
      (listens on `http://localhost:4000`, global prefix `api/v1` → base URL
      `http://localhost:4000/api/v1`).
- [ ] Web app is running: `pnpm --filter @queuenow/web dev`.
- [ ] A REST client is available (`curl`, Postman, or the Swagger UI at `http://localhost:4000/docs`).
- [ ] A fresh test organization exists. New orgs default to the **FREE** plan, which is the
      tightest tier and ideal for verifying allow-then-reject boundaries.

### Create a test organization + OWNER and capture the access token

Registering an owner also creates the organization (defaults to FREE):

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "owner@uat-demo.com",
    "password": "SecurePassword123!",
    "fullName": "UAT Owner",
    "organizationName": "UAT Demo Org",
    "organizationType": "CLINIC"
  }'
```

To authenticate later (or in a fresh session), log in:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ "email": "owner@uat-demo.com", "password": "SecurePassword123!" }'
```

- [ ] From the register/login response, record the **OWNER bearer token** (`data.accessToken`)
      and the **organization id** (`data.user.orgId` / `data.organization.id`). The steps below
      assume these shell variables are exported:

```bash
export TOKEN="<accessToken from the response>"
export ORG="<organization id from the response>"
export BASE="http://localhost:4000/api/v1"
```

> Tip: log in through the web app with the same credentials to drive the UI-based steps.

---

## PLAN_LIMITS reference table

These are the expected boundaries the tester verifies against (`null` = unlimited):

| Plan       | maxServices | maxCounters | maxQueuePerDay | maxStaff  | tvDisplay | analytics |
| ---------- | ----------- | ----------- | -------------- | --------- | --------- | --------- |
| FREE       | 1           | 1           | 30             | 2         | no        | no        |
| BASIC      | 3           | 3           | unlimited      | 5         | yes       | no        |
| PRO        | unlimited   | unlimited   | unlimited      | unlimited | yes       | yes       |
| ENTERPRISE | unlimited   | unlimited   | unlimited      | unlimited | yes       | yes       |

> `maxStaff` counts existing members **plus** pending invitations (an invite consumes a seat).

---

## Manual plan-change call (used for upgrades/downgrades)

The interim upgrade path is OWNER-only:

```bash
curl -s -X PATCH "$BASE/organizations/$ORG/plan" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "plan": "BASIC" }'
```

- Valid `plan` values: `FREE`, `BASIC`, `PRO`, `ENTERPRISE`.
- Non-OWNER → `AUTH_FORBIDDEN`; unauthenticated → `AUTH_UNAUTHORIZED`; invalid plan →
  `VALIDATION_ERROR`; unknown org → `ORG_NOT_FOUND`.
- A successful change returns the updated organization whose `plan` equals the target, and
  applies the new limits to every enforcement decision made afterward.

---

## R10.1 — Per-resource allow-then-reject at the limit (FREE plan)

Verify that, for each Limited_Resource, creation is permitted while usage `<` limit and rejected
with `PLAN_LIMIT_EXCEEDED` once usage `>=` limit. Start on **FREE**.

### Services (`maxServices = 1`)

- [ ] Create service #1 → **201 Created**.

```bash
curl -s -X POST "$BASE/organizations/$ORG/services" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "name": "Consultation", "prefix": "A" }'
```

- [ ] Create service #2 (over limit) → **403** with `error.code = "PLAN_LIMIT_EXCEEDED"`.

```bash
curl -s -X POST "$BASE/organizations/$ORG/services" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "name": "Registration", "prefix": "B" }'
```

### Counters (`maxCounters = 1`)

- [ ] Create counter #1 (use the service id from above as `serviceId`) → **201 Created**.

```bash
curl -s -X POST "$BASE/organizations/$ORG/counters" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "serviceId": "<SERVICE_ID>", "name": "Counter 1" }'
```

- [ ] Create counter #2 (over limit) → **403** `PLAN_LIMIT_EXCEEDED`.

### Staff (`maxStaff = 2`, OWNER already consumes 1 seat)

- [ ] Invite staff member #1 → **201 Created** (total seats now 2).

```bash
curl -s -X POST "$BASE/organizations/$ORG/staff/invite" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "email": "staff1@uat-demo.com", "role": "STAFF" }'
```

- [ ] Invite staff member #2 (over limit, would be the 3rd seat) → **403** `PLAN_LIMIT_EXCEEDED`.

### Daily queue volume (`maxQueuePerDay = 30`)

- [ ] Join the queue 30 times within the current day (org timezone) → each of the first 30
      returns **201 Created**. (Public endpoint, no token needed; reuse an active service id.)

```bash
curl -s -X POST "$BASE/organizations/$ORG/queue/join" \
  -H 'Content-Type: application/json' \
  -d '{ "serviceId": "<SERVICE_ID>", "customerName": "Tester", "customerPhone": "+60123456789" }'
```

- [ ] The 31st join attempt → **403** `PLAN_LIMIT_EXCEEDED`.
- [ ] Cancel/complete one of the existing tickets, then join again → still **403**
      (created tickets count toward the daily volume regardless of later status changes).

---

## R10.2 — `null` ⇒ unlimited / "Unlimited" display

- [ ] Upgrade the org to **PRO** via the plan-change call (`{ "plan": "PRO" }`).
- [ ] Create several services well beyond the FREE/BASIC numeric limits (e.g. 5+) → every create
      returns **201 Created** (no upper bound, since `maxServices` is `null` on PRO).
- [ ] In the web app, open the **Plan & Usage** view → the services / counters / queue-per-day /
      staff limits display **"Unlimited"** rather than a number.

---

## R10.3 — Upgrade then create up to the new limit

- [ ] Set the org back to **FREE** (`{ "plan": "FREE" }`) so `maxServices = 1`.
- [ ] Confirm a 2nd service create is rejected with **403** `PLAN_LIMIT_EXCEEDED` (limit reached).
- [ ] Upgrade to **BASIC** via the plan-change call (`{ "plan": "BASIC" }`) → **200**, returned
      org `plan` equals `BASIC`.
- [ ] Now create services up to the new limit of **3** total → creates succeed until 3 exist.
- [ ] The 4th service create → **403** `PLAN_LIMIT_EXCEEDED` (new BASIC limit enforced).

---

## R10.4 — TV Display gating on/off

The TV Display surface is public and resolves the org from the `:orgId` route param.

- [ ] Set the org to **FREE** (`tvDisplay = false`).
- [ ] Request the display board → **403** `PLAN_LIMIT_EXCEEDED`, no display data returned.

```bash
curl -s "$BASE/organizations/$ORG/display"
```

- [ ] In the web app (FREE), confirm the TV Display navigation/entry point is hidden (OWNER sees
      an upgrade entry in its place).
- [ ] Upgrade to **BASIC** or **PRO** (`tvDisplay = true`) via the plan-change call.
- [ ] Request the display board again → **200** with display data.
- [ ] In the web app, confirm the TV Display navigation/entry point is now visible.

---

## R10.5 — Analytics gating on/off

The analytics surface (org stats) requires authentication, then checks the `analytics` flag.

- [ ] Set the org to **BASIC** (`analytics = false`).
- [ ] Request analytics → **403** `PLAN_LIMIT_EXCEEDED`, no analytics data returned.

```bash
curl -s "$BASE/organizations/$ORG/stats" -H "Authorization: Bearer $TOKEN"
```

- [ ] Call the same endpoint **without** a token → **401** `AUTH_UNAUTHORIZED` (auth is checked
      before the feature gate).
- [ ] In the web app (BASIC), confirm the Analytics navigation/entry point is hidden (OWNER sees
      an upgrade entry in its place).
- [ ] Upgrade to **PRO** (`analytics = true`) via the plan-change call.
- [ ] Request analytics again with the token → **200** with analytics data.
- [ ] In the web app, confirm the Analytics navigation/entry point is now visible.

---

## R10.6 — Downgrade grandfathering + reject + re-permit after deletion

- [ ] Start on **BASIC** and create **3** services (the BASIC max).
- [ ] Downgrade to **FREE** (`{ "plan": "FREE" }`, `maxServices = 1`) via the plan-change call.
- [ ] List services → all **3** existing services are still present (grandfathered: nothing is
      deleted, deactivated, or modified by the downgrade).

```bash
curl -s "$BASE/organizations/$ORG/services" -H "Authorization: Bearer $TOKEN"
```

- [ ] Confirm the grandfathered services remain readable and updatable (e.g. PATCH one of them
      succeeds).
- [ ] Attempt to create a new service → **403** `PLAN_LIMIT_EXCEEDED` (usage 3 ≥ limit 1).
- [ ] Delete services until only **0** remain (usage now below the FREE limit of 1).

```bash
curl -s -X DELETE "$BASE/organizations/$ORG/services/<SERVICE_ID>" \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] Create a new service → **201 Created** (creation re-permitted once usage `<` limit).

---

## R10.7 — Direct API over-limit returns PLAN_LIMIT_EXCEEDED + HTTP 403 (no UI)

Verify the rejection contract using only the API (curl/Postman), with no web app involved.

- [ ] Ensure the org is on **FREE** and already at the services limit (1 service exists).
- [ ] Issue a direct create call that exceeds the limit and inspect the status + body:

```bash
curl -s -i -X POST "$BASE/organizations/$ORG/services" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "name": "Over Limit Service", "prefix": "Z" }'
```

- [ ] The HTTP status line is **`HTTP/1.1 403 Forbidden`**.
- [ ] The response body matches the error envelope shape:

```json
{
  "success": false,
  "error": {
    "code": "PLAN_LIMIT_EXCEEDED",
    "message": "<non-empty message>",
    "details": {
      "limitName": "maxServices",
      "limit": 1,
      "currentUsage": 1,
      "plan": "FREE"
    }
  }
}
```

- [ ] `success` is `false`, `error.code` is exactly `"PLAN_LIMIT_EXCEEDED"`, and `error.details`
      includes the offending `limitName`, the numeric `limit`, the `currentUsage`, and the current
      `plan` name.

---

## Sign-off

- [ ] R10.1 per-resource allow-then-reject verified (services, counters, staff, daily queue).
- [ ] R10.2 unlimited (`null`) creation + "Unlimited" display verified.
- [ ] R10.3 upgrade-then-create-up-to-new-limit verified.
- [ ] R10.4 TV Display gating off → 403, on → allowed.
- [ ] R10.5 Analytics gating off → 403, on → allowed (unauthenticated → 401).
- [ ] R10.6 downgrade grandfathering + reject + re-permit after deletion verified.
- [ ] R10.7 direct API over-limit returns `PLAN_LIMIT_EXCEEDED` + HTTP 403.

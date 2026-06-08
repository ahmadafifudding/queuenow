# QueueNow — API Design

## Base URL

```
/api/v1
```

## Authentication

- Staff/Admin/Owner: JWT Bearer token in `Authorization` header
- Customer: Separate JWT Bearer token (different payload)
- Public endpoints: No auth required (marked with 🔓)

## Response Format

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

### Error
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

---

## 1. Auth Module (Staff/Admin/Owner)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Register owner + create org | 🔓 Public |
| POST | `/auth/login` | Login with email/password | 🔓 Public |
| POST | `/auth/google` | Google OAuth login | 🔓 Public |
| POST | `/auth/refresh` | Refresh access token | 🔓 Public |
| POST | `/auth/logout` | Revoke refresh token | 🔒 Auth |
| POST | `/auth/forgot-password` | Send reset email | 🔓 Public |
| POST | `/auth/reset-password` | Reset with token | 🔓 Public |
| POST | `/auth/verify-email` | Verify email | 🔓 Public |
| POST | `/auth/accept-invite` | Accept staff invitation | 🔓 Public (with token) |

---

## 2. Organization Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | `/organizations/:id` | Get org details | Owner, Admin |
| PATCH | `/organizations/:id` | Update org | Owner, Admin |
| DELETE | `/organizations/:id` | Delete org | Owner |
| GET | `/organizations/:id/stats` | Get today's statistics | Owner, Admin |
| PATCH | `/organizations/:id/branding` | Update branding | Owner, Admin |
| GET | `/organizations/:id/settings` | Get queue settings | Owner, Admin |
| PATCH | `/organizations/:id/settings` | Update queue settings | Owner, Admin |

---

## 3. Service Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/organizations/:orgId/services` | Create service | Owner, Admin |
| GET | `/organizations/:orgId/services` | List all services | Owner, Admin, Staff |
| GET | `/organizations/:orgId/services/:id` | Get service details | Owner, Admin, Staff |
| PATCH | `/organizations/:orgId/services/:id` | Update service | Owner, Admin |
| DELETE | `/organizations/:orgId/services/:id` | Delete service | Owner, Admin |

---

## 4. Counter Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/organizations/:orgId/counters` | Create counter | Owner, Admin |
| GET | `/organizations/:orgId/counters` | List all counters | Owner, Admin, Staff |
| GET | `/organizations/:orgId/counters/:id` | Get counter | Owner, Admin, Staff |
| PATCH | `/organizations/:orgId/counters/:id` | Update counter | Owner, Admin |
| DELETE | `/organizations/:orgId/counters/:id` | Delete counter | Owner, Admin |

---

## 5. Staff Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/organizations/:orgId/staff/invite` | Invite staff | Owner, Admin |
| GET | `/organizations/:orgId/staff` | List all staff | Owner, Admin |
| GET | `/organizations/:orgId/staff/invitations` | List pending invites | Owner, Admin |
| DELETE | `/organizations/:orgId/staff/:userId` | Remove staff | Owner, Admin |
| DELETE | `/organizations/:orgId/staff/invitations/:id` | Cancel invitation | Owner, Admin |

---

## 6. Staff Assignment Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/organizations/:orgId/assignments` | Assign self to counter | Staff |
| GET | `/organizations/:orgId/assignments/active` | Get active assignments | Owner, Admin, Staff |
| DELETE | `/organizations/:orgId/assignments/:id` | Release counter | Staff, Admin |

---

## 7. Queue Module ⭐ (Core)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/organizations/:orgId/queue/join` | Join queue | 🔓 Public |
| GET | `/organizations/:orgId/queue/status` | Get queue status | 🔓 Public |
| GET | `/organizations/:orgId/queue/ticket/:ticketId` | Get ticket status | 🔓 Public |
| POST | `/organizations/:orgId/queue/call-next` | Call next (FIFO) | 🔒 Staff |
| POST | `/organizations/:orgId/queue/:ticketId/recall` | Recall customer | 🔒 Staff |
| POST | `/organizations/:orgId/queue/:ticketId/skip` | Skip customer | 🔒 Staff |
| POST | `/organizations/:orgId/queue/:ticketId/complete` | Complete serving | 🔒 Staff |
| POST | `/organizations/:orgId/queue/:ticketId/rejoin` | Rejoin after skip | 🔒 Staff |
| DELETE | `/organizations/:orgId/queue/:ticketId` | Leave queue (cancel) | 🔓 Public |
| POST | `/organizations/:orgId/queue/reset` | Manual reset | 🔒 Owner, Admin |
| GET | `/organizations/:orgId/queue/history` | Today's history | 🔒 Staff, Admin |

---

## 8. Display Module

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/organizations/:orgId/display` | Get display data | 🔓 Public |
| GET | `/organizations/:orgId/display/now-serving` | Currently serving | 🔓 Public |
| GET | `/organizations/:orgId/display/branding` | Branding info | 🔓 Public |

---

## 9. Customer Module (Mobile App)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/customers/register` | Customer sign up | 🔓 Public |
| POST | `/customers/login` | Customer login | 🔓 Public |
| POST | `/customers/auth/google` | Google OAuth | 🔓 Public |
| GET | `/customers/profile` | Get profile | 🔒 Customer |
| PATCH | `/customers/profile` | Update profile | 🔒 Customer |
| DELETE | `/customers/profile` | Delete account | 🔒 Customer |
| GET | `/customers/history` | Queue history | 🔒 Customer |
| GET | `/customers/favorites` | Favorite orgs | 🔒 Customer |
| POST | `/customers/favorites/:orgId` | Add favorite | 🔒 Customer |
| DELETE | `/customers/favorites/:orgId` | Remove favorite | 🔒 Customer |

---

## 10. Organization Discovery (Mobile App)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/discover/organizations` | Search/list orgs | 🔓 Public |
| GET | `/discover/organizations/:slug` | Get org public info | 🔓 Public |
| GET | `/discover/categories` | List org categories | 🔓 Public |

---

## 11. Notification Module

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/notifications/push-token` | Register FCM token | 🔒 Customer |
| GET | `/notifications` | Get notifications | 🔒 Customer |
| PATCH | `/notifications/:id/read` | Mark as read | 🔒 Customer |

---

## 12. QR Code Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | `/organizations/:orgId/qr-code` | Get org QR URL | Owner, Admin |
| GET | `/organizations/:orgId/qr-code/services/:serviceId` | Get service QR URL | Owner, Admin |

---

## 13. Super Admin Module

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | `/admin/organizations` | List all orgs | Super Admin |
| GET | `/admin/organizations/:id` | Get org details | Super Admin |
| PATCH | `/admin/organizations/:id/status` | Activate/deactivate | Super Admin |
| GET | `/admin/stats` | System-wide stats | Super Admin |
| GET | `/admin/users` | List all users | Super Admin |

---

## WebSocket Events

### Connection

```
Namespace: /queue
URL: ws://localhost:4000/queue
```

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{ orgId, serviceId? }` | Join org/service room |
| `unsubscribe` | `{ orgId, serviceId? }` | Leave room |
| `subscribe:ticket` | `{ ticketId }` | Subscribe to specific ticket |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `queue:update` | `{ type, ticket }` | Queue status changed |
| `queue:ticket-called` | `{ ticketNumber, counterName, serviceName }` | Ticket called (for display) |
| `ticket:update` | `{ type, ticket }` | Specific ticket update |
| `ticket:notification` | `{ type, message }` | Customer notification |
| `subscribed` | `{ room, message }` | Subscription confirmed |

### Queue Update Types

```typescript
type: 'TICKET_JOINED'     // New customer joined
    | 'TICKET_CALLED'     // Staff called next
    | 'TICKET_RECALLED'   // Staff recalled
    | 'TICKET_SKIPPED'    // Staff skipped
    | 'TICKET_COMPLETED'  // Staff completed
    | 'TICKET_REJOINED'   // Skipped customer rejoined
```

---

## JWT Token Structure

### Staff/Admin/Owner Token

```json
{
  "sub": "user-uuid",
  "orgId": "org-uuid",
  "role": "OWNER|ADMIN|STAFF",
  "type": "staff",
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Customer Token

```json
{
  "sub": "customer-uuid",
  "type": "customer",
  "iat": 1234567890,
  "exp": 1234567890
}
```

---

## Rate Limiting

| Scope | Limit |
|-------|-------|
| Global | 60 requests/minute per IP |
| Auth endpoints | 5 requests/minute per IP |
| Queue join | 10 requests/minute per device |

---

## Pagination

Query params for list endpoints:

```
?page=1&limit=20&sort=createdAt&order=desc
```

Response meta:
```json
{
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

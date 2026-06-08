# QueueNow — Database Schema

## Overview

- **Database:** PostgreSQL 16+
- **ORM:** Prisma 7.x
- **Total Tables:** 16
- **Schema File:** `apps/api/prisma/schema.prisma`

---

## Tables Summary

| # | Table | Purpose |
|---|-------|---------|
| 1 | `organizations` | Organization/tenant data |
| 2 | `organization_branding` | Logo, colors, QR text |
| 3 | `users` | Staff, Admin, Owner accounts |
| 4 | `user_roles` | Role assignment per org |
| 5 | `invitations` | Pending staff invites |
| 6 | `services` | Queue services (e.g., Consultation, Pharmacy) |
| 7 | `counters` | Physical counters per service |
| 8 | `staff_assignments` | Which staff at which counter |
| 9 | `queue_tickets` | Core — every queue ticket |
| 10 | `queue_settings` | Per-org queue configuration |
| 11 | `daily_queue_counters` | Daily number tracking (performance) |
| 12 | `customer_profiles` | Mobile app customer accounts |
| 13 | `customer_favorites` | Customer favorite organizations |
| 14 | `notifications` | Push notification records |
| 15 | `sessions` | Staff/Admin refresh tokens |
| 16 | `customer_sessions` | Customer refresh tokens |
| 17 | `audit_logs` | Action audit trail |

---

## Entity Relationship Diagram

```
organizations ─┬── services ─── counters
               │       │           │
               │       │     staff_assignments ── users
               │       │                           │
               │       └── queue_tickets ───────────┘
               │               │
               │         customer_profiles
               │               │
               ├── organization_branding    customer_favorites
               ├── queue_settings
               ├── daily_queue_counters
               ├── invitations
               ├── audit_logs
               └── user_roles ── users
```

---

## Table Details

### 1. `organizations`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| name | VARCHAR(255) | NOT NULL | "Klinik ABC" |
| slug | VARCHAR(100) | UNIQUE, NOT NULL | URL-safe identifier |
| type | ENUM | NOT NULL | CLINIC, BANK, RESTAURANT, GOVERNMENT, OTHER |
| address | TEXT | NULLABLE | Physical address |
| phone | VARCHAR(20) | NULLABLE | |
| email | VARCHAR(255) | NULLABLE | |
| plan | ENUM | DEFAULT 'FREE' | FREE, BASIC, PRO, ENTERPRISE |
| owner_id | UUID | FK → users | Quick reference to owner |
| timezone | VARCHAR(50) | DEFAULT 'Asia/Kuala_Lumpur' | For correct reset time |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | AUTO | |

### 2. `organization_branding`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations, UNIQUE | 1:1 with org |
| logo_url | VARCHAR(500) | NULLABLE | Uploaded logo URL |
| primary_color | VARCHAR(7) | DEFAULT '#3B82F6' | Hex color |
| qr_text | VARCHAR(255) | DEFAULT 'Scan to join queue' | Text on QR printout |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

### 3. `users`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| email | VARCHAR(255) | UNIQUE, NOT NULL | |
| password_hash | VARCHAR(255) | NULLABLE | NULL if Google OAuth |
| full_name | VARCHAR(255) | NOT NULL | |
| phone | VARCHAR(20) | NULLABLE | |
| avatar_url | VARCHAR(500) | NULLABLE | |
| provider | ENUM | DEFAULT 'EMAIL' | EMAIL, GOOGLE |
| email_verified | BOOLEAN | DEFAULT false | |
| is_active | BOOLEAN | DEFAULT true | |
| last_login_at | TIMESTAMP | NULLABLE | |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

### 4. `user_roles`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| user_id | UUID | FK → users | |
| org_id | UUID | FK → organizations | |
| role | ENUM | NOT NULL | OWNER, ADMIN, STAFF |
| assigned_service_id | UUID | FK → services, NULLABLE | Staff assigned to specific service |
| created_at | TIMESTAMP | | |

**Index:** UNIQUE(user_id, org_id) — 1 role per org per user

### 5. `invitations`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations | |
| email | VARCHAR(255) | NOT NULL | Invited email |
| role | ENUM | NOT NULL | ADMIN, STAFF |
| service_id | UUID | FK → services, NULLABLE | Assign to service |
| invited_by_id | UUID | FK → users | Who invited |
| token | VARCHAR(255) | UNIQUE | Invitation token |
| status | ENUM | DEFAULT 'PENDING' | PENDING, ACCEPTED, EXPIRED |
| expires_at | TIMESTAMP | NOT NULL | 7 days from creation |
| created_at | TIMESTAMP | | |

### 6. `services`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations | |
| name | VARCHAR(255) | NOT NULL | "Consultation" |
| prefix | VARCHAR(3) | NOT NULL | "A", "B", "C" |
| is_active | BOOLEAN | DEFAULT true | |
| sort_order | INTEGER | DEFAULT 0 | Display order |
| max_queue_per_day | INTEGER | NULLABLE | NULL = unlimited |
| avg_serving_time | INTEGER | DEFAULT 5 | Minutes |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

**Index:** UNIQUE(org_id, prefix) — no duplicate prefix per org

### 7. `counters`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations | |
| service_id | UUID | FK → services | |
| name | VARCHAR(100) | NOT NULL | "Counter 1" |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

### 8. `staff_assignments`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| user_id | UUID | FK → users | |
| counter_id | UUID | FK → counters | |
| org_id | UUID | FK → organizations | |
| assigned_at | TIMESTAMP | DEFAULT NOW() | |
| released_at | TIMESTAMP | NULLABLE | NULL = currently active |

**Rule:** 1 staff = 1 counter at a time. Auto-release on logout.

### 9. `queue_tickets` ⭐ (Core Table)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations | |
| service_id | UUID | FK → services | |
| counter_id | UUID | FK → counters, NULLABLE | Assigned when called |
| ticket_number | VARCHAR(10) | NOT NULL | "A-007" |
| daily_number | INTEGER | NOT NULL | Sequential number for the day |
| status | ENUM | DEFAULT 'WAITING' | WAITING, CALLED, SERVING, COMPLETED, SKIPPED |
| customer_name | VARCHAR(255) | NULLABLE | Optional |
| customer_phone | VARCHAR(20) | NULLABLE | Optional |
| customer_profile_id | UUID | FK → customer_profiles, NULLABLE | If using mobile app |
| device_fingerprint | VARCHAR(255) | NULLABLE | Abuse prevention |
| called_by_id | UUID | FK → users, NULLABLE | Staff who called |
| completed_by_id | UUID | FK → users, NULLABLE | Staff who completed |
| called_at | TIMESTAMP | NULLABLE | |
| serving_at | TIMESTAMP | NULLABLE | |
| completed_at | TIMESTAMP | NULLABLE | |
| skipped_at | TIMESTAMP | NULLABLE | |
| recall_count | INTEGER | DEFAULT 0 | Max 2 |
| is_rejoin | BOOLEAN | DEFAULT false | Rejoined after skip |
| created_at | TIMESTAMP | DEFAULT NOW() | Joined queue time |

**Index:** INDEX(org_id, service_id, status, created_at) — fast queue queries

### 10. `queue_settings`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations, UNIQUE | 1:1 |
| reset_time | TIME | DEFAULT '00:00' | Daily reset time |
| max_recall | INTEGER | DEFAULT 2 | Max recall attempts |
| require_name | BOOLEAN | DEFAULT false | |
| require_phone | BOOLEAN | DEFAULT false | |
| custom_fields | JSONB | NULLABLE | Extra fields config (max 3) |
| auto_skip_timeout | INTEGER | NULLABLE | Minutes before auto-skip |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

### 11. `daily_queue_counters`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations | |
| service_id | UUID | FK → services | |
| date | DATE | | |
| last_number | INTEGER | DEFAULT 0 | Last issued ticket number |
| total_served | INTEGER | DEFAULT 0 | |
| total_skipped | INTEGER | DEFAULT 0 | |

**Index:** UNIQUE(org_id, service_id, date) — one row per service per day

### 12. `customer_profiles`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| email | VARCHAR(255) | UNIQUE, NULLABLE | |
| phone | VARCHAR(20) | NULLABLE | |
| full_name | VARCHAR(255) | NULLABLE | |
| password_hash | VARCHAR(255) | NULLABLE | |
| provider | ENUM | DEFAULT 'EMAIL' | EMAIL, GOOGLE |
| avatar_url | VARCHAR(500) | NULLABLE | |
| push_token | VARCHAR(500) | NULLABLE | FCM token |
| is_active | BOOLEAN | DEFAULT true | |
| last_login_at | TIMESTAMP | NULLABLE | |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

### 13. `customer_favorites`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| customer_id | UUID | FK → customer_profiles | |
| org_id | UUID | FK → organizations | |
| created_at | TIMESTAMP | | |

**Index:** UNIQUE(customer_id, org_id)

### 14. `notifications`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| ticket_id | UUID | FK → queue_tickets | |
| customer_id | UUID | FK → customer_profiles, NULLABLE | |
| type | ENUM | NOT NULL | YOUR_TURN, ALMOST_TURN, SKIPPED |
| status | ENUM | DEFAULT 'PENDING' | PENDING, SENT, FAILED |
| sent_at | TIMESTAMP | NULLABLE | |
| created_at | TIMESTAMP | | |

### 15. `sessions` (Staff/Admin)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| user_id | UUID | FK → users | |
| refresh_token | VARCHAR(500) | UNIQUE | |
| device_info | VARCHAR(500) | NULLABLE | |
| expires_at | TIMESTAMP | NOT NULL | |
| created_at | TIMESTAMP | | |

### 16. `customer_sessions`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| customer_id | UUID | FK → customer_profiles | |
| refresh_token | VARCHAR(500) | UNIQUE | |
| device_info | VARCHAR(500) | NULLABLE | |
| expires_at | TIMESTAMP | NOT NULL | |
| created_at | TIMESTAMP | | |

### 17. `audit_logs`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| org_id | UUID | FK → organizations | |
| user_id | UUID | FK → users, NULLABLE | |
| action | VARCHAR(100) | NOT NULL | e.g., "ticket.called", "service.created" |
| entity_type | VARCHAR(50) | NOT NULL | e.g., "ticket", "service" |
| entity_id | UUID | NOT NULL | |
| metadata | JSONB | NULLABLE | Extra context |
| created_at | TIMESTAMP | | |

**Index:** INDEX(org_id, created_at)

---

## Ticket Status Flow

```
WAITING → CALLED → SERVING → COMPLETED
                ↘ SKIPPED
                ↘ RECALLED (stays CALLED, increment recall_count)
```

## Data Retention

| Data | Retention |
|------|-----------|
| Customer queue history | 90 days |
| Organization analytics | 1 year |
| Audit logs | 1 year |
| Expired sessions | Auto-deleted |
| Customer account deletion | Within 7 days (Apple requirement) |

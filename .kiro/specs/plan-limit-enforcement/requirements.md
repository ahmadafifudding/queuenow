# Requirements Document

## Introduction

QueueNow is a multi-tenant SaaS Queue Management System. Plan tiers (`FREE`, `BASIC`, `PRO`, `ENTERPRISE`) and their limits already exist in `packages/shared-constants/src/index.ts` (`PLAN_LIMITS`), but nothing reads them: a `FREE` org can currently create unlimited resources and access plan-only surfaces. This feature makes the backend enforce those limits as the security boundary, gates plan-only features (TV Display, analytics), grandfathers resources that already exceed a limit after a downgrade, and provides a manual plan-change mechanism (OWNER-only) as the interim upgrade path until Stripe billing is built. The web app mirrors enforcement by surfacing the current plan, per-resource usage versus limit, and an upgrade prompt, and by hiding feature-gated surfaces. A UAT/demo checklist lets a tester verify every behavior.

Enforcement is the security boundary on the backend; the UI only mirrors it, consistent with the existing RBAC convention.

## Glossary

- **API**: The QueueNow NestJS backend application (`apps/api`) that owns all enforcement and is the authoritative security boundary.
- **Web_App**: The QueueNow React frontend (`apps/web`) used by Owner, Admin, and Staff roles.
- **Organization**: A tenant of QueueNow. Each Organization has exactly one assigned Plan.
- **Plan**: One of the defined tiers `FREE`, `BASIC`, `PRO`, or `ENTERPRISE`, each mapping to a `PLAN_LIMITS` entry.
- **Plan_Limit**: A named quota or feature flag for a Plan defined in `PLAN_LIMITS`: `maxServices`, `maxCounters`, `maxStaff`, `maxQueuePerDay`, `tvDisplay`, `analytics`.
- **Numeric_Limit**: A `Plan_Limit` whose value is a number (e.g. `maxServices`) or `null`. A value of `null` means the resource is unlimited for that Plan.
- **Feature_Flag**: A boolean `Plan_Limit` (`tvDisplay`, `analytics`) that enables or disables access to a plan-only surface.
- **Limited_Resource**: A resource type governed by a `Numeric_Limit`: Service (`maxServices`), Counter (`maxCounters`), Staff_Member (`maxStaff`), or Daily_Queue_Volume (`maxQueuePerDay`).
- **Current_Usage**: The count of existing instances of a Limited_Resource for an Organization, measured at the moment of a create attempt. For Daily_Queue_Volume, the count of queue tickets created for the Organization during the current calendar day in the Organization's timezone.
- **Daily_Queue_Volume**: The number of queue tickets created for an Organization within the current calendar day in the Organization's timezone, governed by `maxQueuePerDay`.
- **TV_Display**: The TV Display surface (public display board) governed by the `tvDisplay` Feature_Flag.
- **Analytics**: The analytics features and endpoints governed by the `analytics` Feature_Flag.
- **PLAN_LIMIT_EXCEEDED**: A new error code added to `ERROR_CODES` in `packages/shared-constants`, returned when a request is rejected for exceeding a Numeric_Limit or for accessing a surface whose Feature_Flag is `false`.
- **OWNER**: The `UserRoleType.OWNER` role for an Organization.
- **Plan_Change_Request**: A request to the manual plan-change endpoint to set an Organization's Plan to a target Plan value.
- **Reset_Time**: The Organization's configured daily reset time (`resetTime`, default `00:00` per `QUEUE_DEFAULTS.RESET_TIME`) in the Organization's timezone, marking the start of each Daily_Queue_Volume window.
- **Error_Response**: The standard error envelope `{ "success": false, "error": { "code": ..., "message": ..., "details": ... } }`.

## Requirements

### Requirement 1: Enforce numeric resource limits on creation

**User Story:** As a platform operator, I want the API to reject creating resources beyond the org's plan limit, so that plan tiers are meaningful and orgs have a reason to upgrade.

#### Acceptance Criteria

1. WHEN an authorized user requests creation of a Limited_Resource AND the matching Numeric_Limit is a number AND the Current_Usage for that Limited_Resource measured at the moment of the create attempt is strictly less than the Numeric_Limit, THE API SHALL create the resource and SHALL increase the Current_Usage of that Limited_Resource by exactly one.
2. WHEN an authorized user requests creation of a Limited_Resource AND the matching Numeric_Limit is a number AND the Current_Usage for that Limited_Resource measured at the moment of the create attempt is greater than or equal to the Numeric_Limit, THE API SHALL reject the request with error code `PLAN_LIMIT_EXCEEDED` and SHALL NOT create the resource.
3. WHEN the API rejects a create request with error code `PLAN_LIMIT_EXCEEDED`, THE API SHALL leave the Current_Usage of that Limited_Resource unchanged.
4. WHERE the matching Numeric_Limit for a Limited_Resource is `null`, THE API SHALL create the resource regardless of Current_Usage.
5. THE API SHALL apply Requirement 1 enforcement to Service creation using `maxServices`, Counter creation using `maxCounters`, and Staff_Member addition using `maxStaff`.
6. WHEN two or more create requests for the same Limited_Resource of the same Organization are processed concurrently while the Current_Usage is equal to the Numeric_Limit minus one, THE API SHALL evaluate the Current_Usage check and the resulting create within a single atomic transaction such that the resulting Current_Usage never exceeds the Numeric_Limit, and SHALL reject each excess request with error code `PLAN_LIMIT_EXCEEDED`.

### Requirement 2: Enforce daily queue volume limit

**User Story:** As a platform operator, I want the API to cap daily queue ticket creation on limited plans, so that high-volume usage requires an upgrade.

#### Acceptance Criteria

1. WHEN a queue ticket creation is requested AND `maxQueuePerDay` is a number AND the Daily_Queue_Volume for the Organization is less than `maxQueuePerDay`, THE API SHALL create the queue ticket.
2. WHEN a queue ticket creation is requested AND `maxQueuePerDay` is a number AND the Daily_Queue_Volume for the Organization is greater than or equal to `maxQueuePerDay`, THE API SHALL reject the request with error code `PLAN_LIMIT_EXCEEDED` and SHALL NOT create the queue ticket.
3. WHERE `maxQueuePerDay` is `null`, THE API SHALL create the queue ticket regardless of Daily_Queue_Volume.
4. THE API SHALL measure Daily_Queue_Volume over the window beginning at the Organization's Reset_Time in its timezone and ending at the next occurrence of the Reset_Time.
5. WHEN a queue ticket is created during the current Daily_Queue_Volume window, THE API SHALL count it toward Daily_Queue_Volume regardless of any subsequent cancellation, completion, or deletion of that ticket.

### Requirement 3: Feature-gate TV Display

**User Story:** As a platform operator, I want plan-only surfaces blocked for orgs whose plan disallows them, so that feature gating is enforced server-side.

#### Acceptance Criteria

1. WHERE an Organization resolved from the requested `orgId` has a Plan with `tvDisplay` equal to `false`, THE API SHALL deny access to the TV_Display surface for that Organization with error code `PLAN_LIMIT_EXCEEDED` and SHALL return no display board data.
2. WHERE an Organization resolved from the requested `orgId` has a Plan with `tvDisplay` equal to `true`, THE API SHALL permit access to the TV_Display surface for that Organization.
3. THE API SHALL evaluate the `tvDisplay` Feature_Flag identically for authenticated requests and for public requests that identify the Organization by `orgId`.
4. IF a TV_Display request specifies an `orgId` that does not resolve to an existing Organization, THEN THE API SHALL reject the request with error code `ORG_NOT_FOUND`.

### Requirement 4: Feature-gate Analytics

**User Story:** As a platform operator, I want analytics restricted to plans that include it, so that analytics is a paid differentiator.

#### Acceptance Criteria

1. WHERE an authenticated user's Organization has a Plan with `analytics` equal to `false`, THE API SHALL deny access to Analytics endpoints for that Organization with error code `PLAN_LIMIT_EXCEEDED` and SHALL return no analytics data.
2. WHERE an authenticated user's Organization has a Plan with `analytics` equal to `true`, THE API SHALL permit access to Analytics endpoints for that Organization.
3. IF an unauthenticated request is made to an Analytics endpoint, THEN THE API SHALL reject the request with error code `AUTH_UNAUTHORIZED`.

### Requirement 5: Grandfather existing resources after downgrade

**User Story:** As an org owner who downgrades, I want to keep the resources I already created, so that a downgrade never destroys my data.

#### Acceptance Criteria

1. WHEN an Organization's Plan changes such that the Current_Usage of a Limited_Resource exceeds the new Numeric_Limit, THE API SHALL retain all existing instances of that Limited_Resource and SHALL NOT delete, deactivate, or modify them as a result of the Plan change.
2. WHILE the Current_Usage of a Limited_Resource is greater than or equal to its Numeric_Limit, THE API SHALL reject new creation of that Limited_Resource with error code `PLAN_LIMIT_EXCEEDED` and SHALL leave the Current_Usage unchanged.
3. WHILE the Current_Usage of a Limited_Resource exceeds its Numeric_Limit, THE API SHALL keep all existing instances of that Limited_Resource readable, updatable, and operationally usable.
4. WHEN an Organization's Plan changes to a Plan whose Feature_Flag for a surface is `false`, THE API SHALL retain the existing configuration data for that surface unchanged and SHALL deny only access to the surface.
5. WHEN an Organization's Plan changes to a Plan whose Feature_Flag for a surface is `true`, THE API SHALL restore access to that surface using the retained configuration data without data loss.
6. WHEN the Current_Usage of a Limited_Resource is reduced below its Numeric_Limit by deleting instances, THE API SHALL permit creation of that Limited_Resource while the Current_Usage remains less than the Numeric_Limit.

### Requirement 6: Manual plan-change endpoint

**User Story:** As an org owner, I want an endpoint to change my organization's plan, so that I can upgrade or be moved between tiers before Stripe billing exists and testers can demo every tier.

#### Acceptance Criteria

1. WHEN a user with the OWNER role for the target Organization submits a Plan_Change_Request with a target Plan that differs from the Organization's current Plan AND the target Plan is one of `FREE`, `BASIC`, `PRO`, or `ENTERPRISE`, THE API SHALL set the Organization's Plan to the target Plan and SHALL return the updated Organization whose Plan equals the target Plan.
2. IF a user without the OWNER role for the target Organization submits a Plan_Change_Request, THEN THE API SHALL reject the request with error code `AUTH_FORBIDDEN` and SHALL leave the Organization's Plan unchanged.
3. IF an unauthenticated request is made to the manual plan-change endpoint, THEN THE API SHALL reject the request with error code `AUTH_UNAUTHORIZED` and SHALL leave the Organization's Plan unchanged.
4. IF a Plan_Change_Request specifies a target Plan that is not one of `FREE`, `BASIC`, `PRO`, or `ENTERPRISE`, THEN THE API SHALL reject the request with error code `VALIDATION_ERROR` and SHALL leave the Organization's Plan unchanged.
5. IF a Plan_Change_Request targets an Organization that does not exist, THEN THE API SHALL reject the request with error code `ORG_NOT_FOUND`.
6. WHEN a user with the OWNER role submits a Plan_Change_Request whose target Plan equals the Organization's current Plan, THE API SHALL return the unchanged Organization without error.
7. WHEN an Organization's Plan is changed, THE API SHALL apply the target Plan's Plan_Limits to every enforcement decision evaluated after the Plan change is persisted.

### Requirement 7: Consistent PLAN_LIMIT_EXCEEDED error response

**User Story:** As a frontend developer, I want plan-limit rejections to use a single consistent error code and response shape, so that the Web_App can detect them reliably and prompt the user to upgrade.

#### Acceptance Criteria

1. THE API SHALL define `PLAN_LIMIT_EXCEEDED` as a value in `ERROR_CODES` within `packages/shared-constants`.
2. WHEN the API rejects a request for exceeding a Numeric_Limit or for a disabled Feature_Flag, THE API SHALL return an Error_Response with `success` equal to `false`, `error.code` equal to `PLAN_LIMIT_EXCEEDED`, and a non-empty `error.message` string.
3. WHEN the API returns a `PLAN_LIMIT_EXCEEDED` Error_Response for exceeding a Numeric_Limit, THE API SHALL include in `error.details` the Plan_Limit name that was exceeded, the Numeric_Limit value as a number, and the Current_Usage value as a number.
4. WHEN the API returns a `PLAN_LIMIT_EXCEEDED` Error_Response for a disabled Feature_Flag, THE API SHALL include in `error.details` the Feature_Flag name (`tvDisplay` or `analytics`) and SHALL omit the Numeric_Limit and Current_Usage values.
5. WHEN the API returns a `PLAN_LIMIT_EXCEEDED` Error_Response, THE API SHALL include in `error.details` the Organization's current Plan name.
6. WHEN the API returns a `PLAN_LIMIT_EXCEEDED` Error_Response, THE API SHALL set the HTTP status code to 403.

### Requirement 8: Surface plan and usage in the Web App

**User Story:** As an org owner, I want to see my current plan and usage against each limit, so that I know how close I am to each limit and when to upgrade.

#### Acceptance Criteria

1. WHEN a user opens the plan and usage view, THE Web_App SHALL display the Organization's current Plan name.
2. WHEN a user opens the plan and usage view, THE Web_App SHALL display, for each Limited_Resource, the Current_Usage and its Numeric_Limit in the form "{usage} / {limit}".
3. WHERE a Numeric_Limit is `null`, THE Web_App SHALL display "Unlimited" in place of the numeric limit for that Limited_Resource.
4. WHEN the Current_Usage of a Limited_Resource is greater than or equal to its Numeric_Limit, THE Web_App SHALL display an upgrade prompt that identifies the affected Limited_Resource and provides an entry point to the manual plan-change action.
5. WHEN the API returns a `PLAN_LIMIT_EXCEEDED` Error_Response for a user action, THE Web_App SHALL display an upgrade prompt to the user and SHALL retain the user's unsaved input.
6. IF retrieving the plan and usage data fails, THEN THE Web_App SHALL display an error indication and SHALL NOT display usage values.

### Requirement 9: Mirror feature gates in the Web App

**User Story:** As a user on a limited plan, I want plan-only surfaces hidden in the UI, so that the interface reflects what my plan allows.

#### Acceptance Criteria

1. WHERE the Organization's Plan has `tvDisplay` equal to `false`, THE Web_App SHALL hide the navigation and entry points that open the TV_Display surface.
2. WHERE the Organization's Plan has `analytics` equal to `false`, THE Web_App SHALL hide the navigation and entry points that open the Analytics surface.
3. WHERE a Feature_Flag is `true`, THE Web_App SHALL show the navigation and entry points for the corresponding surface.
4. WHERE a Feature_Flag is `false` AND the current user has the OWNER role, THE Web_App SHALL show an upgrade entry point in place of the hidden surface's entry point.
5. THE Web_App SHALL rely on the API as the enforcement boundary for feature gating and SHALL NOT treat hiding navigation as access control.

### Requirement 10: UAT/demo verification checklist

**User Story:** As a tester, I want a checklist that walks through every enforcement behavior, so that I can verify the feature end to end including via the API without the UI.

#### Acceptance Criteria

1. THE UAT checklist SHALL include a step verifying that for each Limited_Resource (Service, Counter, Staff_Member, Daily_Queue_Volume) creation is permitted while Current_Usage is less than the Numeric_Limit and is rejected with `PLAN_LIMIT_EXCEEDED` once Current_Usage is greater than or equal to the Numeric_Limit.
2. THE UAT checklist SHALL include a step verifying that where a Numeric_Limit is `null`, creation of that Limited_Resource is permitted without an upper bound and the Web_App displays "Unlimited".
3. THE UAT checklist SHALL include a step verifying that after the Organization's Plan is changed via the manual plan-change endpoint to a Plan with a higher Numeric_Limit, creation is permitted up to the new Numeric_Limit.
4. THE UAT checklist SHALL include a step verifying that TV_Display access is permitted when `tvDisplay` is `true` and denied with `PLAN_LIMIT_EXCEEDED` when `tvDisplay` is `false`.
5. THE UAT checklist SHALL include a step verifying that Analytics access is permitted when `analytics` is `true` and denied with `PLAN_LIMIT_EXCEEDED` when `analytics` is `false`.
6. THE UAT checklist SHALL include a step verifying that downgrading a Plan retains existing resources that exceed the new Numeric_Limit, rejects new creation with `PLAN_LIMIT_EXCEEDED`, and re-permits creation after deletion drops Current_Usage below the Numeric_Limit.
7. THE UAT checklist SHALL include a step verifying that a direct API call (without the Web_App) to create an over-limit resource returns an Error_Response with `error.code` equal to `PLAN_LIMIT_EXCEEDED` and HTTP status code 403.

# Requirements Document

## Introduction

The Customer Mobile App is the customer-facing surface of the QueueNow multi-tenant SaaS Queue Management System. It is a new React Native (Expo) application that will live at `apps/mobile` and act purely as a consumer of the existing NestJS backend (`apps/api`) and its Socket.io real-time gateway. The Owner/Admin/Staff experience already exists in `apps/web`; this app serves end-user customers.

The customer journey covered by this app is: discover an organization or service (by scanning a QR code or entering a code), join a queue and receive a ticket number, track live position and estimated wait time in real time, be alerted when their turn is near or called, and — for customers who opt into an account — review ticket history and manage favorite organizations.

This document specifies requirements for the **requirements phase only**. The app MUST reuse the existing shared workspace packages (`packages/shared-types`, `packages/shared-validation`, `packages/shared-constants`) and the existing API contracts rather than inventing new backend behavior. Where the customer journey requires backend capabilities that do not yet exist, those gaps are captured explicitly as backend requirements (see Requirements 11–13).

### Scope decisions (confirmed)

- **Auth model:** Anonymous-first with an optional customer account. Joining a queue never requires sign-in; an account unlocks history and favorites.
- **Notifications:** In-app real-time updates (Socket.io) plus on-device local notifications scheduled from those updates. Remote push delivery (FCM/APNs) is called out as a backend dependency (Requirement 12) and is out of scope for the app's v1 turn-alert behavior.
- **Feature scope (v1):** Scan/enter organization → choose service → join → live ticket tracking → turn alerts → ticket history; plus optional account, favorites, and organization discovery.
- **Offline behavior:** Read-only cache of the active ticket with graceful reconnect. No offline mutations.
- **Platforms:** iOS and Android via Expo.

## Glossary

- **Mobile_App**: The customer-facing React Native (Expo) application at `apps/mobile`, the system under specification.
- **Backend_API**: The existing NestJS REST API at `apps/api`, base path `/api/v1`, returning the standard success/error envelope.
- **Realtime_Gateway**: The existing Socket.io gateway exposed by the backend on the `/queue` namespace.
- **Queue_Client**: The component of the Mobile_App that calls queue-related REST endpoints (join, status, ticket status).
- **Realtime_Client**: The component of the Mobile_App that maintains the Socket.io connection and subscriptions.
- **Notification_Manager**: The component of the Mobile_App that maps real-time events to on-device local notifications and an in-app notification list.
- **Auth_Manager**: The component of the Mobile_App that manages optional customer account sessions (access and refresh tokens) and secure token storage.
- **Customer**: An end user of an organization's queue; may be anonymous or a holder of a customer account.
- **Customer_Account**: A `CustomerProfile` record created via customer register/login, identified by email or phone.
- **Organization**: A tenant offering one or more queues; has an `id`, `slug`, `name`, and `type`.
- **Service**: A queue line within an Organization, identified by `serviceId`, with a `prefix` and `avgServingTime`.
- **Ticket**: A `QueueTicket` issued when a Customer joins a Service, carrying a `ticketNumber`, `status`, `position`, and `estimatedWaitMinutes`.
- **Ticket_Status**: One of the values defined in `shared-types` `TicketStatus`: `WAITING`, `CALLED`, `SERVING`, `COMPLETED`, `SKIPPED`.
- **Active_Ticket**: A Ticket held by the Customer on the current device whose status is `WAITING`, `CALLED`, or `SERVING`.
- **QR_Payload**: The encoded organization/service reference produced by the backend QR code feature and scanned by the Mobile_App.
- **Access_Token**: The short-lived (15 minute) customer JWT issued by customer login/register.
- **Refresh_Token**: The long-lived (30 day) customer JWT used to obtain a new Access_Token.
- **Shared_Packages**: The workspace packages `shared-types`, `shared-validation`, and `shared-constants`.
- **API_Error_Code**: A machine-readable error code from `shared-constants` `ERROR_CODES`.

## Requirements

### Requirement 1: Organization and Service Discovery

**User Story:** As a Customer, I want to find an organization and its services by scanning a QR code or entering a code, so that I can reach the right queue quickly.

#### Acceptance Criteria

1. WHEN a Customer scans a valid QR_Payload, THE Mobile_App SHALL resolve the referenced Organization and Service and display the available services for that Organization.
2. WHEN a Customer enters a valid Organization identifier manually, THE Mobile_App SHALL retrieve the Organization's active services via the Backend_API.
3. IF a scanned QR_Payload references an Organization that is inactive or not found, THEN THE Mobile_App SHALL display an error message and SHALL NOT present a join action.
4. WHERE an Organization exposes more than one active Service, THE Mobile_App SHALL require the Customer to select one Service before joining.
5. WHEN the Mobile_App requests organization or service data, THE Mobile_App SHALL use the data structures defined in Shared_Packages (`IOrganization`, `IService`).

### Requirement 2: Join a Queue and Receive a Ticket

**User Story:** As an anonymous Customer, I want to join a selected service's queue and receive a ticket number, so that I can hold my place without creating an account.

#### Acceptance Criteria

1. WHEN a Customer confirms joining a selected Service, THE Queue_Client SHALL call `POST /organizations/:orgId/queue/join` with the selected `serviceId`.
2. WHERE the Customer provides a name or phone number, THE Queue_Client SHALL include `customerName` and `customerPhone` in the join request.
3. THE Queue_Client SHALL include a stable `deviceFingerprint` value in the join request so that an anonymous Ticket can be re-associated with the device.
4. WHEN a join request succeeds, THE Mobile_App SHALL display the issued `ticketNumber`, the `position` returned by the Backend_API verbatim, and the `estimatedWaitMinutes` returned by the Backend_API, and SHALL NOT apply any client-side offset to the `position` value.
5. IF the Backend_API rejects a join with API_Error_Code `QUEUE_FULL`, THEN THE Mobile_App SHALL display the queue-full message derived from that error code and SHALL NOT issue or display a Ticket.
6. WHERE a Customer is signed in to a Customer_Account, THE Queue_Client SHALL include the `customerProfileId` in the join request so that the Ticket is linked to the account.
7. WHEN join request input is constructed, THE Queue_Client SHALL validate it against the corresponding Shared_Packages validation schema before sending.

### Requirement 3: Live Ticket Tracking

**User Story:** As a Customer holding a ticket, I want to see my live position and estimated wait time, so that I know how long I still need to wait.

#### Acceptance Criteria

1. WHILE the Customer holds an Active_Ticket, THE Mobile_App SHALL display the Ticket's current Ticket_Status, `position`, and `estimatedWaitMinutes`.
2. WHEN the Mobile_App opens an Active_Ticket view, THE Queue_Client SHALL fetch the current ticket state via `GET /organizations/:orgId/queue/ticket/:ticketId`.
3. WHEN the Realtime_Client receives a `ticket:update` event for the Active_Ticket, THE Mobile_App SHALL update the displayed Ticket_Status and position within 2 seconds of event receipt.
4. WHEN an Active_Ticket transitions to `CALLED`, THE Mobile_App SHALL display the assigned counter name returned by the Backend_API.
5. WHEN an Active_Ticket transitions to `COMPLETED` or `SKIPPED`, THE Mobile_App SHALL update the Ticket view to reflect the terminal status and SHALL stop presenting live position information.

### Requirement 4: Real-Time Queue Subscription

**User Story:** As a Customer, I want the app to stay connected to live queue updates, so that the information I see reflects the current state of the queue.

#### Acceptance Criteria

1. WHEN the Customer opens an Active_Ticket view, THE Realtime_Client SHALL connect to the Realtime_Gateway `/queue` namespace and emit a `subscribe:ticket` message for the Active_Ticket's `ticketId`.
2. WHILE viewing live queue status for a Service, THE Realtime_Client SHALL emit a `subscribe` message with the `orgId` and `serviceId`.
3. WHEN the Customer leaves a tracked view, THE Realtime_Client SHALL emit the corresponding `unsubscribe` message.
4. WHEN the Realtime_Gateway connection is lost, a network-change event occurs, or the Customer triggers a manual reconnect action, THE Realtime_Client SHALL attempt to reconnect to the Realtime_Gateway and re-issue active subscriptions upon reconnection.
5. IF reconnection succeeds but re-issuing active subscriptions fails, THEN THE Realtime_Client SHALL treat the reconnection as failed and SHALL retry the entire connect-and-resubscribe process using a bounded number of retries with exponential backoff.
6. THE Realtime_Client SHALL use the event names defined in Shared_Packages `WS_EVENTS` for all subscription and update handling.

### Requirement 5: Turn Notifications

**User Story:** As a Customer, I want to be alerted when my turn is near and when I am called, so that I do not miss my turn.

#### Acceptance Criteria

1. WHEN the Realtime_Client receives a `ticket:notification` event of type `ALMOST_TURN` for the Active_Ticket, THE Notification_Manager SHALL present an "almost your turn" local notification.
2. WHEN the Realtime_Client receives a `ticket:notification` event of type `YOUR_TURN` for the Active_Ticket, THE Notification_Manager SHALL present a "your turn" local notification that identifies the counter name.
3. WHEN the Realtime_Client receives a `ticket:notification` event of type `SKIPPED` for the Active_Ticket, THE Notification_Manager SHALL present a "ticket skipped" local notification.
4. WHEN the Realtime_Client receives a turn-related `ticket:notification` event for the Active_Ticket, THE Notification_Manager SHALL surface the corresponding turn alert in-app only in response to that event and SHALL NOT surface in-app turn alerts proactively.
5. WHERE local notification permission is denied AND the Mobile_App is in the foreground or active state, THE Notification_Manager SHALL surface the turn alert in-app via a persistent in-app banner, an audible alert, or both.
6. THE Notification_Manager SHALL use the notification type values defined in Shared_Packages `NotificationType`.
7. WHERE the Customer is signed in to a Customer_Account, THE Mobile_App SHALL retrieve the persisted notification list via `GET /notifications` and display it in reverse chronological order.

### Requirement 6: Optional Customer Account

**User Story:** As a Customer, I want to optionally create or sign in to an account, so that I can access history and favorites across devices.

#### Acceptance Criteria

1. WHERE a Customer chooses to register, THE Auth_Manager SHALL call `POST /customers/register` and store the returned Access_Token and Refresh_Token securely on the device.
2. WHERE a Customer chooses to sign in, THE Auth_Manager SHALL call `POST /customers/login` with email or phone and password and store the returned tokens securely on the device.
3. IF customer login fails authentication, THEN THE Mobile_App SHALL display an invalid-credentials message derived from the Backend_API error and SHALL NOT store any token.
4. WHILE a valid Access_Token is held, THE Auth_Manager SHALL attach the Access_Token as a Bearer credential on authenticated Backend_API requests.
5. IF attaching the Access_Token to an authenticated Backend_API request fails, THEN THE Mobile_App SHALL fail that API request and SHALL NOT send the request without the Access_Token.
6. WHEN a Customer signs out, THE Auth_Manager SHALL remove the stored Access_Token and Refresh_Token from the device.
7. THE Auth_Manager SHALL persist tokens using the device secure storage mechanism rather than plain application storage.
8. WHEN the Auth_Manager writes tokens to device secure storage, THE Auth_Manager SHALL confirm that the write succeeded before treating the Customer as signed in.
9. IF device secure storage is unavailable or a token write fails, THEN THE Auth_Manager SHALL surface an error and SHALL NOT treat the Customer as signed in.
10. WHEN account input is constructed, THE Auth_Manager SHALL validate it against the corresponding Shared_Packages validation schema before sending.

### Requirement 7: Ticket History

**User Story:** As a signed-in Customer, I want to view my past tickets, so that I can review where and when I queued.

#### Acceptance Criteria

1. WHERE the Customer is signed in to a Customer_Account, THE Mobile_App SHALL retrieve ticket history via `GET /customers/history`.
2. WHEN ticket history is displayed, THE Mobile_App SHALL show, for each entry, the Organization name, the Service name, the `ticketNumber`, and the Ticket_Status.
3. WHEN ticket history is displayed, THE Mobile_App SHALL order entries from most recent to least recent.
4. WHERE the Customer is not signed in, THE Mobile_App SHALL present an account prompt in place of history content and SHALL hide all ticket history content, including any history cached from a previous session.

### Requirement 8: Favorite Organizations

**User Story:** As a signed-in Customer, I want to save favorite organizations, so that I can rejoin their queues quickly.

#### Acceptance Criteria

1. WHERE the Customer is signed in, THE Mobile_App SHALL retrieve favorites via `GET /customers/favorites`.
2. WHEN a signed-in Customer marks an Organization as a favorite, THE Mobile_App SHALL call `POST /customers/favorites/:orgId`.
3. WHEN a signed-in Customer removes a favorite Organization, THE Mobile_App SHALL call `DELETE /customers/favorites/:orgId`.
4. WHILE the favorites list is displayed, THE Mobile_App SHALL show each favorite Organization's name and a view-services action for each favorite Organization.

### Requirement 9: Offline and Reconnect Behavior

**User Story:** As a Customer with an unreliable connection, I want my active ticket to remain visible offline, so that I keep my ticket details during brief outages.

#### Acceptance Criteria

1. WHEN the Mobile_App successfully loads an Active_Ticket, THE Mobile_App SHALL cache the Active_Ticket's last known details on the device.
2. WHILE the device has no network connectivity, THE Mobile_App SHALL display the cached Active_Ticket details together with an indicator that the data may be out of date.
3. WHEN network connectivity is restored, THE Queue_Client SHALL refresh the Active_Ticket from the Backend_API and THE Realtime_Client SHALL re-establish its subscriptions.
4. WHEN the Customer performs a manual refresh action on the Active_Ticket, THE Queue_Client SHALL refresh the Active_Ticket from the Backend_API.
5. WHILE the device has no network connectivity, THE Mobile_App SHALL disable actions that require a live request and SHALL present the reason the action is unavailable.

### Requirement 10: API Contract and Error Handling

**User Story:** As a Customer, I want clear feedback when something goes wrong, so that I understand what happened and what to do next.

#### Acceptance Criteria

1. WHEN the Mobile_App receives a Backend_API success response, THE Mobile_App SHALL read result data from the `data` field of the standard success envelope.
2. IF the Backend_API returns an error response, THEN THE Mobile_App SHALL display a message corresponding to the response's API_Error_Code.
3. IF a Backend_API request fails due to a network or timeout condition, THEN THE Mobile_App SHALL inform the Customer that the request could not be completed and SHALL allow the Customer to retry.
4. THE Mobile_App SHALL consume the API_Error_Code values from Shared_Packages `ERROR_CODES` rather than matching on error message text.
5. THE Mobile_App SHALL import shared TypeScript interfaces and enums from Shared_Packages rather than redefining equivalent types locally.

### Requirement 11: Leave or Cancel a Ticket (Backend Dependency)

**User Story:** As a Customer, I want to leave a queue I no longer need, so that my place is released and my view reflects that I left.

#### Acceptance Criteria

1. WHEN a Customer chooses to leave the queue for an Active_Ticket, THE Mobile_App SHALL request cancellation of that Ticket through a customer-facing Backend_API endpoint.
2. THE Backend_API SHALL provide a customer-accessible endpoint that transitions a Customer's own `WAITING` Ticket out of the active queue.
3. WHEN a cancellation succeeds, THE Mobile_App SHALL update the Ticket view to reflect that the Customer is no longer in the queue and SHALL stop live tracking for that Ticket.
4. IF a cancellation is attempted for a Ticket that is no longer `WAITING`, THEN THE Mobile_App SHALL display the resulting Backend_API error and SHALL refresh the Ticket state.

> Note: No customer-facing leave/cancel endpoint currently exists in `apps/api`. This capability requires a new backend endpoint and authorization check scoped to the Customer's own Ticket (by `customerProfileId` or `deviceFingerprint`).

### Requirement 12: Customer Token Refresh (Backend Dependency)

**User Story:** As a signed-in Customer, I want my session to continue without frequent re-login, so that I stay signed in across the token lifetime.

#### Acceptance Criteria

1. WHEN an authenticated Backend_API request is rejected because the Access_Token has expired, THE Auth_Manager SHALL request a new Access_Token using the stored Refresh_Token.
2. THE Backend_API SHALL provide a customer token-refresh endpoint that accepts a valid customer Refresh_Token and returns a new token pair.
3. WHEN a token refresh succeeds, THE Auth_Manager SHALL replace the stored tokens and SHALL retry the original request once.
4. IF a token refresh fails because the Refresh_Token is invalid or expired, THEN THE Auth_Manager SHALL clear stored tokens and SHALL return the Customer to the sign-in entry point.

> Note: `CustomerService` issues access and refresh tokens and stores `CustomerSession` records, but `apps/api` does not currently expose a customer refresh endpoint. This capability requires a new backend endpoint.

### Requirement 13: Push Notification Delivery (Backend Dependency)

**User Story:** As a Customer, I want to be alerted about my turn even when the app is closed, so that I do not miss my turn while multitasking.

#### Acceptance Criteria

1. WHERE the Customer is signed in and has granted notification permission, THE Mobile_App SHALL obtain a device push token and register it via `POST /notifications/push-token`.
2. THE Backend_API SHALL deliver `YOUR_TURN`, `ALMOST_TURN`, and `SKIPPED` notifications to a registered push token through a push provider.
3. WHEN the Mobile_App receives a delivered push notification for an Active_Ticket, THE Mobile_App SHALL open the corresponding Active_Ticket view when the Customer activates the notification.
4. IF a device push token is not successfully registered via `POST /notifications/push-token`, THEN push delivery for that device SHALL be unavailable and THE Mobile_App SHALL provide turn alerts through the in-app and foreground mechanisms defined in Requirement 5.

> Note: `NotificationService.sendNotification` records notifications and reads the stored `pushToken`, but actual FCM/APNs delivery is an unimplemented `TODO`. Background/closed-app turn alerts depend on completing this backend integration and on a successfully registered push token; no separate fallback delivery mechanism is required for v1. v1 turn-alert coverage is provided by the in-app and foreground alerts in Requirement 5.

### Requirement 14: Platform Support and Shared Package Reuse

**User Story:** As a product owner, I want the app built on the standardized mobile stack and shared packages, so that it stays consistent with the rest of the monorepo.

#### Acceptance Criteria

1. THE Mobile_App SHALL run on iOS and Android using the Expo runtime specified in the project standards.
2. THE Mobile_App SHALL reside at `apps/mobile` within the Turborepo workspace.
3. THE Mobile_App SHALL declare workspace dependencies on all three Shared_Packages (`shared-types`, `shared-validation`, and `shared-constants`).
4. THE Mobile_App SHALL require all three Shared_Packages to be present at build time and SHALL NOT build or run with only a subset of `shared-types`, `shared-validation`, and `shared-constants`.
5. THE Mobile_App SHALL NOT redefine queue, ticket, organization, notification, or error-code types that are already exported by Shared_Packages.

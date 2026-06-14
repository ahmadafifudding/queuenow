import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * English string catalog (default UI language for the MVP).
 *
 * All user-facing copy for the customer mobile app lives here so a second
 * language (e.g. MS) can be added later by providing a parallel catalog of the
 * same shape — no need to refactor components. Mirrors the web app's i18n
 * approach (`apps/web/src/i18n/en.ts`): we intentionally defer a full i18n
 * library until a second language is committed, but keep copy centralized.
 *
 * The `errors` map is keyed by the canonical `ERROR_CODES` values from
 * `@queuenow/shared-constants`. Typing it as `Record<ErrorCode, string>`
 * guarantees, at compile time, that every backend error code has friendly copy.
 * The error map is keyed ONLY on the code — never on backend message text — so
 * a new or unseen server code can never leak an internal message (R10.2/R10.4).
 */

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const errors: Record<ErrorCode, string> = {
  // Auth
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'The email or password you entered is incorrect.',
  [ERROR_CODES.AUTH_EMAIL_EXISTS]: 'An account with this email already exists.',
  [ERROR_CODES.AUTH_TOKEN_EXPIRED]: 'Your session has expired. Please sign in again.',
  [ERROR_CODES.AUTH_TOKEN_INVALID]: 'Your session is no longer valid. Please sign in again.',
  [ERROR_CODES.AUTH_UNAUTHORIZED]: 'Please sign in to continue.',
  [ERROR_CODES.AUTH_FORBIDDEN]: "You don't have permission to do that.",

  // Organization
  [ERROR_CODES.ORG_NOT_FOUND]: "We couldn't find that organization. Check the code and try again.",
  [ERROR_CODES.ORG_INACTIVE]: "This organization isn't accepting customers right now.",
  [ERROR_CODES.ORG_SLUG_EXISTS]: 'That organization address is already taken.',

  // Service
  [ERROR_CODES.SERVICE_NOT_FOUND]: "We couldn't find that service.",
  [ERROR_CODES.SERVICE_PREFIX_EXISTS]: 'That service prefix is already in use.',
  [ERROR_CODES.SERVICE_INACTIVE]: "This service isn't available right now.",

  // Counter
  [ERROR_CODES.COUNTER_NOT_FOUND]: "We couldn't find that counter.",
  [ERROR_CODES.COUNTER_OCCUPIED]: 'This counter is already in use.',

  // Queue
  [ERROR_CODES.QUEUE_FULL]: 'This queue is full right now. Please try again a little later.',
  [ERROR_CODES.QUEUE_NO_WAITING]: 'There is no one waiting in this queue.',
  [ERROR_CODES.QUEUE_MAX_RECALL]: 'This ticket has reached its recall limit.',
  [ERROR_CODES.QUEUE_INVALID_STATUS]: "That action isn't available for your ticket right now.",

  // Ticket
  [ERROR_CODES.TICKET_NOT_FOUND]: "We couldn't find that ticket. It may have expired.",
  [ERROR_CODES.TICKET_ALREADY_ACTIVE]: 'You already have an active ticket in this queue.',

  // Staff
  [ERROR_CODES.STAFF_NOT_FOUND]: "We couldn't find that staff member.",
  [ERROR_CODES.STAFF_ALREADY_MEMBER]: 'This person is already a team member.',
  [ERROR_CODES.STAFF_INVITATION_PENDING]: 'An invitation for this person is already pending.',
  [ERROR_CODES.STAFF_CANNOT_REMOVE_SELF]: "You can't remove yourself.",
  [ERROR_CODES.STAFF_CANNOT_REMOVE_OWNER]: "The organization owner can't be removed.",

  // Customer
  [ERROR_CODES.CUSTOMER_NOT_FOUND]: "We couldn't find your account.",
  [ERROR_CODES.CUSTOMER_EMAIL_EXISTS]: 'An account with this email already exists.',

  // Plan
  [ERROR_CODES.PLAN_LIMIT_EXCEEDED]: "This organization has reached its plan's limit.",

  // General
  [ERROR_CODES.VALIDATION_ERROR]:
    "Some of the information provided isn't valid. Please check and try again.",
  [ERROR_CODES.INTERNAL_ERROR]: 'Something went wrong on our end. Please try again.',
  [ERROR_CODES.RATE_LIMITED]: "You're doing that too often. Please wait a moment and try again.",
};

export const en = {
  /** Generic fallback shown when an error code is unknown or missing (R10.4). */
  errorFallback: 'Something went wrong. Please try again.',

  /** Cross-screen, domain-agnostic copy. */
  common: {
    retry: 'Retry',
    cancel: 'Cancel',
    back: 'Back',
    done: 'Done',
    close: 'Close',
    dismiss: 'Dismiss',
    save: 'Save',
    loading: 'Loading…',
    empty: 'Nothing to show yet.',
    error: 'Something went wrong.',
    minutesSuffix: 'min',
  },

  /** Realtime connection status copy (R4.5). */
  connection: {
    reconnecting: 'Reconnecting… live updates will resume shortly.',
    disconnected: "You're offline. Live updates are paused.",
    reconnect: 'Reconnect',
  },

  /** Offline cache / connectivity copy (R9). */
  offline: {
    /** Stale indicator shown over cached data while offline (R9.2). */
    staleBanner: "You're offline. This may be out of date.",
    /** Reason surfaced when a live action is disabled offline (R9.5). */
    actionUnavailable: "You're offline. Connect to the internet to do that.",
    pullToRefresh: 'Pull to refresh',
  },

  /** Discovery: QR scan + manual code entry (R1). */
  discovery: {
    title: 'Find a queue',
    subtitle: 'Scan a QR code or enter an organization code to get started.',
    scanButton: 'Scan QR code',
    manualCodeLabel: 'Organization code',
    manualCodePlaceholder: 'Enter the organization code',
    manualCodeSubmit: 'Continue',
    scanTitle: 'Scan QR code',
    scanHint: 'Point your camera at the queue QR code.',
    cameraPermissionTitle: 'Camera access needed',
    cameraPermissionBody: 'Allow camera access to scan a queue QR code.',
    cameraPermissionAction: 'Allow camera',
    recentTitle: 'Recent',
    favoritesShortcut: 'Your favorites',

    // Data-region states
    resolving: 'Looking up the organization…',
    loadError: "We couldn't look up that organization. Please try again.",
    noServices: 'This organization has no services available right now.',
  },

  /** Service selection + join queue + ticket result (R2). */
  join: {
    selectServiceTitle: 'Choose a service',
    selectServiceSubtitle: 'Select the service you need to join its queue.',
    servicesError: "We couldn't load the available services.",
    noServices: 'No services are available right now.',

    // Optional details (R2.6)
    detailsTitle: 'Your details',
    detailsSubtitle: 'Add your details so staff can reach you (optional).',
    fields: {
      name: 'Your name',
      namePlaceholder: 'Enter your name',
      phone: 'Phone number',
      phonePlaceholder: 'Enter your phone number',
    },

    // Join action
    joinButton: 'Join the queue',
    joinPending: 'Joining…',

    // Ticket result (R2.4)
    ticketTitle: "You're in the queue!",
    yourNumberLabel: 'Your ticket number',
    positionLabel: 'People ahead of you',
    estimatedWaitLabel: 'Estimated wait',
    trackButton: 'Track my ticket',

    // Queue full (R2.5)
    queueFullTitle: 'Queue is full',
    queueFullBody:
      'This queue is full right now, so no ticket was issued. Please try again a little later.',
  },

  /** Active-ticket tracking screen (R3, R4, R9). */
  ticket: {
    title: 'Your ticket',
    yourNumberLabel: 'Your number',
    serviceLabel: 'Service',
    counterLabel: 'Counter',
    positionLabel: 'Position in line',
    estimatedWaitLabel: 'Estimated wait',

    /** Status headline + supporting line, keyed by ticket status (R3.1, R3.4, R3.5). */
    status: {
      waitingHeadline: "You're in the queue",
      waitingDetail: 'You are number {position} in line.',
      waitingDetailNoPosition: 'Please wait to be called.',
      calledHeadline: "It's your turn!",
      calledDetail: 'Please proceed to {counter}.',
      calledDetailNoCounter: 'Please proceed to the counter.',
      servingHeadline: 'Now serving you',
      servingDetail: "You're being served at {counter}.",
      servingDetailNoCounter: "You're being served.",
      completedHeadline: 'All done',
      completedDetail: 'Thank you for your visit.',
      skippedHeadline: 'Ticket skipped',
      skippedDetail: 'Your ticket was skipped. Please see a staff member.',
    },

    // Leave / cancel (R11)
    leaveButton: 'Leave queue',
    leavePending: 'Leaving…',
    leaveConfirmTitle: 'Leave this queue?',
    leaveConfirmBody: "You'll lose your place in line. This can't be undone.",
    leaveConfirm: 'Leave queue',
    leftQueue: "You've left the queue.",
    leaveUnavailable: "Leaving the queue isn't available yet. Please ask a staff member.",

    // Data-region states
    loadError: "We couldn't load your ticket. Check the link and try again.",
  },

  /** Turn-alert notification copy (R5). `{counter}` replaced at alert time. */
  notifications: {
    almostTurnTitle: 'Almost your turn',
    almostTurnBody: "You're nearly at the front of the line. Please get ready.",
    yourTurnTitle: "It's your turn!",
    yourTurnBody: 'Please proceed to {counter}.',
    yourTurnBodyNoCounter: 'Please proceed to the counter.',
    skippedTitle: 'Ticket skipped',
    skippedBody: 'Your ticket was skipped. Please see a staff member.',

    /** Accessibility label for the foreground turn-alert banner region (R5.5). */
    bannerRegionLabel: 'Turn alert',

    // Notifications list screen (R5.7)
    listTitle: 'Notifications',
    listEmpty: 'No notifications yet.',
    listError: "We couldn't load your notifications.",
    signInPrompt: 'Sign in to see your notifications.',
  },

  /** Authentication: register / sign-in / sign-out (R6). */
  auth: {
    // Sign in
    signInTitle: 'Sign in',
    signInSubtitle: 'Sign in to view your history and favorites.',
    signInSubmit: 'Sign in',
    signInPending: 'Signing in…',
    signInSuccess: 'Welcome back.',
    noAccountPrompt: "Don't have an account?",
    registerLink: 'Create one',

    // Register
    registerTitle: 'Create your account',
    registerSubtitle: 'Save your history and favorite organizations.',
    registerSubmit: 'Create account',
    registerPending: 'Creating account…',
    registerSuccess: 'Your account is ready.',
    hasAccountPrompt: 'Already have an account?',
    signInLink: 'Sign in',

    // Sign out
    signOut: 'Sign out',
    signOutSuccess: 'You have been signed out.',

    // Field labels
    fields: {
      email: 'Email',
      password: 'Password',
      fullName: 'Full name',
      phone: 'Phone (optional)',
    },
  },

  /** Ticket history (R7). */
  history: {
    title: 'History',
    subtitle: 'Your past and present tickets.',
    organizationLabel: 'Organization',
    serviceLabel: 'Service',
    numberLabel: 'Ticket',
    statusLabel: 'Status',
    empty: 'No tickets yet. Join a queue to get started.',
    loadError: "We couldn't load your history.",
    signInPrompt: 'Sign in to see your ticket history.',

    /** Human labels for each ticket status. */
    status: {
      WAITING: 'Waiting',
      CALLED: 'Called',
      SERVING: 'Serving',
      COMPLETED: 'Completed',
      SKIPPED: 'Skipped',
    },
  },

  /** Favorite organizations (R8). */
  favorites: {
    title: 'Favorites',
    subtitle: 'Quickly rejoin the organizations you visit most.',
    organizationLabel: 'Organization',
    viewServices: 'View services',
    add: 'Add to favorites',
    remove: 'Remove from favorites',
    addSuccess: 'Added to favorites.',
    removeSuccess: 'Removed from favorites.',
    empty: 'No favorites yet. Add an organization to find it faster next time.',
    loadError: "We couldn't load your favorites.",
    signInPrompt: 'Sign in to save your favorite organizations.',
  },

  /** Backend error-code → friendly copy, keyed only on `ERROR_CODES` (R10.2). */
  errors,
} as const;

export type Catalog = typeof en;

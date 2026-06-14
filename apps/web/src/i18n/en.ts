import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * English string catalog (default UI language for the MVP).
 *
 * All user-facing copy lives here so a second language (e.g. MS) can be added
 * later by providing a parallel catalog of the same shape — no need to refactor
 * components. Per `frontend-web.md`, we intentionally defer a full i18n library
 * until a second language is committed.
 *
 * The `errors` map is keyed by the canonical `ERROR_CODES` values from
 * `@queuenow/shared-constants`. Typing it as `Record<ErrorCode, string>`
 * guarantees, at compile time, that every backend error code has friendly copy.
 */

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const errors: Record<ErrorCode, string> = {
  // Auth
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'The email or password you entered is incorrect.',
  [ERROR_CODES.AUTH_EMAIL_EXISTS]: 'An account with this email already exists.',
  [ERROR_CODES.AUTH_TOKEN_EXPIRED]: 'Your session has expired. Please sign in again.',
  [ERROR_CODES.AUTH_TOKEN_INVALID]: 'Your session is no longer valid. Please sign in again.',
  [ERROR_CODES.AUTH_UNAUTHORIZED]: 'Please sign in to continue.',
  [ERROR_CODES.AUTH_FORBIDDEN]: "You don't have permission to perform this action.",

  // Organization
  [ERROR_CODES.ORG_NOT_FOUND]: 'We couldn’t find that organization.',
  [ERROR_CODES.ORG_INACTIVE]: 'This organization is currently inactive.',
  [ERROR_CODES.ORG_SLUG_EXISTS]:
    'That organization address is already taken. Please choose another.',

  // Service
  [ERROR_CODES.SERVICE_NOT_FOUND]: 'We couldn’t find that service.',
  [ERROR_CODES.SERVICE_PREFIX_EXISTS]:
    'That service prefix is already in use. Please choose another.',
  [ERROR_CODES.SERVICE_INACTIVE]: 'This service is currently inactive.',

  // Counter
  [ERROR_CODES.COUNTER_NOT_FOUND]: 'We couldn’t find that counter.',
  [ERROR_CODES.COUNTER_OCCUPIED]: 'This counter is already in use.',

  // Queue
  [ERROR_CODES.QUEUE_FULL]: 'The queue is full right now. Please try again shortly.',
  [ERROR_CODES.QUEUE_NO_WAITING]: 'There are no customers waiting in the queue.',
  [ERROR_CODES.QUEUE_MAX_RECALL]:
    'You’ve reached the recall limit for this ticket. Skip it or call the next customer.',
  [ERROR_CODES.QUEUE_INVALID_STATUS]:
    'That action isn’t available for this ticket’s current status.',

  // Ticket
  [ERROR_CODES.TICKET_NOT_FOUND]: 'We couldn’t find that ticket.',
  [ERROR_CODES.TICKET_ALREADY_ACTIVE]: 'This ticket is already active.',

  // Staff
  [ERROR_CODES.STAFF_NOT_FOUND]: 'We couldn’t find that staff member.',
  [ERROR_CODES.STAFF_ALREADY_MEMBER]: 'This person is already a member of your team.',
  [ERROR_CODES.STAFF_INVITATION_PENDING]: 'An invitation for this person is already pending.',
  [ERROR_CODES.STAFF_CANNOT_REMOVE_SELF]: 'You can’t remove yourself.',
  [ERROR_CODES.STAFF_CANNOT_REMOVE_OWNER]: 'The organization owner can’t be removed.',

  // Customer
  [ERROR_CODES.CUSTOMER_NOT_FOUND]: 'We couldn’t find that customer.',
  [ERROR_CODES.CUSTOMER_EMAIL_EXISTS]: 'A customer with this email already exists.',

  // Plan
  [ERROR_CODES.PLAN_LIMIT_EXCEEDED]: "You've reached your plan's limit. Upgrade to add more.",

  // General
  [ERROR_CODES.VALIDATION_ERROR]:
    'Some of the information provided isn’t valid. Please check and try again.',
  [ERROR_CODES.INTERNAL_ERROR]: 'Something went wrong on our end. Please try again.',
  [ERROR_CODES.RATE_LIMITED]: 'You’re doing that too often. Please wait a moment and try again.',
};

export const en = {
  /** Generic fallback shown when an error code is unknown or missing. */
  errorFallback: 'Something went wrong. Please try again.',

  /**
   * Upgrade prompt surfaced when the API rejects an action with
   * `PLAN_LIMIT_EXCEEDED` (R8.5). The prompt invites the user to upgrade their
   * plan; the user's unsaved input is intentionally retained (the form is not
   * reset) so they can retry after upgrading.
   */
  upgradePrompt: {
    title: "You've reached your plan's limit.",
    description: 'Upgrade your plan to unlock more.',
    action: 'Upgrade',
  },

  common: {
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    loading: 'Loading…',
    empty: 'Nothing to show yet.',
    error: 'Something went wrong.',
  },

  /** Primary navigation labels for the authenticated app shell. */
  nav: {
    dashboard: 'Dashboard',
    queue: 'Queue',
    services: 'Services',
    counters: 'Counters',
    display: 'Display',
    staff: 'Staff',
    settings: 'Settings',
    billing: 'Billing',
  },

  /**
   * Realtime connection status copy. Surfaced by `<ConnectionIndicator>` as a
   * subtle, non-blocking banner while the socket is reconnecting (R3.11).
   */
  connection: {
    reconnecting: 'Reconnecting… live updates will resume shortly.',
  },

  /** App shell chrome (layout, menus, and gated controls). */
  shell: {
    primaryNavLabel: 'Primary',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    signOut: 'Sign out',
    deleteOrganization: 'Delete organization',
    dangerZone: 'Danger zone',
    /** Nav entry shown to OWNERs in place of a plan-gated surface (R9.4). */
    upgrade: 'Upgrade',
  },

  /** Authentication surfaces (login / register forms and logout). */
  auth: {
    // Login
    loginTitle: 'Sign in',
    loginSubtitle: 'Sign in to your QueueNow account.',
    loginSubmit: 'Sign in',
    loginPending: 'Signing in…',
    loginSuccess: 'Welcome back.',
    noAccountPrompt: "Don't have an account?",
    registerLink: 'Create one',

    // Register
    registerTitle: 'Create your account',
    registerSubtitle: 'Set up your organization and start managing your queues.',
    registerSubmit: 'Create account',
    registerPending: 'Creating account…',
    registerSuccess: 'Your account is ready.',
    hasAccountPrompt: 'Already have an account?',
    loginLink: 'Sign in',

    // Logout
    logoutSuccess: 'You have been signed out.',

    // Field labels
    fields: {
      email: 'Email',
      password: 'Password',
      fullName: 'Full name',
      phone: 'Phone (optional)',
      organizationName: 'Organization name',
      organizationType: 'Organization type',
    },

    // Organization type options
    organizationTypes: {
      CLINIC: 'Clinic',
      BANK: 'Bank',
      RESTAURANT: 'Restaurant',
      GOVERNMENT: 'Government',
      OTHER: 'Other',
    },
  },

  /** Staff queue-serving panel (R6). */
  queue: {
    title: 'Queue',
    subtitle: 'Live queue status across your services.',

    // Counter selector (R6.2)
    counterLabel: 'Serving from counter',
    counterPlaceholder: 'Select a counter…',
    noCounters: 'No active counters yet. Ask an admin to add one.',
    countersError: 'We couldn’t load your counters.',

    // Per-service status (R6.1)
    waiting: 'Waiting',
    currentlyCalled: 'Currently called',
    serving: 'Serving',
    completedToday: 'Completed today',
    estimatedWait: 'Est. wait',
    minutesSuffix: 'min',
    noneCalled: 'No tickets called yet.',

    // Data-region states (R6.13)
    loadError: 'We couldn’t load the queue status.',
    empty: 'No active services to show.',
    noOrganization: 'No active organization for this session.',

    // Active serving-ticket card (R6.3, R6.5, R6.7, R6.8, R6.9)
    nowServingTitle: 'Ticket you’re serving',
    nowServingEmpty: 'Call the next customer to start serving.',
    recentlySkippedTitle: 'Recently skipped',
    recallsLabel: 'Recalls',

    // Serving actions (R6.3–R6.9)
    actions: {
      callNext: 'Call next',
      callNextPending: 'Calling…',
      recall: 'Recall',
      recallPending: 'Recalling…',
      skip: 'Skip',
      skipPending: 'Skipping…',
      complete: 'Complete',
      completePending: 'Completing…',
      rejoin: 'Rejoin',
      rejoinPending: 'Rejoining…',
      /** Shown when the staff member hasn’t picked a counter yet (R6.2). */
      selectCounterFirst: 'Select a counter to start serving.',
    },
  },

  /** Public Display (TV) board (R7). */
  display: {
    title: 'Now Serving',
    serviceLabel: 'Service',
    counterLabel: 'Counter',
    counterUnassigned: 'Please proceed',
    /** Color-independent label paired with the called state (R7.7, R13.3). */
    nowCalling: 'Now calling',

    // Empty / error states (R7 data region)
    noneCalled: 'No tickets are being called right now.',
    loadError: 'We couldn’t load the display board.',
    retry: 'Retry',

    // Footer / chrome
    lastUpdated: 'Last updated',
    enterFullscreen: 'Enter fullscreen',
    exitFullscreen: 'Exit fullscreen',

    // Audio announcements (R7.4–R7.6)
    mute: 'Mute announcements',
    unmute: 'Unmute announcements',
    enableSoundTitle: 'Tap to enable sound',
    enableSoundBody:
      'Turn on audio so the board can chime and announce each ticket as it’s called.',
    enableSoundButton: 'Enable sound',
    /**
     * Spoken-announcement templates. `{number}` and `{counter}` are replaced
     * at call time; kept here so copy stays centralized and translatable.
     */
    announce: {
      withCounter: 'Now calling number {number}. Please proceed to {counter}.',
      withoutCounter: 'Now calling number {number}.',
    },
  },

  /** Services management (Phase 2, R8). */
  services: {
    title: 'Services',
    subtitle: 'Create, edit, activate, and order the services customers can queue for.',

    // List column headers (R8.1)
    columns: {
      name: 'Name',
      prefix: 'Prefix',
      active: 'Active',
      sortOrder: 'Sort order',
      actions: 'Actions',
    },

    // Active-state labels (color-independent, R13.3)
    activeLabel: 'Active',
    inactiveLabel: 'Inactive',

    // Data-region states (R8.7)
    loadError: 'We couldn’t load your services.',
    empty: 'No services yet. Create your first one to start taking customers.',
    noOrganization: 'No active organization for this session.',

    // Actions
    actions: {
      create: 'Add service',
      edit: 'Edit',
      activate: 'Activate',
      deactivate: 'Deactivate',
      togglePending: 'Updating…',
    },

    // Create / edit form
    form: {
      createTitle: 'Add service',
      editTitle: 'Edit service',
      submitCreate: 'Create service',
      submitEdit: 'Save changes',
      submitPending: 'Saving…',
      cancel: 'Cancel',
      createSuccess: 'Service created.',
      editSuccess: 'Service updated.',
      activateSuccess: 'Service activated.',
      deactivateSuccess: 'Service deactivated.',
      fields: {
        name: 'Name',
        prefix: 'Prefix',
        sortOrder: 'Sort order',
        avgServingTime: 'Average serving time (min)',
        maxQueuePerDay: 'Max queue per day (optional)',
        isActive: 'Active',
      },
    },
  },

  /** Counters management (Phase 2, R9). */
  counters: {
    title: 'Counters',
    subtitle: 'Manage the counters staff serve from and the service each one handles.',

    // List columns / labels (R9.1)
    nameLabel: 'Name',
    serviceLabel: 'Service',
    statusLabel: 'Status',
    actionsLabel: 'Actions',
    active: 'Active',
    inactive: 'Inactive',
    unknownService: 'Unknown service',

    // List chrome
    newCounter: 'New counter',
    edit: 'Edit',
    activate: 'Activate',
    deactivate: 'Deactivate',

    // Data-region states (R9.7)
    empty: 'No counters yet. Create one to get started.',
    loadError: 'We couldn’t load your counters.',
    noServices: 'Add a service first — a counter must be associated with one.',
    servicesError: 'We couldn’t load your services.',
    noOrganization: 'No active organization for this session.',

    // Form (R9.2, R9.3)
    createTitle: 'Create counter',
    editTitle: 'Edit counter',
    fields: {
      name: 'Counter name',
      service: 'Associated service',
      servicePlaceholder: 'Select a service…',
      active: 'Active',
    },
    submitCreate: 'Create counter',
    submitEdit: 'Save changes',
    submitCreatePending: 'Creating…',
    submitEditPending: 'Saving…',
    cancel: 'Cancel',

    // Toasts (R9.6)
    createSuccess: 'Counter created.',
    updateSuccess: 'Counter updated.',
    activateSuccess: 'Counter activated.',
    deactivateSuccess: 'Counter deactivated.',
  },

  /** Organization settings, branding, and queue-settings surfaces (R11). */
  organization: {
    title: 'Organization settings',
    subtitle: 'Manage your organization details, branding, and queue behaviour.',

    // Data-region states for the settings page (R11 data region).
    loadError: 'We couldn’t load your organization settings.',
    noOrganization: 'No active organization for this session.',

    // Organization details form (R11.1)
    details: {
      title: 'Organization details',
      description: 'These details identify your organization across QueueNow.',
      saved: 'Organization details saved.',
      submit: 'Save details',
      submitPending: 'Saving…',
      fields: {
        name: 'Organization name',
        address: 'Address',
        phone: 'Phone',
        email: 'Contact email',
        timezone: 'Timezone',
      },
      timezoneHint: 'IANA timezone, e.g. Asia/Kuala_Lumpur. Used to format all displayed times.',
    },

    // Branding form (R11.2, R11.3)
    branding: {
      title: 'Branding',
      description: 'Personalize the colors and logo shown on your public screens.',
      saved: 'Branding updated.',
      submit: 'Save branding',
      submitPending: 'Saving…',
      fields: {
        logoUrl: 'Logo URL',
        primaryColor: 'Primary color',
        qrText: 'Kiosk QR caption',
      },
      primaryColorHint: 'Hex color, e.g. #3B82F6. Applied to buttons and accents across the app.',
      qrTextHint: 'Short caption shown beneath the kiosk tracking QR code.',
    },

    // Queue settings form (R11.6)
    queueSettings: {
      title: 'Queue settings',
      description: 'Control how customers join and how tickets are called.',
      saved: 'Queue settings updated.',
      submit: 'Save queue settings',
      submitPending: 'Saving…',
      fields: {
        resetTime: 'Daily reset time',
        maxRecall: 'Maximum recalls per ticket',
        requireName: 'Require customer name',
        requirePhone: 'Require customer phone',
        autoSkipTimeout: 'Auto-skip timeout (seconds)',
      },
      resetTimeHint: '24-hour HH:MM. Ticket numbers reset at this time each day.',
      maxRecallHint: 'How many times a ticket can be recalled before it must be skipped (1–5).',
    },

    // OWNER-only danger zone / delete control (R11.7)
    danger: {
      title: 'Danger zone',
      description: 'Permanently delete this organization and all of its data.',
      deleteButton: 'Delete organization',
      deletePending: 'Deleting…',
      confirmPrompt: 'This action is irreversible. Type the organization name to confirm.',
      confirmPlaceholder: 'Organization name',
      confirm: 'Permanently delete',
      cancel: 'Cancel',
      deleted: 'Organization deleted.',
    },
  },

  /** Plan & Usage surface — current plan, per-resource usage, upgrade flow (R8, R6). */
  plan: {
    title: 'Plan & usage',
    subtitle: 'Your current plan and how your usage compares to each limit.',
    currentPlanLabel: 'Current plan',
    usageHeading: 'Usage',
    /** Shown in place of a numeric limit when the resource is unlimited (R8.3). */
    unlimited: 'Unlimited',

    // Data-region states (R8.6).
    loadError: 'We couldn’t load your plan and usage.',
    noOrganization: 'No active organization for this session.',

    /** Human labels for each limited resource (keys match `NumericResource`). */
    resources: {
      services: 'Services',
      counters: 'Counters',
      staff: 'Staff members',
      queuePerDay: 'Daily queue volume',
    },

    /** Human labels for each plan tier (keys match `PlanType`). */
    planNames: {
      FREE: 'Free',
      BASIC: 'Basic',
      PRO: 'Pro',
      ENTERPRISE: 'Enterprise',
    },

    /** Per-resource at-limit upgrade prompt (R8.4). `{resource}` is replaced. */
    atLimit: {
      message: 'You’ve reached your {resource} limit.',
      action: 'Upgrade plan',
    },

    /** OWNER-only manual plan-change dialog (R6, R8.4). */
    changeDialog: {
      trigger: 'Change plan',
      title: 'Change your plan',
      description: 'Choose the plan to switch your organization to.',
      planLabel: 'Plan',
      currentSuffix: '(current)',
      submit: 'Change plan',
      submitPending: 'Changing…',
      cancel: 'Cancel',
      close: 'Close',
      success: 'Your plan has been updated.',
    },
  },

  /** Staff management (R10). */
  staff: {
    title: 'Staff',
    subtitle: 'Invite teammates and manage who can serve your queues.',

    // Roles (shared by the table and the invite form).
    roles: {
      OWNER: 'Owner',
      ADMIN: 'Admin',
      STAFF: 'Staff',
    },

    // Invitation status labels (R10.1).
    status: {
      PENDING: 'Invitation pending',
      ACCEPTED: 'Active',
      EXPIRED: 'Invitation expired',
    },

    // Staff list / table (R10.1, R10.7).
    list: {
      caption: 'Staff members',
      colName: 'Name',
      colEmail: 'Email',
      colRole: 'Role',
      colStatus: 'Status',
      unnamed: 'Pending acceptance',
      empty: 'No staff members yet. Invite someone to get started.',
      loadError: 'We couldn’t load your staff list.',
    },

    // Pager (R10.2).
    pager: {
      previous: 'Previous',
      next: 'Next',
      /** `{page}` and `{total}` are replaced at render time. */
      status: 'Page {page} of {total}',
    },

    // Invite form (R10.3, R10.5).
    invite: {
      heading: 'Invite a staff member',
      emailLabel: 'Email',
      roleLabel: 'Role',
      submit: 'Send invitation',
      pending: 'Sending…',
      success: 'Invitation sent.',
    },
  },

  /** Public Kiosk ticket-taking flow (R12). */
  kiosk: {
    // Chrome / start screen
    title: 'Take a Ticket',
    subtitle: 'Select a service to join the queue.',

    // Service selection (R12.2)
    selectServiceTitle: 'Choose a service',
    noServices: 'No services are available right now. Please ask a staff member.',
    servicesError: 'We couldn’t load the available services.',

    // Details / confirm step (R12.3, R12.4)
    detailsTitle: 'Almost there',
    detailsSubtitle: 'Confirm your details to join the queue.',
    selectedServiceLabel: 'Service',
    back: 'Back',
    confirm: 'Join the queue',
    confirmPending: 'Joining…',
    fields: {
      name: 'Your name',
      namePlaceholder: 'Enter your name',
      phone: 'Phone number',
      phonePlaceholder: 'Enter your phone number',
    },
    validation: {
      nameRequired: 'Please enter your name.',
      phoneRequired: 'Please enter your phone number.',
    },

    // Ticket result (R12.4, R12.5)
    ticketTitle: 'You’re in the queue!',
    yourNumberLabel: 'Your ticket number',
    positionLabel: 'People ahead of you',
    estimatedWaitLabel: 'Estimated wait',
    minutesSuffix: 'min',
    scanToTrack: 'Scan to track your place on your phone.',
    qrUnavailable: 'Tracking code unavailable.',
    startOver: 'Done',

    // Queue full (R12.6)
    queueFullTitle: 'Queue is full',
    queueFullBody: 'Today’s queue is full. Please try again later or ask a staff member for help.',
  },

  /** Dashboard home summary (today's queue stats). */
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Today’s queue at a glance.',
    greeting: 'Welcome back, {name}.',
    stats: {
      waiting: 'Waiting',
      serving: 'Serving',
      completed: 'Completed today',
      skipped: 'Skipped',
      total: 'Total today',
    },
    nowCallingTitle: 'Now calling',
    nowCallingEmpty: 'No tickets are being called right now.',
    byServiceTitle: 'By service',
    byServiceEmpty: 'No services yet. Create one to start taking customers.',
    perServiceWaiting: 'waiting',
    perServiceServing: 'serving',
    perServiceCompleted: 'done today',
    loadError: 'We couldn’t load today’s statistics.',
    goToQueue: 'Open queue panel',
    noOrganization: 'No active organization for this session.',
  },

  /** Public ticket-tracking page (R12.5) — opened from the kiosk QR code. */
  tracking: {
    title: 'Track your ticket',
    yourNumberLabel: 'Your number',
    serviceLabel: 'Service',
    counterLabel: 'Counter',
    positionLabel: 'Position in line',
    estimatedWaitLabel: 'Estimated wait',
    minutesSuffix: 'min',
    autoRefreshNote: 'This page updates automatically.',
    recallNote: 'You have been called {count} time(s).',

    /** Status headline + supporting line, keyed by ticket status. */
    status: {
      waitingHeadline: 'You’re in the queue',
      waitingDetail: 'You are number {position} in line.',
      waitingDetailNoPosition: 'Please wait to be called.',
      calledHeadline: 'You’re being called!',
      calledDetail: 'Please proceed to {counter}.',
      calledDetailNoCounter: 'Please proceed to the counter.',
      servingHeadline: 'Now serving you',
      servingDetail: 'You’re being served at {counter}.',
      servingDetailNoCounter: 'You’re being served.',
      completedHeadline: 'All done',
      completedDetail: 'Thank you for your visit.',
      skippedHeadline: 'Ticket skipped',
      skippedDetail: 'Your ticket was skipped — please see a staff member.',
    },

    // Data-region states
    loadError: 'We couldn’t load your ticket. Check the link and try again.',
    retry: 'Try again',
  },

  errors,
} as const;

export type Catalog = typeof en;

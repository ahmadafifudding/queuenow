// ==========================================
// ERROR CODES
// ==========================================

export const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_EXISTS: 'AUTH_EMAIL_EXISTS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',

  // Organization
  ORG_NOT_FOUND: 'ORG_NOT_FOUND',
  ORG_INACTIVE: 'ORG_INACTIVE',
  ORG_SLUG_EXISTS: 'ORG_SLUG_EXISTS',

  // Service
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  SERVICE_PREFIX_EXISTS: 'SERVICE_PREFIX_EXISTS',
  SERVICE_INACTIVE: 'SERVICE_INACTIVE',

  // Counter
  COUNTER_NOT_FOUND: 'COUNTER_NOT_FOUND',
  COUNTER_OCCUPIED: 'COUNTER_OCCUPIED',

  // Queue
  QUEUE_FULL: 'QUEUE_FULL',
  QUEUE_NO_WAITING: 'QUEUE_NO_WAITING',
  QUEUE_MAX_RECALL: 'QUEUE_MAX_RECALL',
  QUEUE_INVALID_STATUS: 'QUEUE_INVALID_STATUS',

  // Ticket
  TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
  TICKET_ALREADY_ACTIVE: 'TICKET_ALREADY_ACTIVE',

  // Staff
  STAFF_NOT_FOUND: 'STAFF_NOT_FOUND',
  STAFF_ALREADY_MEMBER: 'STAFF_ALREADY_MEMBER',
  STAFF_INVITATION_PENDING: 'STAFF_INVITATION_PENDING',
  STAFF_CANNOT_REMOVE_SELF: 'STAFF_CANNOT_REMOVE_SELF',
  STAFF_CANNOT_REMOVE_OWNER: 'STAFF_CANNOT_REMOVE_OWNER',

  // Customer
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_EMAIL_EXISTS: 'CUSTOMER_EMAIL_EXISTS',

  // Plan
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',

  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

// ==========================================
// PLAN LIMITS
// ==========================================

export const PLAN_LIMITS = {
  FREE: {
    maxServices: 1,
    maxCounters: 1,
    maxQueuePerDay: 30,
    maxStaff: 2,
    tvDisplay: false,
    analytics: false,
    customBranding: false,
  },
  BASIC: {
    maxServices: 3,
    maxCounters: 3,
    maxQueuePerDay: null, // unlimited
    maxStaff: 5,
    tvDisplay: true,
    analytics: false,
    customBranding: true,
  },
  PRO: {
    maxServices: null, // unlimited
    maxCounters: null, // unlimited
    maxQueuePerDay: null, // unlimited
    maxStaff: null, // unlimited
    tvDisplay: true,
    analytics: true,
    customBranding: true,
  },
  ENTERPRISE: {
    maxServices: null,
    maxCounters: null,
    maxQueuePerDay: null,
    maxStaff: null,
    tvDisplay: true,
    analytics: true,
    customBranding: true,
  },
} as const;

// ==========================================
// DEFAULT SERVICES BY ORG TYPE
// ==========================================

export const DEFAULT_SERVICES = {
  CLINIC: [
    { name: 'Registration', prefix: 'A' },
    { name: 'Consultation', prefix: 'B' },
    { name: 'Pharmacy', prefix: 'C' },
  ],
  BANK: [
    { name: 'Deposit/Withdrawal', prefix: 'A' },
    { name: 'Loan', prefix: 'B' },
    { name: 'Customer Service', prefix: 'C' },
  ],
  RESTAURANT: [
    { name: 'Dine-in', prefix: 'A' },
    { name: 'Takeaway', prefix: 'B' },
  ],
  GOVERNMENT: [
    { name: 'General Inquiry', prefix: 'A' },
    { name: 'Payment', prefix: 'B' },
    { name: 'Collection', prefix: 'C' },
  ],
  OTHER: [{ name: 'General Service', prefix: 'A' }],
} as const;

// ==========================================
// WEBSOCKET EVENTS
// ==========================================

export const WS_EVENTS = {
  // Client → Server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  SUBSCRIBE_TICKET: 'subscribe:ticket',

  // Server → Client
  QUEUE_UPDATE: 'queue:update',
  TICKET_CALLED: 'queue:ticket-called',
  TICKET_UPDATE: 'ticket:update',
  TICKET_NOTIFICATION: 'ticket:notification',
  SUBSCRIBED: 'subscribed',
} as const;

// ==========================================
// QUEUE DEFAULTS
// ==========================================

export const QUEUE_DEFAULTS = {
  RESET_TIME: '00:00',
  MAX_RECALL: 2,
  AVG_SERVING_TIME_MINUTES: 5,
  TICKET_NUMBER_PAD_LENGTH: 3,
  MAX_CUSTOM_FIELDS: 3,
  CUSTOMER_DATA_RETENTION_DAYS: 90,
  ORG_DATA_RETENTION_DAYS: 365,
} as const;

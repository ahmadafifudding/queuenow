// ==========================================
// ENUMS
// ==========================================

export enum OrganizationType {
  CLINIC = 'CLINIC',
  BANK = 'BANK',
  RESTAURANT = 'RESTAURANT',
  GOVERNMENT = 'GOVERNMENT',
  OTHER = 'OTHER',
}

export enum PlanType {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum UserRoleType {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

export enum TicketStatus {
  WAITING = 'WAITING',
  CALLED = 'CALLED',
  SERVING = 'SERVING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
}

export enum AuthProvider {
  EMAIL = 'EMAIL',
  GOOGLE = 'GOOGLE',
}

export enum NotificationType {
  YOUR_TURN = 'YOUR_TURN',
  ALMOST_TURN = 'ALMOST_TURN',
  SKIPPED = 'SKIPPED',
}

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
}

// ==========================================
// INTERFACES
// ==========================================

export interface IOrganization {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  plan: PlanType;
  ownerId: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  provider: AuthProvider;
  emailVerified: boolean;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface IService {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  isActive: boolean;
  sortOrder: number;
  maxQueuePerDay?: number | null;
  avgServingTime: number;
}

export interface ICounter {
  id: string;
  orgId: string;
  serviceId: string;
  name: string;
  isActive: boolean;
}

export interface IQueueTicket {
  id: string;
  orgId: string;
  serviceId: string;
  counterId?: string | null;
  ticketNumber: string;
  dailyNumber: number;
  status: TicketStatus;
  customerName?: string | null;
  customerPhone?: string | null;
  customerProfileId?: string | null;
  calledAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
  recallCount: number;
  isRejoin: boolean;
  createdAt: string;
}

export interface ICustomerProfile {
  id: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
  createdAt: string;
}

// ==========================================
// API RESPONSE TYPES
// ==========================================

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ==========================================
// PLAN ENFORCEMENT TYPES
// ==========================================

/** Resource keys that map 1:1 to a numeric `PLAN_LIMITS` field. */
export type NumericResource = 'services' | 'counters' | 'staff' | 'queuePerDay';

/** Boolean feature flags defined in `PLAN_LIMITS`. */
export type FeatureFlag = 'tvDisplay' | 'analytics' | 'customBranding';

/** The named numeric `PLAN_LIMITS` field that governs a `NumericResource`. */
export type PlanLimitName = 'maxServices' | 'maxCounters' | 'maxStaff' | 'maxQueuePerDay';

/** Per-resource usage projection surfaced by the plan-usage endpoint. */
export interface PlanUsageResource {
  resource: NumericResource;
  limitName: PlanLimitName;
  usage: number;
  /** `null` means the resource is unlimited for the current plan. */
  limit: number | null;
  /** `usage >= limit`; always `false` when the limit is unlimited (`null`). */
  atLimit: boolean;
}

/** The plan + usage projection returned by `GET /organizations/:id/plan-usage`. */
export interface PlanUsageResponse {
  plan: PlanType;
  features: Record<FeatureFlag, boolean>;
  resources: PlanUsageResource[];
}

// ==========================================
// AUTH TYPES
// ==========================================

export interface ITokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ILoginResponse {
  user: Pick<IUser, 'id' | 'email' | 'fullName' | 'avatarUrl'>;
  organization: {
    id: string;
    name: string;
    slug: string;
    role: UserRoleType;
  };
  tokens: ITokenPair;
}

export interface ICustomerLoginResponse {
  customer: Pick<ICustomerProfile, 'id' | 'email' | 'phone' | 'fullName' | 'avatarUrl'>;
  tokens: ITokenPair;
}

// ==========================================
// WEBSOCKET EVENT TYPES
// ==========================================

export interface IQueueUpdateEvent {
  type:
    | 'TICKET_JOINED'
    | 'TICKET_CALLED'
    | 'TICKET_RECALLED'
    | 'TICKET_SKIPPED'
    | 'TICKET_COMPLETED'
    | 'TICKET_REJOINED';
  ticket: {
    id: string;
    ticketNumber: string;
    status: TicketStatus;
    serviceId?: string;
    counterName?: string;
    position?: number;
  };
}

export interface ITicketCalledEvent {
  ticketNumber: string;
  counterName: string;
  serviceName: string;
  isRecall?: boolean;
  recallCount?: number;
}

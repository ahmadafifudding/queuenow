/*
 * Domain types for the staff-management feature (R10).
 *
 * The list endpoint feeds a table of "name, email, role, invitation status"
 * rows (R10.1). `@queuenow/shared-types` ships the `UserRoleType` and
 * `InvitationStatus` enums but no flattened staff-row interface, so the
 * view-model {@link StaffMember} below is defined here as the app-local shape
 * the table renders. The API row is normalized into it by `lib/normalize.ts`.
 */
import type { InvitationStatus, UserRoleType } from '@queuenow/shared-types';

/**
 * A single row in the staff list: a current member or a pending invitee.
 *
 * `id` is a stable key for the row (the membership/invitation id). `name` may be
 * empty for an invitee who has not accepted yet (no user record exists), so the
 * table falls back to the email for display.
 */
export interface StaffMember {
  /** Stable row identity (membership id, or invitation id for a pending invite). */
  id: string;
  /** Full name, or `null`/empty when an invitee has not yet created an account. */
  name: string | null;
  /** Email address — always present; used as the display fallback. */
  email: string;
  /** The member's role within the organization. */
  role: UserRoleType;
  /** Whether the person is an accepted member or has a pending/expired invite. */
  invitationStatus: InvitationStatus;
}

/**
 * Pagination state derived from the API envelope `meta` (R10.1). When the
 * backend omits `meta`, the list hook fills these in from the requested page and
 * the returned item count so the pager still renders coherently.
 */
export interface StaffPagination {
  /** The 1-indexed page these results represent. */
  page: number;
  /** Items per page. */
  limit: number;
  /** Total staff records across all pages. */
  total: number;
  /** Total number of pages (`>= 1`). */
  totalPages: number;
}

/** The fully-resolved staff list: the page's rows plus its pagination state. */
export interface StaffListResult {
  /** The staff rows for the current page. */
  members: StaffMember[];
  /** Pagination metadata for the current page. */
  pagination: StaffPagination;
}

/** Minimal result of a successful invite mutation (the created invitation). */
export interface StaffInvitation {
  /** The invitation id. */
  id: string;
  /** The invited email. */
  email: string;
  /** The role the invitee will hold once they accept. */
  role: UserRoleType;
}

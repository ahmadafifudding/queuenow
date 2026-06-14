/*
 * Normalization for the staff list (R10.1).
 *
 * The list hook receives the unwrapped `data` plus optional `meta` from the
 * API_Client. This module turns that loosely-typed payload into the strongly
 * typed {@link StaffMember} rows and {@link StaffPagination} the UI renders,
 * without leaking `any`.
 *
 * ## Backend contract assumption
 * The design specifies a paginated staff list keyed by `meta.page/limit/total`
 * with rows carrying name/email/role/invitation status (R10.1, R10.2). The
 * current `GET /organizations/:orgId/staff` returns an un-paginated array of
 * membership records (each with a nested `user`) and tracks pending invitations
 * on a separate endpoint, so it emits no `meta` and no per-row status. To stay
 * correct against both the documented contract and today's backend, the
 * normalizer:
 *   - accepts either a flat row (`{ email, fullName, role, invitationStatus }`)
 *     or a nested membership row (`{ user: { email, fullName }, role }`);
 *   - defaults a row with no explicit status to `ACCEPTED` (membership rows are
 *     accepted members by definition); and
 *   - synthesizes pagination from the requested page and item count whenever
 *     `meta` is absent (single page).
 * When the backend adds `?page=&limit=` + `meta`, this code consumes it as-is
 * with no change.
 */
import { InvitationStatus, UserRoleType } from '@queuenow/shared-types';

import type { Meta } from '@/lib/api/client';

import type { StaffMember, StaffPagination } from '../types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Narrow an arbitrary string to a known {@link UserRoleType}, defaulting to STAFF. */
function toRole(value: unknown): UserRoleType {
  const role = asString(value);
  if (role !== null && (Object.values(UserRoleType) as string[]).includes(role)) {
    return role as UserRoleType;
  }
  return UserRoleType.STAFF;
}

/**
 * Narrow an arbitrary string to a known {@link InvitationStatus}. Rows with no
 * explicit status are treated as ACCEPTED (an existing membership).
 */
function toInvitationStatus(value: unknown): InvitationStatus {
  const status = asString(value);
  if (status !== null && (Object.values(InvitationStatus) as string[]).includes(status)) {
    return status as InvitationStatus;
  }
  return InvitationStatus.ACCEPTED;
}

/**
 * Normalize a single staff row from the API into a {@link StaffMember}.
 *
 * @param raw One element of the list `data` array (loosely typed).
 * @param index Position in the page, used only for a fallback row key.
 * @returns The view-model row, or `null` when the row has no usable email.
 */
function toStaffMember(raw: unknown, index: number): StaffMember | null {
  if (!isObject(raw)) {
    return null;
  }

  const user = isObject(raw.user) ? raw.user : undefined;

  const email = asString(raw.email) ?? asString(user?.email);
  if (email === null) {
    // Without an email there is no meaningful staff row to render.
    return null;
  }

  const name = asString(raw.name) ?? asString(raw.fullName) ?? asString(user?.fullName);

  const id = asString(raw.id) ?? asString(raw.userId) ?? asString(user?.id) ?? `${email}-${index}`;

  return {
    id,
    name,
    email,
    role: toRole(raw.role),
    invitationStatus: toInvitationStatus(raw.invitationStatus ?? raw.status),
  };
}

/**
 * Normalize the list `data` payload into staff rows, dropping unusable entries.
 *
 * @param data The unwrapped `data` field (expected to be an array).
 * @returns The normalized staff rows.
 */
export function normalizeStaffList(data: unknown): StaffMember[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((row, index) => toStaffMember(row, index))
    .filter((row): row is StaffMember => row !== null);
}

/**
 * Derive pagination state from the envelope `meta` (R10.1), filling any missing
 * field from the requested page, the configured page size, and the item count
 * so the pager is always coherent — even against a backend that omits `meta`.
 *
 * @param meta The envelope `meta`, if any.
 * @param requestedPage The page the caller asked for.
 * @param pageSize The page size the caller requested.
 * @param itemCount The number of rows returned for this page.
 * @returns Fully-resolved pagination state.
 */
export function derivePagination(
  meta: Meta | undefined,
  requestedPage: number,
  pageSize: number,
  itemCount: number,
): StaffPagination {
  const page = meta?.page ?? requestedPage;
  const limit = meta?.limit ?? pageSize;
  const total = meta?.total ?? itemCount;
  const safeLimit = limit > 0 ? limit : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return { page, limit: safeLimit, total, totalPages };
}

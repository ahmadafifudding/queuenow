/*
 * useStaffList — paginated staff list query (R10.1, R10.2).
 *
 * Loads one page of the org's staff using the central `['staff', orgId, page]`
 * query key so the invite mutation can invalidate exactly the visible page
 * (R10.4) and so the URL page round-trips to a stable cache entry (Property 15).
 *
 * The page comes from the route search params (the route owns `validateSearch`)
 * and is passed in here. Results are normalized into `StaffMember` rows and the
 * pagination state is read from the envelope `meta` (with a safe fallback when
 * the backend omits it — see `lib/normalize.ts`). `placeholderData` keeps the
 * previous page visible while the next one loads, avoiding a loading flash on
 * page changes.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { StaffListResult } from '../types';
import { derivePagination, normalizeStaffList } from '../lib/normalize';
import { STAFF_PAGE_SIZE } from '../lib/search';
import { staffEndpoints } from './endpoints';

/** Options controlling the staff list query. */
export interface UseStaffListOptions {
  /** The organization whose staff to load. */
  orgId: string;
  /** The 1-indexed page to load (from the route search params). */
  page: number;
  /** Page size. Defaults to {@link STAFF_PAGE_SIZE}. */
  limit?: number;
  /** When `false`, the query does not run (e.g. while `orgId` is unknown). */
  enabled?: boolean;
}

/**
 * Load a single page of the organization's staff.
 *
 * @param options - org, page, optional page size, and enablement.
 * @returns The TanStack Query result holding the page's rows + pagination.
 */
export function useStaffList(
  options: UseStaffListOptions,
): UseQueryResult<StaffListResult, ApiError> {
  const { orgId, page, limit = STAFF_PAGE_SIZE, enabled = true } = options;

  return useQuery<StaffListResult, ApiError>({
    queryKey: queryKeys.staff(orgId, page),
    queryFn: async ({ signal }) => {
      const { data, meta } = await apiClient.get<unknown>(
        staffEndpoints.list(orgId, { page, limit }),
        { signal },
      );
      const members = normalizeStaffList(data);
      const pagination = derivePagination(meta, page, limit, members.length);
      return { members, pagination };
    },
    enabled: enabled && Boolean(orgId),
    placeholderData: keepPreviousData,
  });
}

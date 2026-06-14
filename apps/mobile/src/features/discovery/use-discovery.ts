/**
 * Service-resolution query hooks for discovery (R1.1, R1.2, R1.4, R1.5).
 *
 * {@link useOrgStatus} reads the org's public queue status through the single
 * `apiClient` + TanStack Query on the central `queryKeys.orgStatus` key, exactly
 * mirroring the web app's queue-status reads. {@link useDiscovery} composes that
 * query with the PURE {@link joinAvailability} decision so screens get one
 * cohesive result: the org name, the active services, and whether/how to present
 * a join action.
 *
 * The status endpoint is org-id-scoped; see {@link resolveOrgIdentifier} for the
 * documented slug→orgId resolution assumption.
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { joinAvailability, normalizeServices } from './join-availability';
import { resolveOrgIdentifier } from './parse-discovery-url';
import type { DiscoveryTarget, JoinAvailabilityDecision, OrgQueueStatus } from './types';

/** Build the public status path, optionally scoped to a single service (R1.4). */
function statusPath(orgId: string, serviceId?: string): string {
  const base = `/organizations/${encodeURIComponent(orgId)}/queue/status`;
  return serviceId ? `${base}?serviceId=${encodeURIComponent(serviceId)}` : base;
}

/**
 * Fetch an organization's public queue status / active services (R1.2, R1.5).
 *
 * The query is disabled until an org identifier is available. The endpoint is
 * public, so the request is unauthenticated; org-not-found / inactive surfaces
 * as an `ApiError` whose `code` the discovery decision maps to an error state.
 *
 * @param orgIdentifier The org id/slug to resolve (see {@link resolveOrgIdentifier}).
 * @param serviceId Optional service id to scope the status to one service.
 * @returns The TanStack Query result for the org status.
 */
export function useOrgStatus(
  orgIdentifier: string | null | undefined,
  serviceId?: string,
): UseQueryResult<OrgQueueStatus> {
  const enabled = Boolean(orgIdentifier);
  return useQuery({
    queryKey: queryKeys.orgStatus(orgIdentifier ?? '', serviceId),
    enabled,
    queryFn: async (): Promise<OrgQueueStatus> => {
      // `enabled` guarantees a non-null identifier by the time this runs.
      const { data } = await apiClient.get<OrgQueueStatus>(
        statusPath(orgIdentifier as string, serviceId),
      );
      return data;
    },
  });
}

/** The composed result returned by {@link useDiscovery}. */
export interface UseDiscoveryResult {
  /** The resolved org identifier, or `null` when the target is missing. */
  orgIdentifier: string | null;
  /**
   * The canonical organization id from the resolved status response, else
   * `null`. This is the id the join endpoint is scoped to (R2.1); prefer it over
   * the raw {@link orgIdentifier} when sending a join.
   */
  organizationId: string | null;
  /** The organization's display name once resolved, else `null`. */
  organizationName: string | null;
  /** True while the org status is loading. */
  isLoading: boolean;
  /** True when status resolution failed (error decision derived below). */
  isError: boolean;
  /**
   * The join-availability decision once resolution settles (R1.3, R1.4), or
   * `null` while still loading.
   */
  decision: JoinAvailabilityDecision | null;
  /** Refetch the org status (used by the error-state retry action). */
  refetch: () => void;
}

/** Best-effort extraction of a backend error `code` from an unknown thrown value. */
function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
  }
  return undefined;
}

/**
 * Resolve a {@link DiscoveryTarget} to its active services and a join-availability
 * decision (R1.1–R1.5). Combines {@link useOrgStatus} with the pure
 * {@link joinAvailability} decision; the decision is recomputed only when the
 * underlying status/error changes.
 *
 * @param target The parsed discovery target, or `null` when none is available.
 * @returns The composed discovery result for the selection screen.
 */
export function useDiscovery(target: DiscoveryTarget | null): UseDiscoveryResult {
  const orgIdentifier = target ? resolveOrgIdentifier(target) : null;
  const query = useOrgStatus(orgIdentifier, target?.serviceId);

  const decision = useMemo<JoinAvailabilityDecision | null>(() => {
    if (query.isPending) {
      return null;
    }
    if (query.isError) {
      return joinAvailability({ errorCode: extractErrorCode(query.error) ?? 'INTERNAL_ERROR' });
    }
    return joinAvailability({ services: query.data ? normalizeServices(query.data) : [] });
    // `query.data`/`query.error` are the meaningful inputs; status flags gate them.
  }, [query.isPending, query.isError, query.data, query.error]);

  return {
    orgIdentifier,
    organizationId: query.data?.organizationId ?? null,
    organizationName: query.data?.organizationName ?? null,
    isLoading: Boolean(orgIdentifier) && query.isPending,
    isError: query.isError,
    decision,
    refetch: (): void => {
      void query.refetch();
    },
  };
}

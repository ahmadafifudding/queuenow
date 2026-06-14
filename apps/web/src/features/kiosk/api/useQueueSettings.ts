/*
 * useQueueSettings — public, read-only queue settings that drive the Kiosk's
 * required-field gating (R12.3).
 *
 * The Kiosk needs `requireName`/`requirePhone` WITHOUT auth. The public
 * settings endpoint is an ASSUMPTION (see `api/endpoints.ts`): if the backend
 * has not yet exposed it, the read fails and we DEGRADE GRACEFULLY to a safe
 * default that requires nothing — so the Kiosk keeps issuing tickets. When the
 * endpoint exists, its `requireName`/`requirePhone` take over and gating
 * activates automatically.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';

import type { KioskQueueSettings } from '../types';
import { kioskEndpoints } from './endpoints';

/**
 * Safe default applied when the public settings endpoint is unavailable: no
 * fields required, so the Kiosk still works end-to-end.
 */
export const DEFAULT_KIOSK_SETTINGS: KioskQueueSettings = {
  requireName: false,
  requirePhone: false,
};

/** Raw settings shape read from the backend (only the fields the Kiosk uses). */
interface QueueSettingsResponse {
  requireName?: boolean;
  requirePhone?: boolean;
  maxRecall?: number;
}

/** Coerce a possibly-partial settings payload into a complete {@link KioskQueueSettings}. */
function normalizeSettings(raw: QueueSettingsResponse): KioskQueueSettings {
  return {
    requireName: raw.requireName ?? false,
    requirePhone: raw.requirePhone ?? false,
    maxRecall: raw.maxRecall,
  };
}

/**
 * Load the org's public queue settings for the Kiosk.
 *
 * The query never surfaces an error to the UI: a failed/absent endpoint
 * resolves to {@link DEFAULT_KIOSK_SETTINGS} so the kiosk degrades gracefully.
 *
 * @param orgId - the organization to read settings for.
 * @returns the TanStack Query result holding the {@link KioskQueueSettings}.
 */
export function useQueueSettings(orgId: string): UseQueryResult<KioskQueueSettings, never> {
  return useQuery<KioskQueueSettings, never>({
    queryKey: ['kiosk-queue-settings', orgId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiClient.get<QueueSettingsResponse>(
          kioskEndpoints.queueSettings(orgId),
          { signal },
        );
        return normalizeSettings(data);
      } catch {
        // Endpoint missing/unreachable → safe default (require nothing).
        return DEFAULT_KIOSK_SETTINGS;
      }
    },
    enabled: Boolean(orgId),
  });
}

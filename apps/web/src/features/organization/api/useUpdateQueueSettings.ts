/*
 * useUpdateQueueSettings — update the org's queue settings (R11.6).
 *
 * Calls `PATCH /organizations/:id/settings` and invalidates the settings query
 * key on success. Throws a typed `ApiError` so the form can map field errors and
 * surface an error-code toast (R11.8).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { UpdateQueueSettingsInput } from '@queuenow/shared-validation';

import { type ApiError, apiClient } from '@/lib/api/client';

import type { QueueSettings } from '../types';
import { organizationEndpoints } from './endpoints';
import { queueSettingsKey } from './useQueueSettings';

/** Update-queue-settings mutation. Invalidates the settings query key on success. */
export function useUpdateQueueSettings(
  orgId: string,
): UseMutationResult<QueueSettings, ApiError, UpdateQueueSettingsInput> {
  const queryClient = useQueryClient();

  return useMutation<QueueSettings, ApiError, UpdateQueueSettingsInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.patch<QueueSettings>(
        organizationEndpoints.updateSettings(orgId),
        input,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queueSettingsKey(orgId) });
    },
  });
}

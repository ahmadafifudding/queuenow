/*
 * Upgrade-prompt presenter (R8.5).
 *
 * The concrete, `sonner`-based way to show the upgrade prompt produced when the
 * API rejects an action with `PLAN_LIMIT_EXCEEDED`. It is kept separate from the
 * pure `plan-limit-error.ts` classifier so that the predicate stays importable
 * without a DOM / toast runtime; call sites compose the two:
 *
 *   onPlanLimitError(error, showUpgradePrompt(() => openPlanChangeDialog()))
 *
 * The prompt is informational + actionable: it shows curated copy and an
 * "Upgrade" action that routes the user to the manual plan-change flow. It does
 * NOT touch form state — retaining the user's unsaved input is the caller's
 * responsibility, signaled by `onPlanLimitError` returning `true`.
 */
import { toast } from 'sonner';

import { getErrorMessage, type ErrorWithCode } from '@/lib/api/error-map';
import { strings } from '@/i18n';

import type { ShowUpgradePrompt } from './plan-limit-error';

/** Narrow an unknown thrown value to the `{ code }` shape `getErrorMessage` reads. */
function toErrorWithCode(value: unknown): ErrorWithCode | undefined {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const { code } = value as { code?: unknown };
    return typeof code === 'string' ? { code } : undefined;
  }
  return undefined;
}

/**
 * Build a `sonner`-based {@link ShowUpgradePrompt}.
 *
 * @param onUpgrade Optional callback wired to the "Upgrade" action (e.g. open
 *   the `PlanChangeDialog`). When omitted, the toast shows copy without an action.
 * @returns A presenter suitable for passing to `onPlanLimitError`.
 */
export function showUpgradePrompt(onUpgrade?: () => void): ShowUpgradePrompt {
  return (error: unknown): void => {
    toast.error(strings.upgradePrompt.title, {
      // Prefer the curated backend message copy; fall back to the generic line.
      description: getErrorMessage(toErrorWithCode(error)) || strings.upgradePrompt.description,
      action: onUpgrade
        ? {
            label: strings.upgradePrompt.action,
            onClick: onUpgrade,
          }
        : undefined,
    });
  };
}

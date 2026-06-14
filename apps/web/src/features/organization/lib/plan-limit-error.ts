/*
 * Plan-limit error handling helpers (R8.5).
 *
 * The API is the authoritative enforcement boundary: when a create/mutation
 * exceeds the org's plan limit it rejects with the `PLAN_LIMIT_EXCEEDED` error
 * code (HTTP 403). The web app mirrors this by detecting that exact code and
 * prompting the user to upgrade — WITHOUT discarding their unsaved input.
 *
 * This module is intentionally UI-free: `isPlanLimitExceeded` is a pure
 * classifier (the Property 12 predicate) and `onPlanLimitError` only *signals*
 * via an injected callback. Keeping it free of `sonner`/DOM imports lets the
 * property test import the classifier without a browser environment, and lets
 * each call site choose how the upgrade prompt is presented (toast, inline CTA,
 * dialog) while sharing the single source of truth for "is this a plan-limit
 * rejection?".
 */
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Pure classifier — the Property 12 predicate.
 *
 * Returns `true` if and only if the value carries `code === 'PLAN_LIMIT_EXCEEDED'`.
 * Anything else (other `ApiError` codes, plain `Error`s, non-objects, nullish)
 * returns `false`. This is the single decision point the upgrade prompt keys off,
 * so it must never match a different code.
 *
 * @param error An unknown thrown value (typically an `ApiError`).
 * @returns `true` iff `error.code === ERROR_CODES.PLAN_LIMIT_EXCEEDED`.
 */
export function isPlanLimitExceeded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code } = error as { code?: unknown };
  return code === ERROR_CODES.PLAN_LIMIT_EXCEEDED;
}

/**
 * Callback that presents the upgrade prompt for a plan-limit rejection. It
 * receives the originating error so the presenter can derive friendly copy.
 */
export type ShowUpgradePrompt = (error: unknown) => void;

/**
 * Shared handler for API errors that may be plan-limit rejections (R8.5).
 *
 * When `error` is a `PLAN_LIMIT_EXCEEDED` rejection, this invokes the provided
 * `showUpgradePrompt` callback and returns `true`. The boolean is the signal to
 * the caller: a returned `true` means **do not reset the form** — the user's
 * unsaved input must be retained so they can retry after upgrading. When the
 * error is anything else, the callback is NOT invoked and it returns `false`,
 * letting the caller fall through to its normal error handling.
 *
 * @param error The error thrown by a mutation (typically an `ApiError`).
 * @param showUpgradePrompt Presenter invoked only for plan-limit rejections.
 * @returns `true` if handled as a plan-limit error (caller must keep form state);
 *   `false` otherwise.
 */
export function onPlanLimitError(error: unknown, showUpgradePrompt: ShowUpgradePrompt): boolean {
  if (isPlanLimitExceeded(error)) {
    showUpgradePrompt(error);
    return true;
  }

  return false;
}

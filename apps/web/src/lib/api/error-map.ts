import { strings } from '@/i18n';

/**
 * Structural shape of an error that carries a backend error `code`.
 *
 * This intentionally matches the `ApiError` thrown by the API client
 * (`lib/api/client.ts`, task 2.1) WITHOUT importing it, so the error map stays
 * decoupled and usable from anywhere (the query client, feature hooks, error
 * boundaries) regardless of how the error was produced.
 */
export interface ErrorWithCode {
  readonly code?: string | null;
}

/** Anything this module can resolve a friendly message from. */
export type ErrorMessageInput = string | ErrorWithCode | null | undefined;

/**
 * Resolve a bare backend `error.code` to friendly, user-facing copy.
 *
 * Per `frontend-web.md` ("Errors"), known codes map to curated English copy
 * from the i18n catalog and unknown/missing codes resolve to a generic
 * fallback — so a new or unseen server code can never leak an internal message.
 *
 * @param code The `error.code` from an API error envelope (may be unknown).
 * @returns A friendly message safe to show to the user.
 */
export function messageForErrorCode(code: string | undefined | null): string {
  if (!code) {
    return strings.errorFallback;
  }

  const message = (strings.errors as Record<string, string | undefined>)[code];

  return message ?? strings.errorFallback;
}

/**
 * Narrow an unknown value to {@link ErrorWithCode}.
 */
function hasErrorCode(value: unknown): value is ErrorWithCode {
  return typeof value === 'object' && value !== null && 'code' in value;
}

/**
 * Translate a backend error into friendly, user-facing copy.
 *
 * Accepts either a bare `error.code` string or an `ApiError`-like object and
 * extracts its `.code`. Per `frontend-web.md` ("Errors"), we map the code to
 * curated messages and NEVER surface raw backend messages or stack traces;
 * unknown or missing codes resolve to a generic fallback.
 *
 * @param input A code string, an `ApiError`-like object, or nullish.
 * @returns A friendly message safe to show to the user.
 */
export function getErrorMessage(input: ErrorMessageInput): string {
  if (input === null || input === undefined) {
    return strings.errorFallback;
  }

  if (typeof input === 'string') {
    return messageForErrorCode(input);
  }

  if (hasErrorCode(input)) {
    return messageForErrorCode(input.code);
  }

  return strings.errorFallback;
}

/**
 * Backend field-error mapping (Requirement 4.10, design Property 6).
 *
 * When a form submission fails, the API may return `error.details` — a map of
 * `fieldName -> message` describing per-field problems. This helper applies each
 * such entry onto the matching react-hook-form field via `setError`, and ONLY
 * onto that field, so the inline errors line up with the inputs the user can fix.
 *
 * It is intentionally pure (apart from the injected `setError`) and decoupled
 * from any specific form so it can be unit/property tested in isolation: it
 * reports which detail keys were mapped to a known field and which were not, so
 * the caller can decide whether to also show a general (non-field) toast.
 */
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

/** Outcome of applying backend details onto a form. */
export interface ApplyFieldErrorsResult {
  /** Detail keys that matched a known field and were set as inline errors. */
  mapped: string[];
  /** Detail keys with no matching field, or no usable string message. */
  unmapped: string[];
}

/**
 * Coerce a raw detail value into a single display message, or `null` when there
 * is no usable string (so it is treated as unmapped rather than blanking out a
 * field error). Accepts a plain string or an array of strings (Zod/`class-
 * validator` style), ignoring non-string content.
 */
function toMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === 'string');
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

/**
 * Apply backend `error.details` onto the matching form fields.
 *
 * @param details The `ApiError.details` map (`field -> message`), if any.
 * @param knownFields The form's field paths; only these receive inline errors.
 * @param setError The react-hook-form `setError` for the target form.
 * @returns Which detail keys were mapped to a field vs. left unmapped.
 */
export function applyFieldErrors<TFieldValues extends FieldValues>(
  details: Record<string, unknown> | undefined,
  knownFields: readonly Path<TFieldValues>[],
  setError: UseFormSetError<TFieldValues>,
): ApplyFieldErrorsResult {
  const mapped: string[] = [];
  const unmapped: string[] = [];

  if (!details) {
    return { mapped, unmapped };
  }

  const known = new Set<string>(knownFields as readonly string[]);

  for (const [key, raw] of Object.entries(details)) {
    const message = toMessage(raw);
    if (message !== null && known.has(key)) {
      setError(key as Path<TFieldValues>, { type: 'server', message });
      mapped.push(key);
    } else {
      unmapped.push(key);
    }
  }

  return { mapped, unmapped };
}

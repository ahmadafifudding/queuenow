/**
 * Backend field-error mapping (Requirement 4.10, design Property 6).
 *
 * When a form submission fails, the API may return `error.details` — a map of
 * `fieldName -> message` describing per-field problems. This helper turns that
 * raw map into the field-error shape TanStack Form expects from a form-level
 * `onSubmitAsync` validator: a `fields` record of `fieldName -> message` for the
 * KNOWN form fields only, so the inline errors line up with the inputs the user
 * can fix.
 *
 * It is intentionally pure and decoupled from any specific form so it can be
 * unit/property tested in isolation: it reports which detail keys were mapped to
 * a known field and which were not, so the caller can decide whether to also
 * show a general (non-field) toast.
 */

/** Outcome of mapping backend details onto a form's known fields. */
export interface FieldErrorsResult {
  /** `fieldName -> message` for keys that matched a known field and had a usable message. */
  fields: Record<string, string>;
  /** Detail keys that matched a known field and produced an inline message. */
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
 * Map backend `error.details` onto the matching form fields.
 *
 * @param details The `ApiError.details` map (`field -> message`), if any.
 * @param knownFields The form's field paths; only these receive inline errors.
 * @returns The `fields` record for TanStack Form plus the mapped/unmapped keys.
 */
export function toFieldErrors(
  details: Record<string, unknown> | undefined,
  knownFields: readonly string[],
): FieldErrorsResult {
  const fields: Record<string, string> = {};
  const mapped: string[] = [];
  const unmapped: string[] = [];

  if (!details) {
    return { fields, mapped, unmapped };
  }

  const known = new Set<string>(knownFields);

  for (const [key, raw] of Object.entries(details)) {
    const message = toMessage(raw);
    if (message !== null && known.has(key)) {
      fields[key] = message;
      mapped.push(key);
    } else {
      unmapped.push(key);
    }
  }

  return { fields, mapped, unmapped };
}

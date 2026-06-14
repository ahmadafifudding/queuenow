/**
 * Field-error mapping for the controlled auth forms (R6.3, R6.10).
 *
 * The web app maps backend `error.details` onto react-hook-form fields via
 * `setError`. The mobile forms are simple controlled forms (matching the
 * existing `DiscoveryHome` pattern), so this module exposes the same idea as
 * pure functions that return a `field -> message` record the form can drop into
 * local state — keeping the mapping logic decoupled and unit-testable.
 *
 * Two sources of field errors are handled:
 * - schema validation (Zod `flatten().fieldErrors`) before the request is sent,
 * - backend `error.details` returned on a failed register/login.
 */

/**
 * Coerce a raw detail value into a single display message, or `null` when there
 * is no usable string (so it is treated as unmapped rather than blanking out a
 * field). Accepts a plain string or an array of strings (Zod / class-validator
 * style), ignoring non-string content.
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

/** Outcome of mapping backend `error.details` onto known form fields. */
export interface BackendFieldErrors<TField extends string> {
  /** Inline messages for fields that matched a known field path. */
  fieldErrors: Partial<Record<TField, string>>;
  /** Detail keys that matched a known field and were mapped. */
  mapped: string[];
  /** Detail keys with no matching field or no usable string message. */
  unmapped: string[];
}

/**
 * Map backend `error.details` onto the matching form fields, and ONLY onto known
 * fields, so the caller can decide whether to also surface a general message
 * (when nothing field-specific was mapped).
 *
 * @param details The `ApiError.details` map (`field -> message`), if any.
 * @param knownFields The form's field names; only these receive inline errors.
 * @returns The per-field messages plus which detail keys were mapped/unmapped.
 */
export function mapBackendFieldErrors<TField extends string>(
  details: Record<string, unknown> | undefined,
  knownFields: readonly TField[],
): BackendFieldErrors<TField> {
  const fieldErrors: Partial<Record<TField, string>> = {};
  const mapped: string[] = [];
  const unmapped: string[] = [];

  if (!details) {
    return { fieldErrors, mapped, unmapped };
  }

  const known = new Set<string>(knownFields as readonly string[]);

  for (const [key, raw] of Object.entries(details)) {
    const message = toMessage(raw);
    if (message !== null && known.has(key)) {
      fieldErrors[key as TField] = message;
      mapped.push(key);
    } else {
      unmapped.push(key);
    }
  }

  return { fieldErrors, mapped, unmapped };
}

/**
 * Reduce a Zod `flatten().fieldErrors` map to the first message per field, so a
 * controlled form can show a single inline error under each input.
 *
 * @param fieldErrors The `fieldErrors` from `ZodError.flatten()`.
 * @returns A `field -> first message` record.
 */
export function firstFieldMessages<TField extends string>(
  fieldErrors: Partial<Record<string, string[] | undefined>>,
): Partial<Record<TField, string>> {
  const out: Partial<Record<TField, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) {
      out[key as TField] = messages[0];
    }
  }
  return out;
}

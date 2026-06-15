/**
 * Small cross-feature helpers for TanStack Form fields.
 *
 * TanStack Form's `field.state.meta.errors` is a heterogeneous array: Standard
 * Schema (Zod) validators contribute issue objects (`{ message }`), while custom
 * validators and server-mapped errors contribute plain strings. These helpers
 * normalize that so every form renders inline errors the same way without
 * repeating the narrowing logic in each component.
 */

/** A single entry as it can appear in `field.state.meta.errors`. */
type FieldError = string | { message?: unknown } | null | undefined;

/**
 * Extract the first usable error message from a field's `meta.errors`, or
 * `undefined` when there is none. Accepts plain strings (server/custom errors)
 * and Standard Schema issue objects (`{ message }`).
 */
export function firstErrorMessage(errors: readonly FieldError[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return error.message;
    }
  }
  return undefined;
}

/** Minimal structural view of a Zod schema's `safeParse` we depend on. */
interface SafeParseSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      };
}

/** Field-error map TanStack Form consumes from a validator (`fieldName -> message`). */
export interface FormValidatorErrors {
  fields: Record<string, string>;
}

/**
 * Adapt a Zod schema into a TanStack Form validator function.
 *
 * Passing a Zod schema directly to `validators.onSubmit` works for plain
 * object schemas, but schemas using `.default()` (or a transform) have a
 * Standard Schema *input* type whose fields are optional while the form's data
 * type has them required — TanStack rejects the mismatch at the type level.
 * This wrapper validates via `safeParse` (so defaults/transforms still run) and
 * maps any Zod issues to the `{ fields }` shape TanStack applies to the matching
 * fields, returning `undefined` when valid. The first issue per field path wins.
 */
export function zodFormValidator<T>(
  schema: SafeParseSchema<T>,
): (args: { value: unknown }) => FormValidatorErrors | undefined {
  return ({ value }) => {
    const result = schema.safeParse(value);
    if (result.success) {
      return undefined;
    }
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.map((part) => String(part)).join('.');
      if (key.length > 0 && !(key in fields)) {
        fields[key] = issue.message;
      }
    }
    return { fields };
  };
}

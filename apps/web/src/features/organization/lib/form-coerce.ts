/*
 * Small submit-time coercers for the organization forms.
 *
 * The shared `@queuenow/shared-validation` settings/branding/org schemas make
 * every field `.optional()`. Native inputs always yield a string (`''` when
 * empty), so an empty optional field would otherwise be submitted as `''` and
 * fail rules like `.email()` / `.url()`. These coercers normalize empties to
 * `undefined` (and numbers to `number`) at submit time — applied when building
 * the coerced value object before the mutation runs — so empty optional fields
 * are simply omitted, without redefining the shared schema.
 */

/** Empty string → `undefined`; otherwise the trimmed string is kept as-is. */
export function emptyToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return value === undefined || value === null ? undefined : String(value);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Empty/blank → `undefined`; otherwise a finite `number` (or `undefined`). */
export function emptyToNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

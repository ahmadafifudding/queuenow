/**
 * Theme injector.
 *
 * Design tokens are CSS custom properties (HSL channels) defined in
 * `src/index.css` and consumed by Tailwind / shadcn (see `tailwind.config.ts`).
 * This module manipulates those tokens at runtime — it does NOT redefine them.
 *
 * - Per-org branding overrides the `--primary` token at runtime (Req 11.3/11.4).
 * - Light/dark is toggled via the Tailwind `class` strategy on the document
 *   root (`.dark` on <html>) (Req 11.5).
 */

/** The CSS custom property that carries the per-org brand color. */
export const PRIMARY_CSS_VARIABLE = '--primary' as const;

/** The class applied to the document root to enable dark mode. */
export const DARK_CLASS = 'dark' as const;

/** Light/dark theme modes supported via the Tailwind `class` strategy. */
export type ThemeMode = 'light' | 'dark';

/** True when a DOM is available (keeps the module safe in non-DOM/test envs). */
function hasDocument(): boolean {
  return typeof document !== 'undefined' && document.documentElement != null;
}

/**
 * Convert a CSS hex color (`#RGB` or `#RRGGBB`) to the `"H S% L%"` HSL-channel
 * string that Tailwind/shadcn tokens expect (they read `hsl(var(--primary))`).
 *
 * Returns `null` when the input is not a valid hex color, so callers can fall
 * back to writing the value unchanged.
 */
export function hexToHslChannels(hex: string): string | null {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match || match[1] === undefined) {
    return null;
  }

  let digits = match[1];
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('');
  }

  const r = Number.parseInt(digits.slice(0, 2), 16) / 255;
  const g = Number.parseInt(digits.slice(2, 4), 16) / 255;
  const b = Number.parseInt(digits.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) {
      hue = (g - b) / delta + (g < b ? 6 : 0);
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue /= 6;
  }

  const h = Math.round(hue * 360);
  const s = Math.round(saturation * 100);
  const l = Math.round(lightness * 100);
  return `${h} ${s}% ${l}%`;
}

/**
 * Inject the organization's brand color into the `--primary` CSS variable on
 * the document root at runtime (Requirement 11.3).
 *
 * The shadcn/Tailwind tokens consume `--primary` as `hsl(var(--primary))`, so
 * the value must be HSL channels (`"H S% L%"`). The backend stores
 * `primaryColor` as a hex (e.g. `#3B82F6`), so a hex input is converted to HSL
 * channels before injection; a value already in channel form is written
 * unchanged. UI reads the variable via Tailwind/shadcn and never hardcodes the
 * brand color (Req 11.4).
 */
export function applyBranding(primaryColor: string): void {
  if (!hasDocument()) {
    return;
  }
  const channels = hexToHslChannels(primaryColor);
  document.documentElement.style.setProperty(PRIMARY_CSS_VARIABLE, channels ?? primaryColor);
}

/**
 * Set the active light/dark theme by toggling the `.dark` class on the document
 * root, matching the Tailwind `class` strategy (Requirement 11.5).
 */
export function applyTheme(mode: ThemeMode): void {
  if (!hasDocument()) {
    return;
  }
  document.documentElement.classList.toggle(DARK_CLASS, mode === 'dark');
}

/** Alias for {@link applyTheme} reading more naturally at call sites. */
export function setTheme(mode: ThemeMode): void {
  applyTheme(mode);
}

/** Read the currently active theme mode from the document root. */
export function getTheme(): ThemeMode {
  if (!hasDocument()) {
    return 'light';
  }
  return document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light';
}

/** Toggle between light and dark, returning the resulting mode. */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

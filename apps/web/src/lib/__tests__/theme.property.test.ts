// Feature: web-app, Property 14: Branding primary color is injected verbatim as a CSS variable
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyBranding, PRIMARY_CSS_VARIABLE } from '../theme';

/**
 * Property 14 — Validates: Requirements 11.3
 *
 * `applyBranding(primaryColor)` injects the org brand color into the `--primary`
 * CSS variable on the document root. shadcn/Tailwind tokens consume that
 * variable as `hsl(var(--primary))`, so the stored value must be HSL channels
 * (`"H S% L%"`):
 *
 *  - A value already in channel form is injected VERBATIM (Req 11.3/11.4).
 *  - The backend stores `primaryColor` as a hex (validated `#RRGGBB`), so a hex
 *    input is converted to the equivalent HSL-channel triple before injection —
 *    otherwise `hsl(#RRGGBB)` is invalid and primary-colored UI disappears.
 *
 * The hex case is validated by an INDEPENDENT HSL→RGB round-trip (not the
 * implementation's forward formula), asserting the injected channels reproduce
 * the original RGB within rounding tolerance.
 */

/** Reset the document root inline style between cases to avoid leakage. */
afterEach(() => {
  document.documentElement.removeAttribute('style');
});

const channel = (max: number): fc.Arbitrary<string> =>
  fc.oneof(
    fc.integer({ min: 0, max }).map((n) => String(n)),
    fc
      .tuple(fc.integer({ min: 0, max }), fc.integer({ min: 0, max: 9 }))
      .map(([whole, frac]) => `${whole}.${frac}`),
  );

/** HSL-channel triples in the exact `"H S% L%"` form shadcn expects. */
const hslChannels: fc.Arbitrary<string> = fc
  .tuple(channel(360), channel(100), channel(100))
  .map(([h, s, l]) => `${h} ${s}% ${l}%`);

/** `#RRGGBB` hex colors (the form the backend stores and validates). */
const hexColor: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`);

const CHANNELS_RE = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/;

/** Independent HSL-channels → RGB (0–255) converter, for the round-trip oracle. */
function channelsToRgb(value: string): [number, number, number] {
  const m = CHANNELS_RE.exec(value);
  if (!m) {
    throw new Error(`not a channel triple: ${value}`);
  }
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

function hexToRgb(hex: string): [number, number, number] {
  const d = hex.replace('#', '');
  return [
    Number.parseInt(d.slice(0, 2), 16),
    Number.parseInt(d.slice(2, 4), 16),
    Number.parseInt(d.slice(4, 6), 16),
  ];
}

describe('Property 14: branding primary color injected as an hsl-channel CSS variable', () => {
  it('injects an HSL-channel value verbatim', () => {
    fc.assert(
      fc.property(hslChannels, (color) => {
        applyBranding(color);
        expect(document.documentElement.style.getPropertyValue(PRIMARY_CSS_VARIABLE)).toBe(color);
      }),
      { numRuns: 200 },
    );
  });

  it('converts a hex color to channels that round-trip back to the same RGB', () => {
    fc.assert(
      fc.property(hexColor, (hex) => {
        applyBranding(hex);
        const injected = document.documentElement.style.getPropertyValue(PRIMARY_CSS_VARIABLE);

        // Must be a valid "H S% L%" triple (not a raw hex inside hsl()).
        expect(injected).toMatch(CHANNELS_RE);

        // Independent round-trip: the channels reproduce the original RGB
        // within a small rounding tolerance.
        const [r1, g1, b1] = hexToRgb(hex);
        const [r2, g2, b2] = channelsToRgb(injected);
        expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(6);
        expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(6);
        expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(6);
      }),
      { numRuns: 200 },
    );
  });

  it('overwrites a prior brand color (no residue from earlier values)', () => {
    fc.assert(
      fc.property(hslChannels, hslChannels, (first, second) => {
        applyBranding(first);
        applyBranding(second);
        expect(document.documentElement.style.getPropertyValue(PRIMARY_CSS_VARIABLE)).toBe(second);
      }),
      { numRuns: 200 },
    );
  });
});

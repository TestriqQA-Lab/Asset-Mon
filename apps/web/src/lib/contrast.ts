/**
 * Tiny WCAG 2.1 contrast helper. Pure function — sRGB luminance + ratio check.
 *
 * Used by the Branding page to warn (not block) when a user-customised
 * text/surface pairing falls below 4.5:1 (AA for normal-sized text).
 */

import { hexToRgb } from './themes';

/** WCAG AA threshold for normal-sized body text. */
export const WCAG_AA_BODY = 4.5;
/** WCAG AA threshold for large text (≥18.66px regular or ≥14px bold) or
 *  non-text UI components like icons / borders. */
export const WCAG_AA_LARGE = 3;

function srgbToLin(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const r = srgbToLin(rgb.r);
  const g = srgbToLin(rgb.g);
  const b = srgbToLin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio per WCAG 2.x — returns a number in `[1, 21]`.
 * Order of arguments doesn't matter. Returns `null` for invalid hex inputs so
 * callers can decide whether to skip the check or fall back.
 */
export function contrastRatio(a: string, b: string): number | null {
  if (!hexToRgb(a) || !hexToRgb(b)) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the pair clears WCAG AA for normal-sized body text (≥ 4.5:1). */
export function meetsAA(a: string, b: string): boolean {
  const r = contrastRatio(a, b);
  return r != null && r >= WCAG_AA_BODY;
}

/** True when the pair clears WCAG AA for large text / UI shapes (≥ 3:1). */
export function meetsAALarge(a: string, b: string): boolean {
  const r = contrastRatio(a, b);
  return r != null && r >= WCAG_AA_LARGE;
}

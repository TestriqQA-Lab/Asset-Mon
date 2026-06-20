/**
 * Runtime application of theme tokens. The post-login shell calls
 * `applyThemeTokens()` whenever the resolved theme changes; that writes the
 * full set of `--am-color-*` / `--am-ink-*` / `--am-brand-*` CSS variables onto
 * `:root` so every Tailwind utility (and every var-based gradient / shadow)
 * snaps to the new palette.
 *
 * Notes for callers
 * - These are no-ops outside of a browser (so they're safe to call from
 *   `useEffect` in code that may be hydrated server-side).
 * - The ramp-derivation matches what `themeToRootCss` writes server-side, so
 *   the client transition from initial paint to the React-applied palette is
 *   visually identical when nothing has changed.
 *
 * Backwards-compat: the old helper signature `applyBrandPalette(hex)` is
 * preserved as a thin wrapper that just patches the primary token and lets the
 * full token resolver fill in the rest.
 */

import {
  type ThemeTokens, type ThemeConfig,
  THEME_TOKENS, THEME_PRESETS, DEFAULT_PRESET,
  resolveTheme, hexToRgb, mixHex,
} from './themes';

function deriveInkRamp(t: ThemeTokens): Record<string, string> {
  return {
    50:  t.bg,
    100: t['surface-muted'],
    200: t.border,
    300: mixHex(t.border, t['text-muted'], 0.5),
    400: t['text-muted'],
    500: mixHex(t['text-muted'], t.text, 0.5),
    600: t.text,
    700: mixHex(t.text, t.heading, 0.5),
    800: mixHex(t.text, t.heading, 0.85),
    900: t.heading,
  };
}

function deriveBrandRamp(primaryHex: string): Record<string, string> {
  const rgb = hexToRgb(primaryHex) || { r: 168, g: 85, b: 247 };
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l0 = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  const hslToHex = (H: number, S: number, L: number) => {
    H = ((H % 360) + 360) % 360;
    if (S === 0) { const v = Math.round(L * 255); const h2 = v.toString(16).padStart(2, '0'); return `#${h2}${h2}${h2}`; }
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
    const p = 2 * L - q;
    const f = (n: number) => {
      const t = ((H / 60 + n) % 6 + 6) % 6;
      if (t < 1) return p + (q - p) * t;
      if (t < 3) return q;
      if (t < 4) return p + (q - p) * (4 - t);
      return p;
    };
    const c = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${c(f(0))}${c(f(2))}${c(f(4))}`;
  };
  const stops: Record<string, number> = {
    50: 0.96, 100: 0.92, 200: 0.85, 300: 0.74, 400: 0.62,
    500: 0.52, 600: 0.45, 700: 0.38, 800: 0.30, 900: 0.22,
  };
  const out: Record<string, string> = {};
  for (const [k, L] of Object.entries(stops)) {
    const sat = Math.max(0.1, Math.min(1, s + (L < 0.5 ? 0.05 : 0) - (L > 0.85 ? 0.25 : 0)));
    out[k] = hslToHex(h, sat, L);
  }
  return out;
}

/**
 * Write the resolved tokens (canonical hex + RGB triplets + ramps) to `:root`.
 * No-op outside the browser.
 */
export function applyThemeTokens(tokens: ThemeTokens): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const k of THEME_TOKENS) {
    const hex = tokens[k];
    const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    root.style.setProperty(`--am-color-${k}`, hex);
    root.style.setProperty(`--am-color-${k}-rgb`, `${rgb.r} ${rgb.g} ${rgb.b}`);
  }
  const ink = deriveInkRamp(tokens);
  for (const [k, v] of Object.entries(ink)) {
    const rgb = hexToRgb(v) || { r: 0, g: 0, b: 0 };
    root.style.setProperty(`--am-ink-${k}`, v);
    root.style.setProperty(`--am-ink-${k}-rgb`, `${rgb.r} ${rgb.g} ${rgb.b}`);
  }
  const brand = deriveBrandRamp(tokens.primary);
  for (const [k, v] of Object.entries(brand)) {
    const rgb = hexToRgb(v) || { r: 0, g: 0, b: 0 };
    root.style.setProperty(`--am-brand-${k}`, v);
    root.style.setProperty(`--am-brand-${k}-rgb`, `${rgb.r} ${rgb.g} ${rgb.b}`);
  }
  const headRgb = hexToRgb(tokens.heading) || { r: 11, g: 16, b: 32 };
  root.style.setProperty('--am-overlay-rgb', `${headRgb.r} ${headRgb.g} ${headRgb.b}`);
}

/** Convenience: resolve a stored `ThemeConfig` and apply it. */
export function applyThemeConfig(theme: Partial<ThemeConfig> | null | undefined): void {
  const resolved = resolveTheme(theme?.preset, theme?.overrides);
  applyThemeTokens(resolved);
}

/**
 * Strip every `--am-*` inline property from `:root`. Used by the branding page
 * before re-applying a freshly chosen preset, so stale per-token overrides
 * don't bleed through between switches.
 */
export function resetThemeTokens(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // `style.removeProperty` only operates on inline-style props (i.e. what
  // applyThemeTokens wrote), not on values inherited from CSS files — which is
  // exactly the scope we want to clear.
  const stylesheetVars = root.style;
  for (let i = stylesheetVars.length - 1; i >= 0; i--) {
    const prop = stylesheetVars.item(i);
    if (prop.startsWith('--am-')) stylesheetVars.removeProperty(prop);
  }
}

/**
 * Legacy shim. Pre-token branding pages stored a single `brandColor` hex; that
 * code path still works — it just patches the `--am-color-primary` token and
 * lets the ramp derivation refill the rest from the default preset.
 */
export function applyBrandPalette(hex: string | undefined | null): void {
  if (!hex) {
    applyThemeTokens(THEME_PRESETS[DEFAULT_PRESET]);
    return;
  }
  applyThemeConfig({ preset: DEFAULT_PRESET, overrides: { primary: hex } });
}

/**
 * Theme token contract + 10 named presets for the post-login (tenant + platform)
 * surface. The marketing landing page is brand-owned and does NOT read these.
 *
 * Storage shape (tenant DB JSON, see `Tenant.settings`):
 *
 *   settings.branding.theme = {
 *     preset: 'default',
 *     overrides: { primary: '#fff', text: '#222', ... }
 *   }
 *
 * Wire shape: keys are SHORT names (`'primary'`, `'bg'`, etc.). When emitted
 * to the DOM they're written as `--am-color-<key>` CSS custom properties on
 * `:root`. Tailwind utilities consume the prefixed variant via `bg-am-primary`,
 * `text-am-heading`, etc. — see `tailwind.config.js`.
 *
 * Two surfaces of variables get emitted on `:root`:
 *
 *   1. The 16 user-facing tokens (`--am-color-<name>` + matching `-rgb`).
 *      These are the ones the Branding picker exposes; presets seed them and
 *      users may override any subset per-tenant.
 *
 *   2. A derived 10-stop neutral ramp (`--am-ink-50…900`) and 10-stop primary
 *      ramp (`--am-brand-50…900`), interpolated from the user tokens. These
 *      back the existing Tailwind `ink-*` / `brand-*` color classes so legacy
 *      dashboard markup picks up the active preset without page-by-page edits.
 */

/* --------------------------- The 16 canonical tokens -------------------------
 *
 * These short names are the JSON-serialised form. The CSS variable for each is
 * `--am-color-<name>`. The user spec lists them as full CSS variable names — we
 * keep the labels visible to the admin (in the Branding page) in that form for
 * clarity, but the data shape uses short keys.
 */
export const THEME_TOKENS = [
  'bg',
  'surface',
  'surface-muted',
  'border',
  'text',
  'text-muted',
  'heading',
  'link',
  'primary',
  'primary-fg',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
  'data',
] as const;

export type ThemeToken = typeof THEME_TOKENS[number];
export type ThemeTokens = Record<ThemeToken, string>;

/** Display labels (shown next to the picker in the Branding page). */
export const TOKEN_DISPLAY: Record<ThemeToken, { cssVar: string; label: string; help: string }> = {
  bg:              { cssVar: '--am-color-bg',            label: 'Page background', help: 'The viewport background behind every page.' },
  surface:         { cssVar: '--am-color-surface',       label: 'Card surface',    help: 'Cards, modals, dropdowns, tables.' },
  'surface-muted': { cssVar: '--am-color-surface-muted', label: 'Muted surface',   help: 'Subtle ribbons, hover backgrounds, table headers.' },
  border:          { cssVar: '--am-color-border',        label: 'Border',          help: 'Card borders, dividers, table rules.' },
  text:            { cssVar: '--am-color-text',          label: 'Body text',       help: 'Default paragraph / row text colour.' },
  'text-muted':    { cssVar: '--am-color-text-muted',    label: 'Muted text',      help: 'Helper, caption and label-style text.' },
  heading:         { cssVar: '--am-color-heading',       label: 'Heading',         help: 'Page titles, card titles, strong text.' },
  link:            { cssVar: '--am-color-link',          label: 'Link',            help: 'Hyperlinks and link-styled actions.' },
  primary:         { cssVar: '--am-color-primary',       label: 'Primary',         help: 'Primary buttons, active states, brand gradients.' },
  'primary-fg':    { cssVar: '--am-color-primary-fg',    label: 'Primary FG',      help: 'Text drawn on top of the primary colour.' },
  accent:          { cssVar: '--am-color-accent',        label: 'Accent',          help: 'Secondary highlight — supporting brand colour.' },
  success:         { cssVar: '--am-color-success',       label: 'Success',         help: 'Positive state pills and success toasts.' },
  warning:         { cssVar: '--am-color-warning',       label: 'Warning',         help: 'Yellow / amber state pills and banners.' },
  danger:          { cssVar: '--am-color-danger',        label: 'Danger',          help: 'Errors, destructive actions, rose state.' },
  info:            { cssVar: '--am-color-info',          label: 'Info',            help: 'Informational state pills and badges.' },
  data:            { cssVar: '--am-color-data',          label: 'Data viz',        help: 'Charts, progress bars, sparklines accent.' },
};

/* --------------------------- hex utilities --------------------------- */

const HEX_RE = /^#[0-9a-f]{6}$/i;
const HEX3_RE = /^#[0-9a-f]{3}$/i;

export function isValidHex(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  return HEX_RE.test(v) || HEX3_RE.test(v);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a) || { r: 0, g: 0, b: 0 };
  const B = hexToRgb(b) || { r: 255, g: 255, b: 255 };
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex); if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  if (s === 0) { const v = Math.round(l * 255); return rgbToHex(v, v, v); }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (n: number) => {
    const t = ((h / 60 + n) % 6 + 6) % 6;
    if (t < 1) return p + (q - p) * t;
    if (t < 3) return q;
    if (t < 4) return p + (q - p) * (4 - t);
    return p;
  };
  return rgbToHex(f(0) * 255, f(2) * 255, f(4) * 255);
}

/* ---------------------- derive helpers (per-preset shades) ---------------------- */

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
  const hsl = hexToHsl(primaryHex) || { h: 250, s: 0.72, l: 0.55 };
  const stops: Record<string, number> = {
    50: 0.96, 100: 0.92, 200: 0.85, 300: 0.74, 400: 0.62,
    500: 0.52, 600: 0.45, 700: 0.38, 800: 0.30, 900: 0.22,
  };
  const out: Record<string, string> = {};
  for (const [k, l] of Object.entries(stops)) {
    const s = Math.max(0.1, Math.min(1, hsl.s + (l < 0.5 ? 0.05 : 0) - (l > 0.85 ? 0.25 : 0)));
    out[k] = hslToHex(hsl.h, s, l);
  }
  return out;
}

/* ------------------------------ Presets ------------------------------ */

export const THEME_PRESET_NAMES = [
  'default', 'slate', 'emerald', 'azure', 'violet',
  'amber', 'rose', 'teal', 'midnight', 'monochrome',
] as const;
export type ThemePreset = typeof THEME_PRESET_NAMES[number];

export const THEME_PRESET_LABELS: Record<ThemePreset, string> = {
  default:    'Default · Technicolor',
  slate:      'Slate · Charcoal & ice',
  emerald:    'Emerald · Sand',
  azure:      'Azure · Sky',
  violet:     'Violet · Lavender',
  amber:      'Amber · Cream',
  rose:       'Rose · Blush',
  teal:       'Teal · Mist',
  midnight:   'Midnight · Neon mint',
  monochrome: 'Monochrome · Mono accent',
};

export const THEME_PRESET_DESCRIPTIONS: Record<ThemePreset, string> = {
  default:    'Matches the landing page — fuchsia / violet / sky tri-gradient on a near-white canvas.',
  slate:      'Neutral charcoal text on icy-blue surfaces. Quiet and businesslike.',
  emerald:    'Emerald primary on warm sand surfaces. Calm and grounded.',
  azure:      'Sky-blue primary on pure white. Crisp, classic SaaS.',
  violet:     'Violet primary with lavender accents and pale-purple surfaces.',
  amber:      'Warm amber primary on cream surfaces. Friendly, tactile.',
  rose:       'Rose primary on blush surfaces. Soft and human.',
  teal:       'Teal primary on minty surfaces. Cool and oceanic.',
  midnight:   'Dark mode. Near-black surfaces with a neon-mint accent.',
  monochrome: 'Pure black / white / gray with a single colour accent.',
};

/** Whether a preset reads as light (dark text on light surface) or dark. */
export const THEME_PRESET_MODE: Record<ThemePreset, 'light' | 'dark'> = {
  default:    'light',
  slate:      'light',
  emerald:    'light',
  azure:      'light',
  violet:     'light',
  amber:      'light',
  rose:       'light',
  teal:       'light',
  midnight:   'dark',
  monochrome: 'light',
};

/** `default` matches the landing page palette. */
const DEFAULT_TOKENS: ThemeTokens = {
  bg:              '#f7f5ff',
  surface:         '#ffffff',
  'surface-muted': '#f1edff',
  border:          '#e3deff',
  text:            '#3a3068',
  'text-muted':    '#7a72a8',
  heading:         '#0b1020',
  link:            '#7c3aed',
  primary:         '#a855f7',
  'primary-fg':    '#ffffff',
  accent:          '#0ea5e9',
  success:         '#10b981',
  warning:         '#f59e0b',
  danger:          '#f43f5e',
  info:            '#22d3ee',
  data:            '#ec4899',
};

const SLATE_TOKENS: ThemeTokens = {
  bg:              '#f1f5f9',
  surface:         '#ffffff',
  'surface-muted': '#e9eef5',
  border:          '#d2dae6',
  text:            '#384357',
  'text-muted':    '#6b7689',
  heading:         '#0f172a',
  link:            '#0284c7',
  primary:         '#334155',
  'primary-fg':    '#ffffff',
  accent:          '#7dd3fc',
  success:         '#16a34a',
  warning:         '#d97706',
  danger:          '#dc2626',
  info:            '#0ea5e9',
  data:            '#475569',
};

const EMERALD_TOKENS: ThemeTokens = {
  bg:              '#faf8f1',
  surface:         '#ffffff',
  'surface-muted': '#f1ede0',
  border:          '#e2dcc7',
  text:            '#3a4434',
  'text-muted':    '#7a8170',
  heading:         '#0f2a1f',
  link:            '#047857',
  primary:         '#059669',
  'primary-fg':    '#ffffff',
  accent:          '#84cc16',
  success:         '#16a34a',
  warning:         '#ca8a04',
  danger:          '#b91c1c',
  info:            '#0891b2',
  data:            '#14b8a6',
};

const AZURE_TOKENS: ThemeTokens = {
  bg:              '#ffffff',
  surface:         '#ffffff',
  'surface-muted': '#f0f7ff',
  border:          '#dbeafe',
  text:            '#1e3a5f',
  'text-muted':    '#5b7a99',
  heading:         '#0c1e3a',
  link:            '#0369a1',
  primary:         '#0284c7',
  'primary-fg':    '#ffffff',
  accent:          '#06b6d4',
  success:         '#059669',
  warning:         '#d97706',
  danger:          '#dc2626',
  info:            '#0ea5e9',
  data:            '#3b82f6',
};

const VIOLET_TOKENS: ThemeTokens = {
  bg:              '#f7f3ff',
  surface:         '#ffffff',
  'surface-muted': '#ede5ff',
  border:          '#dccfff',
  text:            '#3d2d6e',
  'text-muted':    '#7367a6',
  heading:         '#1a0d4a',
  link:            '#7c3aed',
  primary:         '#7c3aed',
  'primary-fg':    '#ffffff',
  accent:          '#c084fc',
  success:         '#16a34a',
  warning:         '#d97706',
  danger:          '#e11d48',
  info:            '#6366f1',
  data:            '#a855f7',
};

const AMBER_TOKENS: ThemeTokens = {
  bg:              '#fbf6ec',
  surface:         '#fffaf2',
  'surface-muted': '#f4ebd6',
  border:          '#e7d9b6',
  text:            '#4a3a1f',
  'text-muted':    '#897553',
  heading:         '#231805',
  link:            '#b45309',
  primary:         '#d97706',
  'primary-fg':    '#ffffff',
  accent:          '#f59e0b',
  success:         '#15803d',
  warning:         '#a16207',
  danger:          '#b91c1c',
  info:            '#0e7490',
  data:            '#f97316',
};

const ROSE_TOKENS: ThemeTokens = {
  bg:              '#fff1f4',
  surface:         '#ffffff',
  'surface-muted': '#ffe0e9',
  border:          '#fbcfdd',
  text:            '#5a2a3d',
  'text-muted':    '#9a6c80',
  heading:         '#3a0a1c',
  link:            '#be185d',
  primary:         '#e11d48',
  'primary-fg':    '#ffffff',
  accent:          '#f472b6',
  success:         '#16a34a',
  warning:         '#d97706',
  danger:          '#9f1239',
  info:            '#7c3aed',
  data:            '#ec4899',
};

const TEAL_TOKENS: ThemeTokens = {
  bg:              '#eefbf9',
  surface:         '#ffffff',
  'surface-muted': '#dff5f1',
  border:          '#bfe9e1',
  text:            '#1d4540',
  'text-muted':    '#5e807c',
  heading:         '#0a2421',
  link:            '#0f766e',
  primary:         '#0d9488',
  'primary-fg':    '#ffffff',
  accent:          '#06b6d4',
  success:         '#15803d',
  warning:         '#d97706',
  danger:          '#be123c',
  info:            '#0891b2',
  data:            '#14b8a6',
};

/** Dark mode. Surfaces are near-black; primary is a neon mint. */
const MIDNIGHT_TOKENS: ThemeTokens = {
  bg:              '#06080f',
  surface:         '#0b1020',
  'surface-muted': '#161c33',
  border:          '#262e4b',
  text:            '#cdd5e8',
  'text-muted':    '#8089a8',
  heading:         '#f6f7fb',
  link:            '#67e8f9',
  primary:         '#34d399',
  'primary-fg':    '#02110b',
  accent:          '#22d3ee',
  success:         '#22c55e',
  warning:         '#facc15',
  danger:          '#fb7185',
  info:            '#38bdf8',
  data:            '#a78bfa',
};

const MONOCHROME_TOKENS: ThemeTokens = {
  bg:              '#fafafa',
  surface:         '#ffffff',
  'surface-muted': '#f0f0f0',
  border:          '#d4d4d4',
  text:            '#3a3a3a',
  'text-muted':    '#737373',
  heading:         '#0a0a0a',
  link:            '#0a0a0a',
  primary:         '#171717',
  'primary-fg':    '#ffffff',
  accent:          '#dc2626',
  success:         '#525252',
  warning:         '#737373',
  danger:          '#dc2626',
  info:            '#525252',
  data:            '#404040',
};

export const THEME_PRESETS: Record<ThemePreset, ThemeTokens> = {
  default:    DEFAULT_TOKENS,
  slate:      SLATE_TOKENS,
  emerald:    EMERALD_TOKENS,
  azure:      AZURE_TOKENS,
  violet:     VIOLET_TOKENS,
  amber:      AMBER_TOKENS,
  rose:       ROSE_TOKENS,
  teal:       TEAL_TOKENS,
  midnight:   MIDNIGHT_TOKENS,
  monochrome: MONOCHROME_TOKENS,
};

export const DEFAULT_PRESET: ThemePreset = 'default';

/** Shape stored under `branding.theme` in tenant settings JSON. */
export type ThemeConfig = {
  preset: ThemePreset;
  overrides: Partial<Record<ThemeToken, string>>;
};

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  preset: DEFAULT_PRESET,
  overrides: {},
};

export function isPreset(s: any): s is ThemePreset {
  return typeof s === 'string' && (THEME_PRESET_NAMES as readonly string[]).includes(s);
}

/** Drop unknown / non-hex entries from a stored overrides map. Pure function. */
export function sanitizeOverrides(
  overrides: Partial<Record<string, string>> | null | undefined,
): Partial<Record<ThemeToken, string>> {
  if (!overrides || typeof overrides !== 'object') return {};
  const out: Partial<Record<ThemeToken, string>> = {};
  for (const k of THEME_TOKENS) {
    const v = overrides[k];
    if (typeof v === 'string' && isValidHex(v)) out[k] = v.toLowerCase();
  }
  return out;
}

/**
 * Resolve a stored ThemeConfig (preset + overrides) into a complete ThemeTokens map.
 * Tolerant of malformed input — falls back to the default preset / empty overrides.
 */
export function resolveTheme(
  preset: string | ThemePreset | null | undefined,
  overrides: Partial<Record<string, string>> | null | undefined,
): ThemeTokens {
  const id: ThemePreset = isPreset(preset) ? preset : DEFAULT_PRESET;
  const base = THEME_PRESETS[id];
  const ov = sanitizeOverrides(overrides);
  return { ...base, ...ov };
}

/**
 * Server-emittable CSS DECLARATIONS for the active theme. Returns just the
 * `--am-*: …;` body — callers wrap in their own selector (e.g. `:root { … }`
 * or `[data-theme="x"] { … }`). Writes both the 16 canonical tokens and the
 * derived ink/brand ramps so legacy Tailwind classes still resolve.
 *
 * `mode` toggles a `color-scheme` hint so native form controls and scrollbars
 * follow the theme.
 */
export function tokensToCssDeclarations(tokens: ThemeTokens, mode: 'light' | 'dark' = 'light'): string {
  const lines: string[] = [];
  lines.push(`color-scheme: ${mode};`);
  for (const k of THEME_TOKENS) {
    const hex = tokens[k];
    const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    lines.push(`--am-color-${k}: ${hex};`);
    lines.push(`--am-color-${k}-rgb: ${rgb.r} ${rgb.g} ${rgb.b};`);
  }
  const ink = deriveInkRamp(tokens);
  for (const [k, v] of Object.entries(ink)) {
    const rgb = hexToRgb(v) || { r: 0, g: 0, b: 0 };
    lines.push(`--am-ink-${k}: ${v};`);
    lines.push(`--am-ink-${k}-rgb: ${rgb.r} ${rgb.g} ${rgb.b};`);
  }
  const brand = deriveBrandRamp(tokens.primary);
  for (const [k, v] of Object.entries(brand)) {
    const rgb = hexToRgb(v) || { r: 0, g: 0, b: 0 };
    lines.push(`--am-brand-${k}: ${v};`);
    lines.push(`--am-brand-${k}-rgb: ${rgb.r} ${rgb.g} ${rgb.b};`);
  }
  const headingRgb = hexToRgb(tokens.heading) || { r: 11, g: 16, b: 32 };
  lines.push(`--am-overlay-rgb: ${headingRgb.r} ${headingRgb.g} ${headingRgb.b};`);
  return lines.join(' ');
}

/** Pretty preset id → ThemePreset narrow type guard helper. */
export { isPreset as isPresetId };

/**
 * Wrapped CSS: `:root { … }` ready to drop straight into a `<style>` block.
 * Use this when the caller renders the return value as-is inside `<style>`.
 *
 * Both `tokensToCss` and `themeToRootCss` are aliases for the same wrapped
 * output — pick whichever reads better at the call site.
 */
export function themeToRootCss(tokens: ThemeTokens, mode: 'light' | 'dark' = 'light'): string {
  return `:root { ${tokensToCssDeclarations(tokens, mode)} }`;
}
export const tokensToCss = themeToRootCss;

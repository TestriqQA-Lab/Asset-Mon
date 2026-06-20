'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, X, Sparkles, RotateCcw, AlertTriangle } from 'lucide-react';
import { api, getSession } from '@/lib/api';
import { Card, SectionHeader, Button, Field, inputClass, Pill } from '@/components/ui';
import { applyBrandPalette, applyThemeTokens, resetThemeTokens } from '@/lib/theme';
import {
  THEME_PRESETS, THEME_PRESET_NAMES, THEME_PRESET_LABELS, THEME_TOKENS,
  resolveTheme, sanitizeOverrides, isValidHex,
  type ThemePreset, type ThemeToken,
} from '@/lib/themes';
import { contrastRatio, WCAG_AA_BODY } from '@/lib/contrast';
import type { TenantSettings } from '@/lib/settings';

const PRESET_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#0f172a'];

/** Pairs we surface in the contrast warning panel — covering the most common
 *  body-text-on-surface combinations a tenant can break. */
const CONTRAST_CHECKS: Array<{ label: string; fg: ThemeToken; bg: ThemeToken }> = [
  { label: 'Body text on background', fg: 'text', bg: 'bg' },
  { label: 'Body text on surface', fg: 'text', bg: 'surface' },
  { label: 'Heading on surface', fg: 'heading', bg: 'surface' },
  { label: 'Muted text on surface', fg: 'text-muted', bg: 'surface' },
  { label: 'Primary FG on primary', fg: 'primary-fg', bg: 'primary' },
];

const TOKEN_LABELS: Record<ThemeToken, string> = {
  bg: 'Background',
  surface: 'Surface',
  'surface-muted': 'Surface (muted)',
  border: 'Border',
  text: 'Text',
  'text-muted': 'Text (muted)',
  heading: 'Heading',
  link: 'Link',
  primary: 'Primary',
  'primary-fg': 'Primary foreground',
  accent: 'Accent',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  data: 'Data',
};

const TOKEN_GROUPS: Array<{ label: string; tokens: ThemeToken[] }> = [
  { label: 'Surfaces', tokens: ['bg', 'surface', 'surface-muted', 'border'] },
  { label: 'Type', tokens: ['text', 'text-muted', 'heading', 'link'] },
  { label: 'Brand', tokens: ['primary', 'primary-fg', 'accent'] },
  { label: 'Status', tokens: ['success', 'warning', 'danger', 'info', 'data'] },
];

export default function BrandingSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery<TenantSettings>({ queryKey: ['tenant-settings'], queryFn: () => api('/tenant-settings') });

  const [color, setColor] = useState<string>('#4f46e5');
  const [appName, setAppName] = useState<string>('AssetMon');
  const [preset, setPreset] = useState<ThemePreset>('default');
  const [overrides, setOverrides] = useState<Partial<Record<ThemeToken, string>>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate local state from saved settings whenever they change.
  useEffect(() => {
    if (!settings.data) return;
    setColor(settings.data.branding.brandColor);
    setAppName(settings.data.branding.appName);
    setPreset((settings.data.branding.theme?.preset as ThemePreset) || 'default');
    setOverrides(sanitizeOverrides(settings.data.branding.theme?.overrides));
  }, [settings.data]);

  // Live preview: push the resolved theme into `:root` while the admin edits.
  const resolved = useMemo(() => resolveTheme(preset, overrides), [preset, overrides]);
  useEffect(() => { applyThemeTokens(resolved); }, [resolved]);
  useEffect(() => { applyBrandPalette(color); }, [color]);

  // Restore the *saved* theme when navigating away (so a previewed-but-unsaved
  // theme doesn't bleed into other pages on accidental back-nav).
  useEffect(() => {
    return () => {
      if (!settings.data) return;
      applyBrandPalette(settings.data.branding.brandColor);
      const saved = resolveTheme(
        settings.data.branding.theme?.preset,
        settings.data.branding.theme?.overrides,
      );
      applyThemeTokens(saved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contrastIssues = useMemo(() => {
    const issues: Array<{ label: string; ratio: number; fg: string; bg: string }> = [];
    for (const c of CONTRAST_CHECKS) {
      const fgHex = resolved[c.fg];
      const bgHex = resolved[c.bg];
      const r = contrastRatio(fgHex, bgHex);
      if (r != null && r < WCAG_AA_BODY) {
        issues.push({ label: c.label, ratio: r, fg: fgHex, bg: bgHex });
      }
    }
    return issues;
  }, [resolved]);

  const save = useMutation({
    mutationFn: () => api('/tenant-settings/branding', {
      method: 'PATCH',
      body: JSON.stringify({
        brandColor: color,
        appName,
        theme: { preset, overrides },
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenant-settings'] }); toast.success('Branding updated'); },
    onError: (e: any) => toast.error(e.message),
  });

  const uploadLogo = async (file: File) => {
    setBusy(true);
    const s = getSession();
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tenant-settings/logo`, {
      method: 'POST', headers: { Authorization: `Bearer ${s?.accessToken}` }, body: fd,
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message || 'Upload failed');
      return;
    }
    qc.invalidateQueries({ queryKey: ['tenant-settings'] });
    toast.success('Logo uploaded');
  };

  const clearLogo = useMutation({
    mutationFn: () => api('/tenant-settings/logo/clear', { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenant-settings'] }); toast.success('Logo cleared'); },
  });

  const logoUrl = settings.data?.branding.logoUrl
    ? `${process.env.NEXT_PUBLIC_API_URL}${settings.data.branding.logoUrl}`
    : null;

  const presetMap = THEME_PRESETS[preset];

  const resetSingle = (t: ThemeToken) => {
    const next = { ...overrides };
    delete next[t];
    setOverrides(next);
  };

  const resetAllToPreset = () => {
    setOverrides({});
    // Force-apply the pristine preset (in case any tokens were dropped from
    // setState's stale closure mid-edit).
    resetThemeTokens();
    applyThemeTokens(THEME_PRESETS[preset]);
    toast.success(`Overrides cleared. Showing "${preset}" preset.`);
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Branding"
        subtitle="Logo, theme color, product name and per-tenant color tokens."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h3 className="text-sm font-semibold text-am-heading">Logo</h3>
            <p className="mt-0.5 text-xs text-am-text-muted">PNG, JPEG, WebP or SVG. Max 1 MB. Recommended height: 32–40px.</p>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-20 w-44 items-center justify-center rounded-xl border border-dashed border-am-border bg-am-bg">
                {logoUrl
                  ? <img src={logoUrl} alt="logo" className="max-h-14 max-w-[160px] object-contain" />
                  : <span className="text-xs text-am-text-muted">No logo</span>}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); if (e.target) e.target.value = ''; }}
                />
                <Button icon={<Upload className="h-4 w-4" />} loading={busy} onClick={() => fileRef.current?.click()}>
                  Upload logo
                </Button>
                {logoUrl && (
                  <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => clearLogo.mutate()}>
                    Remove logo
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-am-heading">Theme preset</h3>
                <p className="mt-0.5 text-xs text-am-text-muted">Pick a starting palette. Switching applies live; you can tweak individual tokens below.</p>
              </div>
              <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={resetAllToPreset}>
                Reset to preset
              </Button>
            </div>
            <div className="mt-4 max-w-md">
              <Field label="Theme">
                <select
                  className={inputClass + ' pr-9'}
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as ThemePreset)}
                >
                  {THEME_PRESET_NAMES.map((p) => (
                    <option key={p} value={p}>{THEME_PRESET_LABELS[p]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {THEME_PRESET_NAMES.map((p) => {
                const m = THEME_PRESETS[p];
                const active = preset === p;
                return (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    title={p}
                    className={
                      'group relative overflow-hidden rounded-lg border p-2 text-left transition-all ' +
                      (active ? 'border-am-primary shadow-pop -translate-y-0.5' : 'border-am-border hover:-translate-y-0.5 hover:shadow-card')
                    }
                  >
                    <div className="flex h-7 items-end gap-1">
                      <span className="h-7 w-3 rounded-sm" style={{ background: m.primary }} />
                      <span className="h-7 w-3 rounded-sm" style={{ background: m.accent }} />
                      <span className="h-7 w-3 rounded-sm" style={{ background: m.info }} />
                      <span className="h-7 w-3 rounded-sm" style={{ background: m.success }} />
                    </div>
                    <div className="mt-2 truncate text-[11px] font-medium capitalize text-am-text">{p}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-am-heading">Customize colors</h3>
                <p className="mt-0.5 text-xs text-am-text-muted">
                  Override any of the 16 tokens. Each starts at the preset value and snaps back when reset.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-5">
              {TOKEN_GROUPS.map((group) => (
                <div key={group.label}>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-am-text-muted">{group.label}</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.tokens.map((t) => (
                      <TokenRow
                        key={t}
                        token={t}
                        presetValue={presetMap[t]}
                        value={overrides[t] ?? presetMap[t]}
                        overridden={overrides[t] != null}
                        onChange={(hex) => setOverrides({ ...overrides, [t]: hex })}
                        onReset={() => resetSingle(t)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {contrastIssues.length > 0 && (
              <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">{contrastIssues.length} contrast warning{contrastIssues.length === 1 ? '' : 's'} (WCAG AA · 4.5:1)</p>
                    <ul className="mt-1.5 space-y-1">
                      {contrastIssues.map((i) => (
                        <li key={i.label} className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="h-3 w-3 rounded-sm border border-amber-300" style={{ background: i.fg }} />
                            <span className="h-3 w-3 rounded-sm border border-amber-300" style={{ background: i.bg }} />
                          </span>
                          {i.label}: <span className="font-mono">{i.ratio.toFixed(2)}:1</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-amber-800">Warnings don't block save — but small or muted text may be hard to read.</p>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-am-heading">Brand color (legacy)</h3>
            <p className="mt-0.5 text-xs text-am-text-muted">Drives the small `brand-*` palette used in pills and the trial banner. Most tenants prefer to leave this alone.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border border-am-border sm:h-10"
              />
              <input
                className={inputClass + ' w-32 font-mono'} value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    title={c}
                    className={`h-8 w-8 rounded-lg ring-2 sm:h-7 sm:w-7 ${color.toLowerCase() === c.toLowerCase() ? 'ring-offset-2 ring-am-heading' : 'ring-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-am-heading">App name</h3>
            <p className="mt-0.5 text-xs text-am-text-muted">Shown in the sidebar and browser tab.</p>
            <div className="mt-3 max-w-sm">
              <Field label="">
                <input className={inputClass} value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={64} />
              </Field>
            </div>
          </Card>
        </div>

        <Card>
          <h3 className="text-sm font-semibold text-am-heading">Live preview</h3>
          <p className="mt-0.5 text-xs text-am-text-muted">All edits show here in real time. Save to lock them in.</p>

          <div className="mt-4 overflow-hidden rounded-xl border border-am-border shadow-card" style={{ background: resolved.surface, color: resolved.text }}>
            <div className="flex items-center gap-2.5 border-b px-3 py-2" style={{ borderColor: resolved.border, background: resolved['surface-muted'] }}>
              {logoUrl
                ? <img src={logoUrl} alt="" className="h-6 max-w-[120px] object-contain" />
                : (
                  <>
                    <div className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold" style={{ background: `linear-gradient(135deg, ${resolved.primary}, ${resolved.accent})`, color: resolved['primary-fg'] }}>
                      {appName.charAt(0)}
                    </div>
                    <span className="text-xs font-semibold" style={{ color: resolved.heading }}>{appName}</span>
                  </>
                )}
              <Pill tone="purple" className="ml-auto capitalize">{preset}</Pill>
            </div>
            <div className="space-y-3 p-3">
              <div className="flex items-center justify-between">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: resolved.success + '22', color: resolved.success }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: resolved.success }} /> active
                </span>
                <span className="text-[10px]" style={{ color: resolved['text-muted'] }}>preview</span>
              </div>
              <button
                className="w-full rounded-lg px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
                style={{ background: resolved.primary, color: resolved['primary-fg'] }}
              >
                Primary button
              </button>
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: resolved['surface-muted'] }}>
                <div className="h-full w-3/5 rounded-full" style={{ background: `linear-gradient(90deg, ${resolved.primary}, ${resolved.accent})` }} />
              </div>
              <div className="rounded-lg p-2 text-[11px]" style={{ background: resolved['surface-muted'], color: resolved.text }}>
                <Sparkles className="-mt-0.5 mr-1 inline h-3 w-3" style={{ color: resolved.accent }} />
                Sample surface
              </div>
              <a className="block text-[11px] underline" style={{ color: resolved.link }}>Link example →</a>
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <Swatch label="success" color={resolved.success} />
                <Swatch label="warning" color={resolved.warning} />
                <Swatch label="danger" color={resolved.danger} />
                <Swatch label="info" color={resolved.info} />
                <Swatch label="data" color={resolved.data} />
                <Swatch label="accent" color={resolved.accent} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-am-border bg-am-surface/90 px-4 py-2 shadow-card backdrop-blur">
        <span className="mr-auto text-[11px] text-am-text-muted">
          {Object.keys(overrides).length} override{Object.keys(overrides).length === 1 ? '' : 's'} active on “{preset}”
        </span>
        <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={resetAllToPreset}>
          Reset to default
        </Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save theme</Button>
      </div>
    </div>
  );
}

function TokenRow({
  token, value, presetValue, overridden, onChange, onReset,
}: {
  token: ThemeToken;
  value: string;
  presetValue: string;
  overridden: boolean;
  onChange: (hex: string) => void;
  onReset: () => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-am-border bg-am-bg/30 p-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${TOKEN_LABELS[token]} color`}
        className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-am-border bg-transparent"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <label className="truncate text-xs font-medium text-am-text">{TOKEN_LABELS[token]}</label>
          {overridden && (
            <span className="rounded-full bg-am-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-am-primary">overridden</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (isValidHex(text)) onChange(text); else setText(value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setText(value);
            }}
            spellCheck={false}
            aria-label={`${TOKEN_LABELS[token]} hex`}
            className="w-24 rounded-md border border-am-border bg-am-surface px-2 py-1 text-[11px] font-mono text-am-text focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <span className="truncate font-mono text-[10px] text-am-text-muted" title={`Preset: ${presetValue}`}>
            preset {presetValue}
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={!overridden}
            title={`Reset ${TOKEN_LABELS[token]} to preset`}
            className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-am-text-muted hover:bg-am-surface-muted disabled:cursor-not-allowed disabled:opacity-30"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[10px]">
      <span className="h-3.5 w-3.5 rounded border" style={{ background: color, borderColor: 'rgba(0,0,0,0.08)' }} />
      <span className="truncate" style={{ color: 'var(--am-color-text-muted)' }}>{label}</span>
    </div>
  );
}

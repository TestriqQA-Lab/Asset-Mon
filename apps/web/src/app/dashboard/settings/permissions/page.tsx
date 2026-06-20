'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, RotateCcw, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, SectionHeader, Button, Pill } from '@/components/ui';
import {
  CUSTOMISABLE_ROLES, NAV_KEYS, NAV_LABELS, NAV_GROUPS, LOCKED_NAV_KEYS,
  DEFAULT_PERMISSIONS, mergePermissions,
  type CustomisableRole, type NavKey, type TenantPermissions,
} from '@/lib/permissions';
import { usePermissions, type TenantSettings } from '@/lib/settings';

const ROLE_DISPLAY: Record<CustomisableRole, { label: string; subtitle: string; tone: 'brand' | 'amber' | 'green' }> = {
  ASSET_MANAGER: { label: 'Asset Manager', subtitle: 'Ops staff who run day-to-day inventory, tickets and procurement.', tone: 'brand' },
  EMPLOYEE:      { label: 'Employee',      subtitle: 'Self-service: their own assignments, raising tickets, requesting reservations.', tone: 'green' },
};

export default function PermissionsSettingsPage() {
  const qc = useQueryClient();
  const me = usePermissions();
  const settings = useQuery<TenantSettings>({ queryKey: ['tenant-settings'], queryFn: () => api('/tenant-settings') });

  const [draft, setDraft] = useState<TenantPermissions | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(mergePermissions(settings.data.permissions));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api('/tenant-settings/permissions', { method: 'PATCH', body: JSON.stringify(draft) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.success('Permissions saved');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save permissions'),
  });

  const dirty = useMemo(() => {
    if (!draft || !settings.data) return false;
    const stored = mergePermissions(settings.data.permissions);
    for (const role of CUSTOMISABLE_ROLES) {
      for (const k of NAV_KEYS) {
        if (draft[role].nav[k] !== stored[role].nav[k]) return true;
      }
    }
    return false;
  }, [draft, settings.data]);

  if (!me.isAdmin) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <Lock className="h-5 w-5 text-ink-400" />
          <div>
            <h2 className="text-sm font-semibold text-am-heading">Permissions are admin-only</h2>
            <p className="mt-0.5 text-xs text-am-text-muted">Only workspace admins can change who sees what.</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!draft) return null;

  const toggle = (role: CustomisableRole, key: NavKey, value: boolean) => {
    if (LOCKED_NAV_KEYS.has(key)) return;
    setDraft((d) => d ? { ...d, [role]: { ...d[role], nav: { ...d[role].nav, [key]: value } } } : d);
  };

  const resetToDefault = (role: CustomisableRole) => {
    setDraft((d) => d ? { ...d, [role]: { nav: { ...DEFAULT_PERMISSIONS[role].nav } } } : d);
  };

  const setAllInGroup = (role: CustomisableRole, keys: NavKey[], value: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const nav = { ...d[role].nav };
      for (const k of keys) {
        if (!LOCKED_NAV_KEYS.has(k)) nav[k] = value;
      }
      return { ...d, [role]: { ...d[role], nav } };
    });
  };

  const countEnabled = (role: CustomisableRole) =>
    NAV_KEYS.filter((k) => draft[role].nav[k]).length;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Permissions"
        subtitle="Choose which pages each role can see. Workspace admins always have full access — only ASSET_MANAGER and EMPLOYEE are editable."
        action={<Pill tone="brand" dot>{NAV_KEYS.length} permissions</Pill>}
      />

      {/* Role legend */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-am-primary/10 text-am-primary ring-1 ring-inset ring-am-primary/30">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-am-heading">Admin</div>
              <div className="mt-0.5 text-xs text-am-text-muted">Always full access. Not editable.</div>
              <div className="mt-2 text-[11px] text-am-text-muted">{NAV_KEYS.length} / {NAV_KEYS.length}</div>
            </div>
          </div>
        </Card>
        {CUSTOMISABLE_ROLES.map((role) => {
          const meta = ROLE_DISPLAY[role];
          const n = countEnabled(role);
          return (
            <Card key={role}>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-am-surface-muted text-am-text ring-1 ring-inset ring-am-border">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-am-heading">{meta.label}</div>
                    <button
                      onClick={() => resetToDefault(role)}
                      className="inline-flex items-center gap-1 rounded-md border border-am-border bg-am-surface px-2 py-0.5 text-[10px] font-medium text-am-text-muted hover:bg-am-surface-muted"
                      title="Reset to defaults"
                    >
                      <RotateCcw className="h-3 w-3" /> Reset
                    </button>
                  </div>
                  <div className="mt-0.5 text-xs text-am-text-muted">{meta.subtitle}</div>
                  <div className="mt-2 text-[11px] text-am-text-muted">{n} / {NAV_KEYS.length}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Matrix */}
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-am-surface-muted text-[11px] uppercase tracking-wider text-am-text-muted">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Page</th>
                <th className="px-4 py-2 text-center font-semibold">Admin</th>
                {CUSTOMISABLE_ROLES.map((role) => (
                  <th key={role} className="px-4 py-2 text-center font-semibold">{ROLE_DISPLAY[role].label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-am-border">
              {NAV_GROUPS.map((group) => (
                <>
                  <tr key={`g-${group.label}`} className="bg-am-bg/30">
                    <td className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-am-text-muted">
                      {group.label}
                    </td>
                    <td className="px-4 py-2"></td>
                    {CUSTOMISABLE_ROLES.map((role) => {
                      const editable = group.keys.filter((k) => !LOCKED_NAV_KEYS.has(k));
                      const allOn = editable.length > 0 && editable.every((k) => draft[role].nav[k]);
                      const allOff = editable.length > 0 && editable.every((k) => !draft[role].nav[k]);
                      return (
                        <td key={role} className="px-4 py-2 text-center">
                          <div className="flex justify-center gap-1">
                            <button
                              onClick={() => setAllInGroup(role, group.keys, true)}
                              disabled={allOn || editable.length === 0}
                              className="rounded border border-am-border bg-am-surface px-1.5 py-0.5 text-[10px] font-medium text-am-text-muted hover:bg-am-surface-muted disabled:opacity-30"
                            >
                              all on
                            </button>
                            <button
                              onClick={() => setAllInGroup(role, group.keys, false)}
                              disabled={allOff || editable.length === 0}
                              className="rounded border border-am-border bg-am-surface px-1.5 py-0.5 text-[10px] font-medium text-am-text-muted hover:bg-am-surface-muted disabled:opacity-30"
                            >
                              all off
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {group.keys.map((key) => {
                    const locked = LOCKED_NAV_KEYS.has(key);
                    return (
                      <tr key={key} className="hover:bg-am-surface-muted/40">
                        <td className="px-4 py-2 pl-8">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-am-text">{NAV_LABELS[key]}</span>
                            {locked && (
                              <span title="Always on — required by everyone" className="inline-flex items-center gap-1 rounded-full bg-am-surface-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-am-text-muted">
                                <Lock className="h-2.5 w-2.5" /> always on
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <Toggle checked disabled />
                        </td>
                        {CUSTOMISABLE_ROLES.map((role) => (
                          <td key={role} className="px-4 py-2 text-center">
                            <Toggle
                              checked={!!draft[role].nav[key]}
                              disabled={locked}
                              onChange={(v) => toggle(role, key, v)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-am-border bg-am-surface/90 px-4 py-2 shadow-card backdrop-blur">
        <span className="mr-auto text-[11px] text-am-text-muted">
          Hidden pages also block the matching API surface for defence in depth.
        </span>
        {dirty
          ? <span className="text-xs text-amber-700">Unsaved changes</span>
          : <span className="text-xs text-am-text-muted">All changes saved</span>}
        <Button
          variant="secondary"
          onClick={() => settings.data && setDraft(mergePermissions(settings.data.permissions))}
          disabled={!dirty}
        >Reset</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save permissions
        </Button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange?.(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-am-primary' : 'bg-am-border'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wrench, CalendarClock, FileText, ShoppingCart, TrendingDown,
  AppWindow, ClipboardCheck, BarChart3, Webhook, Sliders,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, SectionHeader, Button, Pill } from '@/components/ui';
import { MODULE_KEYS, type ModuleKey, type TenantSettings } from '@/lib/settings';

type ModuleInfo = { key: ModuleKey; name: string; description: string; icon: React.ReactNode };
const MODULES: ModuleInfo[] = [
  { key: 'tickets',      name: 'Service tickets',  description: 'Open, assign, and resolve repair / support requests for assets.', icon: <Wrench className="h-4 w-4" /> },
  { key: 'maintenance',  name: 'Maintenance',      description: 'Recurring preventive maintenance schedules with auto-bumping due dates.', icon: <CalendarClock className="h-4 w-4" /> },
  { key: 'reservations', name: 'Reservations',     description: 'Book shared assets for a time window with conflict detection.', icon: <CalendarClock className="h-4 w-4" /> },
  { key: 'audits',       name: 'Physical audits',  description: 'Scheduled inventory audits with scan-to-audit and discrepancy reports.', icon: <ClipboardCheck className="h-4 w-4" /> },
  { key: 'procurement',  name: 'Procurement',      description: 'Purchase requests and orders, with receive-to-asset auto-creation.', icon: <ShoppingCart className="h-4 w-4" /> },
  { key: 'depreciation', name: 'Depreciation',     description: 'Straight-line and declining-balance depreciation schedule + book value.', icon: <TrendingDown className="h-4 w-4" /> },
  { key: 'software',     name: 'Software & licenses', description: 'Track software products, license seats, expirations and compliance.', icon: <AppWindow className="h-4 w-4" /> },
  { key: 'reports',      name: 'Reports',          description: 'Built-in report library with CSV export.', icon: <BarChart3 className="h-4 w-4" /> },
  { key: 'integrations', name: 'Integrations',     description: 'API keys for external automation and webhooks for outbound events.', icon: <Webhook className="h-4 w-4" /> },
];

export default function ModulesSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery<TenantSettings>({ queryKey: ['tenant-settings'], queryFn: () => api('/tenant-settings') });
  const [state, setState] = useState<Record<ModuleKey, boolean> | null>(null);
  useEffect(() => { if (settings.data) setState(settings.data.modules); }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api('/tenant-settings/modules', { method: 'PATCH', body: JSON.stringify({ modules: state }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenant-settings'] }); toast.success('Module settings saved'); },
    onError: (e: any) => toast.error(e.message),
  });

  const enabledCount = state ? Object.values(state).filter(Boolean).length : 0;
  const totalCount = MODULE_KEYS.length;
  const dirty = state && settings.data && MODULE_KEYS.some((k) => state[k] !== settings.data!.modules[k]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Modules"
        subtitle="Turn features on or off across your workspace. Disabled modules are hidden from the sidebar and blocked at the API."
        action={<Pill tone="brand" dot>{enabledCount} / {totalCount} enabled</Pill>}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {MODULES.map((m) => {
          const on = !!state?.[m.key];
          return (
            <Card key={m.key} padded={false} className={on ? '' : 'opacity-80'}>
              <div className="flex items-start gap-3 p-4">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${on ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-ink-50 text-ink-400 ring-ink-200'}`}>
                  {m.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink-900">{m.name}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{m.description}</div>
                    </div>
                    <Toggle
                      checked={on}
                      onChange={(v) => setState((s) => s ? { ...s, [m.key]: v } : s)}
                    />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-xl border border-ink-200 bg-white/90 px-4 py-2 shadow-card backdrop-blur">
        {dirty
          ? <span className="text-xs text-amber-700">Unsaved changes</span>
          : <span className="text-xs text-ink-400">All changes saved</span>}
        <Button
          variant="secondary"
          onClick={() => settings.data && setState(settings.data.modules)}
          disabled={!dirty}
        >Reset</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-ink-200'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

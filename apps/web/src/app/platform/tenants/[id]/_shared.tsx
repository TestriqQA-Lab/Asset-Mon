// Shared helpers and constants for the tenant detail sub-pages.
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { ModuleKey } from '@/lib/settings';

export const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  ACTIVE: 'green', PROVISIONING: 'amber', SUSPENDED: 'red', DELETED: 'gray',
};

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

export function Row({ label, value, mono, onCopy, copied }: { label: string; value: string; mono?: boolean; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-100 py-1.5 last:border-0">
      <span className="text-xs text-ink-500">{label}</span>
      <span className={'text-xs ' + (mono ? 'font-mono text-ink-800' : 'text-ink-700')}>
        {value}
        {onCopy && (
          <button onClick={onCopy} className="ml-1 inline-flex rounded p-0.5 align-text-bottom text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </span>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${checked ? 'bg-brand-600' : 'bg-ink-200'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export const MODULES: { key: ModuleKey; name: string; description: string }[] = [
  { key: 'tickets',      name: 'Service tickets',     description: 'Open, assign, and resolve repair / support requests for assets.' },
  { key: 'maintenance',  name: 'Maintenance',         description: 'Recurring preventive maintenance schedules.' },
  { key: 'reservations', name: 'Reservations',        description: 'Book shared assets for a time window.' },
  { key: 'audits',       name: 'Physical audits',     description: 'Scheduled inventory audits with discrepancy reports.' },
  { key: 'procurement',  name: 'Procurement',         description: 'Purchase requests and orders.' },
  { key: 'depreciation', name: 'Depreciation',        description: 'Depreciation schedules and book value.' },
  { key: 'software',     name: 'Software & licenses', description: 'Software products, license seats and expirations.' },
  { key: 'reports',      name: 'Reports',             description: 'Built-in report library with CSV export.' },
  { key: 'integrations', name: 'Integrations',        description: 'API keys and outbound webhooks.' },
];

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

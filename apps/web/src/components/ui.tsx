'use client';
import React from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

/* ----------------------- helpers ----------------------- */
export function cn(...parts: (string | undefined | false | null)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ----------------------- Button ----------------------- */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
};
export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, ...rest }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';
  // Bump default + medium sizes by ~4px on mobile so all primary buttons clear
  // a 40px tap target without overshooting on desktop.
  const sizes = { sm: 'h-9 px-3 text-xs sm:h-8', md: 'h-10 px-3.5 text-sm sm:h-9', lg: 'h-11 px-5 text-sm' };
  const variants: Record<string, string> = {
    primary: 'bg-ink-900 text-white hover:bg-ink-800 shadow-soft',
    secondary: 'bg-white text-ink-700 border border-ink-200 hover:border-ink-300 hover:bg-ink-50 shadow-soft',
    ghost: 'text-ink-700 hover:bg-ink-100',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-soft',
    link: 'text-brand-600 hover:text-brand-700 underline-offset-2 hover:underline',
  };
  return (
    <button className={cn(base, sizes[size], variants[variant], className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ----------------------- Inputs ----------------------- */
// Mobile: 44px tall + 16px font (so iOS Safari does not zoom on focus).
// Desktop (sm:+): collapse to the existing dense 36px / 14px style.
export const inputClass =
  'w-full h-11 rounded-lg border border-ink-200 bg-white px-3 text-base text-ink-900 placeholder:text-ink-400 transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:h-9 sm:text-sm';
export const textareaClass =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-400 transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:py-2 sm:text-sm';
export const selectClass = inputClass + ' pr-8 appearance-none bg-no-repeat bg-[right_0.6rem_center] bg-[length:1em_1em] bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\' fill=\'%23525c7d\'%3e%3cpath fill-rule=\'evenodd\' d=\'M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z\' clip-rule=\'evenodd\'/%3e%3c/svg%3e")]';

export function Field({ label, hint, children, error }: { label?: string; hint?: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-medium text-ink-600">{label}</span>}
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
      {hint && !error && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

/* ----------------------- Card / Surface ----------------------- */
export const Card = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string; padded?: boolean }>(
  ({ children, className, padded = true }, ref) => {
    return (
      <div ref={ref} className={cn('rounded-xl border border-ink-200 bg-white shadow-card', padded && 'p-5', className)}>
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/* ----------------------- Pill (status badge) ----------------------- */
const PILL_THEMES: Record<string, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
};
export function Pill({ children, tone = 'neutral', dot, className }: { children: React.ReactNode; tone?: keyof typeof PILL_THEMES; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', PILL_THEMES[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'green' && 'bg-emerald-500', tone === 'red' && 'bg-rose-500', tone === 'amber' && 'bg-amber-500', tone === 'blue' && 'bg-sky-500', tone === 'brand' && 'bg-brand-500', tone === 'purple' && 'bg-violet-500', (tone === 'neutral' || tone === 'gray') && 'bg-ink-400')} />}
      {children}
    </span>
  );
}

// Status mapping helpers — keep all status colors consistent everywhere.
const ASSET_STATUS_TONE: Record<string, keyof typeof PILL_THEMES> = {
  PENDING: 'amber', AVAILABLE: 'green', ASSIGNED: 'blue', OUT_OF_SERVICE: 'red', OUT_FOR_REPAIR: 'amber', LOST_STOLEN: 'red', ARCHIVED: 'gray',
};
// `def` is the tenant's custom AssetStatusDef row; falls back to system enum styling.
export function AssetStatusPill({ s, def }: { s: string; def?: { label?: string; color?: string } | null }) {
  const tone = (def?.color as keyof typeof PILL_THEMES) || ASSET_STATUS_TONE[s] || 'neutral';
  // Preserve the tenant's chosen casing for custom labels; only upcase the raw enum fallback.
  const label = def?.label || s.replaceAll('_', ' ').toUpperCase();
  return <Pill dot tone={tone}>{label}</Pill>;
}

const TICKET_STATUS_TONE: Record<string, keyof typeof PILL_THEMES> = {
  OPEN: 'blue', IN_PROGRESS: 'amber', WAITING_VENDOR: 'purple', RESOLVED: 'green', CLOSED: 'gray', CANCELLED: 'gray',
};
export function TicketStatusPill({ s }: { s: string }) { return <Pill dot tone={TICKET_STATUS_TONE[s] || 'neutral'}>{s.replace('_', ' ')}</Pill>; }

const PRIORITY_TONE: Record<string, keyof typeof PILL_THEMES> = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' };
export function PriorityPill({ p }: { p: string }) { return <Pill tone={PRIORITY_TONE[p] || 'neutral'}>{p}</Pill>; }

const PR_TONE: Record<string, keyof typeof PILL_THEMES> = {
  DRAFT: 'gray', SUBMITTED: 'blue', APPROVED: 'green', REJECTED: 'red', ORDERED: 'purple', CANCELLED: 'gray',
};
export function PRStatusPill({ s }: { s: string }) { return <Pill dot tone={PR_TONE[s] || 'neutral'}>{s}</Pill>; }

const PO_TONE: Record<string, keyof typeof PILL_THEMES> = {
  DRAFT: 'gray', SENT: 'blue', PARTIAL: 'amber', RECEIVED: 'green', CANCELLED: 'gray',
};
export function POStatusPill({ s }: { s: string }) { return <Pill dot tone={PO_TONE[s] || 'neutral'}>{s}</Pill>; }

const RES_TONE: Record<string, keyof typeof PILL_THEMES> = {
  REQUESTED: 'gray', CONFIRMED: 'blue', CHECKED_OUT: 'amber', COMPLETED: 'green', CANCELLED: 'gray',
};
export function ReservationStatusPill({ s }: { s: string }) { return <Pill dot tone={RES_TONE[s] || 'neutral'}>{s.replace('_', ' ')}</Pill>; }

const AUD_TONE: Record<string, keyof typeof PILL_THEMES> = {
  PLANNED: 'gray', IN_PROGRESS: 'amber', COMPLETED: 'green', CANCELLED: 'gray',
};
export function AuditStatusPill({ s }: { s: string }) { return <Pill dot tone={AUD_TONE[s] || 'neutral'}>{s.replace('_', ' ')}</Pill>; }

/* ----------------------- Empty / Skeleton ----------------------- */
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white/60 py-12 text-center">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon}</div>}
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-md bg-ink-100', className)} />;
}

/* ----------------------- QueryState ----------------------- */
/**
 * Standard renderer for a useQuery result: loading skeleton, error card, or children.
 * Covers ~30 separate "loading" / "error" call-sites that previously rendered a
 * blank screen when a request failed.
 */
export function QueryState<T>({
  query,
  loading,
  empty,
  children,
}: {
  query: { isLoading?: boolean; isPending?: boolean; isError?: boolean; error?: any; data?: T | undefined };
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading || query.isPending) {
    return <>{loading ?? <div className="space-y-2"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-6" /></div>}</>;
  }
  if (query.isError) {
    const msg = (query.error?.message as string) || 'Failed to load';
    return (
      <Card className="border-rose-200 bg-rose-50/40">
        <p className="text-sm font-medium text-rose-700">{msg}</p>
        <p className="mt-1 text-xs text-rose-600">Refresh the page or try again in a moment.</p>
      </Card>
    );
  }
  const isEmpty =
    query.data == null ||
    (Array.isArray(query.data) && query.data.length === 0) ||
    (typeof query.data === 'object' && query.data && 'rows' in (query.data as any) && Array.isArray((query.data as any).rows) && (query.data as any).rows.length === 0);
  if (isEmpty && empty != null) return <>{empty}</>;
  return <>{children(query.data as T)}</>;
}

/* ----------------------- Table primitives ----------------------- */
export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

/**
 * Stacked card view for mobile breakpoints. Pages render this alongside their
 * desktop `<table>`, hiding one or the other via Tailwind responsive classes
 * (e.g. `hidden md:block` for the table, `md:hidden` for the cards).
 */
export function MobileCard({
  onClick, children, className,
}: { onClick?: () => void; children: React.ReactNode; className?: string }) {
  // A clickable card is deliberately NOT a <button>, even though it behaves
  // like one. Several of these cards carry their own Edit/Delete buttons
  // (assets, licenses), and a <button> inside a <button> is invalid HTML — the
  // browser silently restructures the DOM to repair it, which then no longer
  // matches what React rendered and breaks hydration.
  //
  // A div with role/tabIndex/keyboard handling is operable exactly the same way
  // and can legally contain the nested controls. Classes are unchanged so
  // nothing moves.
  const classes = cn(
    'w-full rounded-xl border border-ink-200 bg-white p-3.5 text-left shadow-card',
    onClick && 'cursor-pointer transition-colors active:bg-ink-50 hover:border-ink-300',
    className,
  );

  if (!onClick) return <div className={classes}>{children}</div>;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // Only act when the card itself has focus. A nested Edit/Delete button
        // keeps its own Enter/Space behaviour instead of also opening the card.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={classes}
    >
      {children}
    </div>
  );
}

export function MobileCardRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-ink-500">{label}</span>
      <span className={cn('text-right text-ink-700 truncate', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-ink-50/60">
      <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">{children}</tr>
    </thead>
  );
}
export function TH({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-2.5', className)}>{children}</th>;
}
export function TBody({ children }: { children: React.ReactNode }) { return <tbody>{children}</tbody>; }
export function TR({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-t border-ink-100 transition-colors',
        onClick && 'cursor-pointer hover:bg-ink-50',
        className,
      )}
    >
      {children}
    </tr>
  );
}
export function TD({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: (e: any) => void }) {
  return <td className={cn('px-4 py-3 align-middle text-ink-700', className)} onClick={onClick}>{children}</td>;
}

/* ----------------------- StatCard ----------------------- */
export function StatCard({
  label, value, hint, accent = 'neutral', icon, href, onClick,
}: {
  label: string;
  value: any;
  hint?: string;
  accent?: 'brand' | 'green' | 'amber' | 'red' | 'neutral';
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const accentBg: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  };

  const containerClass = cn(
    'group relative block rounded-xl border border-ink-200 bg-white p-4 text-left shadow-card transition-all w-full',
    (href || onClick)
      ? 'cursor-pointer hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40'
      : 'hover:-translate-y-0.5 hover:shadow-pop',
  );

  const body = (
    <>
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">{label}</div>
        {icon && <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset', accentBg[accent])}>{icon}</div>}
      </div>
      <div className={cn('mt-3 text-2xl font-semibold tracking-tight text-ink-900', (href || onClick) && 'transition-colors group-hover:text-brand-700')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </>
  );

  if (href) {
    // Every dashboard stat tile is a link into the app. A raw <a> would reload
    // the whole bundle and re-authenticate on each click; Link navigates on the
    // client. External URLs still fall back to <a>.
    if (href.startsWith('/')) {
      return (
        <Link href={href} aria-label={`${label}: ${value}`} className={containerClass}>
          {body}
        </Link>
      );
    }
    return (
      <a href={href} aria-label={`${label}: ${value}`} className={containerClass}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button onClick={onClick} type="button" aria-label={`${label}: ${value}`} className={containerClass}>
        {body}
      </button>
    );
  }
  return <div className={containerClass}>{body}</div>;
}

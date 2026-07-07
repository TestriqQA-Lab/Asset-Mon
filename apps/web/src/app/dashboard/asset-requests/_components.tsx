import React from 'react';
import { Pill, StatCard, cn } from '@/components/ui';
import { Inbox, Clock, AlertTriangle, CheckCircle2, Archive } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Pills                                                                     */
/* -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', DECLINED: 'Declined',
  FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<string, 'brand' | 'green' | 'amber' | 'red' | 'neutral'> = {
  PENDING: 'amber', APPROVED: 'brand', DECLINED: 'red',
  FULFILLED: 'green', CANCELLED: 'neutral',
};

export function RequestStatusPill({ s }: { s: string }) {
  return <Pill tone={STATUS_TONE[s] || 'neutral'}>{STATUS_LABELS[s] || s}</Pill>;
}

const URGENCY_TONE: Record<string, 'brand' | 'green' | 'amber' | 'red' | 'neutral'> = {
  LOW: 'neutral', NORMAL: 'brand', HIGH: 'amber', URGENT: 'red',
};

export function RequestUrgencyPill({ u }: { u: string }) {
  return <Pill tone={URGENCY_TONE[u] || 'neutral'}>{u}</Pill>;
}

/* -------------------------------------------------------------------------- */
/*  Age Badge                                                                 */
/* -------------------------------------------------------------------------- */

export function AgeBadge({ daysOpen }: { daysOpen: number }) {
  if (daysOpen > 7) {
    return <span className="text-xs font-medium text-rose-600">{daysOpen} days 🔴</span>;
  }
  if (daysOpen > 3) {
    return <span className="text-xs font-medium text-amber-600">{daysOpen} days ⚠️</span>;
  }
  if (daysOpen === 0) {
    return <span className="text-xs text-ink-500">Today</span>;
  }
  return <span className="text-xs text-ink-500">{daysOpen} {daysOpen === 1 ? 'day' : 'days'} ago</span>;
}

/* -------------------------------------------------------------------------- */
/*  Stat Bar                                                                  */
/* -------------------------------------------------------------------------- */

export function RequestStatBar({
  stats, role, onFilter,
}: {
  stats: any;
  role: 'EMPLOYEE' | 'ASSET_MANAGER' | 'ADMIN';
  onFilter?: (status: string) => void;
}) {
  if (role === 'EMPLOYEE') {
    return (
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pending" value={stats.pending} accent="amber" icon={<Clock className="h-4 w-4" />} onClick={() => onFilter?.('PENDING')} />
        <StatCard label="Approved" value={stats.approved} accent="brand" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onFilter?.('APPROVED')} />
        <StatCard label="Total requests" value={stats.total} icon={<Inbox className="h-4 w-4" />} onClick={() => onFilter?.('')} />
      </div>
    );
  }

  // Manager / Admin view
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Open queue" value={stats.pending} accent="brand" icon={<Inbox className="h-4 w-4" />} onClick={() => onFilter?.('PENDING')} />
      <StatCard label="Urgent" value={stats.urgent} accent="red" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => onFilter?.('PENDING')} />
      <StatCard label="Escalated" value={stats.escalated} accent="amber" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => onFilter?.('PENDING')} />
      <StatCard label="Closed (week)" value={stats.closedThisWeek} icon={<Archive className="h-4 w-4" />} onClick={() => onFilter?.('')} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Demand Chart                                                              */
/* -------------------------------------------------------------------------- */

export function DemandChart({ data }: { data: { categoryName: string; count: number }[] }) {
  if (!data || data.length === 0) {
    return <div className="py-6 text-center text-sm text-ink-500">No requests this month.</div>;
  }
  
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.categoryName} className="flex items-center gap-3 text-sm">
          <div className="w-28 shrink-0 truncate text-ink-600">{d.categoryName}</div>
          <div className="flex-1 h-2 rounded-full bg-ink-100">
            <div className="h-2 rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <div className="w-6 text-right font-mono text-xs text-ink-700">{d.count}</div>
        </div>
      ))}
    </div>
  );
}

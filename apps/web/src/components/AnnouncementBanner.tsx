'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: string;
  version: number;
  startsAt: string | null;
  endsAt: string | null;
};

// Severity → banner colour, mirroring the TrialBanner tone pattern in dashboard/layout.tsx.
const TONES: Record<string, string> = {
  info: 'bg-brand-50 text-brand-800 border-brand-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  critical: 'bg-rose-50 text-rose-800 border-rose-200',
};
// Most-severe first, then (from the API order) newest.
const RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

// Per-browser dismissal key. Includes the version so a materially-edited notice
// (version bumped server-side) re-appears for a user who dismissed the old one.
const dismissKey = (a: Announcement) => `am.ann.dismissed.${a.id}.${a.version}`;

/**
 * Dismissible broadcast-announcement banner shown to any logged-in company user.
 * Self-fetching; mounted once at the top of the dashboard shell. Dismissal is
 * client-side only (localStorage) — no server write.
 */
export function AnnouncementBanner() {
  const { data } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<Announcement[]>('/announcements'),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  // Only read localStorage after mount to avoid an SSR/CSR hydration mismatch.
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => { setHydrated(true); }, []);

  if (!hydrated || !data || data.length === 0) return null;

  const visible = data
    .filter((a) => {
      if (dismissed.has(a.id)) return false;
      try { return !localStorage.getItem(dismissKey(a)); } catch { return true; }
    })
    .sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3))
    .slice(0, 3); // cap visible so a burst never pushes content far down

  if (visible.length === 0) return null;

  const dismiss = (a: Announcement) => {
    try { localStorage.setItem(dismissKey(a), '1'); } catch {}
    setDismissed((prev) => new Set(prev).add(a.id));
  };

  return (
    <div className="relative z-10">
      {visible.map((a) => (
        <div
          key={a.id}
          className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b px-4 py-2 text-xs sm:px-6 ${TONES[a.severity] ?? TONES.info}`}
        >
          {/* Body is plain text (no dangerouslySetInnerHTML) to avoid stored XSS. */}
          <p className="min-w-0">
            <b className="font-semibold">{a.title}</b>
            {a.body && <span className="ml-2 opacity-90">{a.body}</span>}
          </p>
          <button
            type="button"
            aria-label="Dismiss announcement"
            onClick={() => dismiss(a)}
            className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

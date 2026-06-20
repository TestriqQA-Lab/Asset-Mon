'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { api } from '@/lib/api';

export function NotificationsBell() {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const count = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => api<{ unread: number }>('/notifications/count'),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ['notif-list'],
    queryFn: () => api<any[]>('/notifications?limit=20'),
    enabled: open,
  });
  const markRead = useMutation<any, Error, string>({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notif-list'] }); qc.invalidateQueries({ queryKey: ['notif-count'] }); },
  });
  const markAll = useMutation<any, Error, void>({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notif-list'] }); qc.invalidateQueries({ queryKey: ['notif-count'] }); },
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = count.data?.unread || 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-ink-600 hover:border-ink-200 hover:bg-white"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 origin-top-right animate-slide-up overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
            <span className="text-sm font-semibold text-ink-900">Notifications</span>
            {unread > 0 && (
              <button className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => markAll.mutate()}>
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {!list.data ? (
              <div className="px-3 py-6 text-center text-sm text-ink-500">Loading…</div>
            ) : list.data.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-ink-500">All caught up.</div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {list.data.map((n: any) => (
                  <li key={n.id} className={`px-3 py-2.5 text-sm ${n.readAt ? '' : 'bg-brand-50/30'}`}>
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />}
                      <div className="flex-1">
                        {n.href ? <a href={n.href} className="font-medium text-ink-900 hover:underline">{n.title}</a> : <p className="font-medium text-ink-900">{n.title}</p>}
                        {n.body && <p className="mt-0.5 text-ink-600">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-ink-400">{new Date(n.createdAt).toLocaleString()} · {n.kind}</p>
                      </div>
                      {!n.readAt && (
                        <button onClick={() => markRead.mutate(n.id)} aria-label="Mark read" className="rounded p-1 text-ink-400 hover:bg-ink-100">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

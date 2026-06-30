'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi, getPlatformSession } from '@/lib/platform-api';
import { Card, Pill, Button, QueryState, EmptyState, Field, selectClass, textareaClass } from '@/components/ui';
import { LifeBuoy, ArrowLeft, Send } from 'lucide-react';

const STATUS: Record<string, { label: string; tone: 'amber' | 'brand' | 'green' }> = {
  OPEN: { label: 'Open', tone: 'amber' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  RESOLVED: { label: 'Resolved', tone: 'green' },
};

export default function SupportInboxPage() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <Thread id={selected} onBack={() => setSelected(null)} />;
  return <Queue onOpen={setSelected} />;
}

function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('');
  const list = useQuery({
    queryKey: ['platform-support', 'list', status],
    queryFn: () => papi<any[]>(`/platform/support${status ? `?status=${status}` : ''}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Support</h1>
          <p className="text-sm text-ink-500">Help requests from companies you host.</p>
        </div>
        <select className={selectClass + ' max-w-[200px]'} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>
      <QueryState query={list}>
        {(rows: any[]) => rows.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title="No requests" description="Nothing in the support queue right now." />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)} className="block w-full text-left">
                <Card className="transition hover:border-ink-300">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {r.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="Unread" />}
                        <span className="truncate font-medium text-ink-900">{r.subject}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        <span className="font-medium text-ink-600">{r.tenant?.name}</span> · {r.preview}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={STATUS[r.status]?.tone || 'gray'}>{STATUS[r.status]?.label || r.status}</Pill>
                      <span className="text-[11px] text-ink-400">{new Date(r.lastMessageAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const canEdit = getPlatformSession()?.user.role === 'SUPER_ADMIN';
  const thread = useQuery({ queryKey: ['platform-support', 'thread', id], queryFn: () => papi<any>(`/platform/support/${id}`) });
  const [reply, setReply] = useState('');
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['platform-support'] });
  };
  const send = useMutation({
    mutationFn: () => papi(`/platform/support/${id}/reply`, { method: 'POST', body: JSON.stringify({ body: reply }) }),
    onSuccess: () => { setReply(''); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const changeStatus = useMutation({
    mutationFn: (s: string) => papi(`/platform/support/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700"><ArrowLeft className="h-3.5 w-3.5" /> Back to queue</button>
      <QueryState query={thread}>
        {(t: any) => (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-ink-900">{t.subject}</h1>
                <p className="truncate text-xs text-ink-500">{t.tenant?.name} ({t.tenant?.slug}) · {t.createdByEmail}</p>
              </div>
              {canEdit ? (
                <select className={selectClass + ' max-w-[170px]'} value={t.status} onChange={(e) => changeStatus.mutate(e.target.value)} disabled={changeStatus.isPending}>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              ) : <Pill tone={STATUS[t.status]?.tone || 'gray'}>{STATUS[t.status]?.label || t.status}</Pill>}
            </div>
            <Card>
              <div className="space-y-3">
                {t.messages.map((m: any) => (
                  <div key={m.id} className={'flex ' + (m.authorType === 'PLATFORM' ? 'justify-end' : 'justify-start')}>
                    <div className={'max-w-[80%] rounded-2xl px-3 py-2 text-sm ' + (m.authorType === 'PLATFORM' ? 'bg-violet-700 text-white' : 'bg-ink-100 text-ink-800')}>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={'mt-1 text-[10px] ' + (m.authorType === 'PLATFORM' ? 'text-white/70' : 'text-ink-400')}>
                        {m.authorType === 'PLATFORM' ? 'You (operator)' : m.authorEmail} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            {canEdit ? (
              <Card>
                <Field label="Reply to the company">
                  <textarea className={textareaClass} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply…" maxLength={5000} />
                </Field>
                <div className="mt-2 flex justify-end">
                  <Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!reply.trim()} onClick={() => send.mutate()}>Send reply</Button>
                </div>
              </Card>
            ) : (
              <div className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">Read-only — replying and changing status require a super-admin operator.</div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

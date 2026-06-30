'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, Pill, Button, QueryState, EmptyState, Field, inputClass, textareaClass } from '@/components/ui';
import { LifeBuoy, ArrowLeft, Send, Plus } from 'lucide-react';

const STATUS: Record<string, { label: string; tone: 'amber' | 'brand' | 'green' }> = {
  OPEN: { label: 'Open', tone: 'amber' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  RESOLVED: { label: 'Resolved', tone: 'green' },
};

export default function GetHelpPage() {
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'new' } | { mode: 'thread'; id: string }>({ mode: 'list' });
  if (view.mode === 'new') return <Composer onDone={() => setView({ mode: 'list' })} onCancel={() => setView({ mode: 'list' })} />;
  if (view.mode === 'thread') return <Thread id={view.id} onBack={() => setView({ mode: 'list' })} />;
  return <RequestList onNew={() => setView({ mode: 'new' })} onOpen={(id) => setView({ mode: 'thread', id })} />;
}

function RequestList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const list = useQuery({ queryKey: ['support'], queryFn: () => api<any[]>('/support') });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Get help</h1>
          <p className="text-sm text-ink-500">Ask the AssetMon team for help. Replies show up right here.</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={onNew}>New request</Button>
      </div>
      <QueryState query={list}>
        {(rows: any[]) => rows.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title="No requests yet" description="Stuck on something? Open a request and we'll help." action={<Button onClick={onNew}>New request</Button>} />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)} className="block w-full text-left">
                <Card className="transition hover:border-ink-300">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {r.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="New reply" />}
                        <span className="truncate font-medium text-ink-900">{r.subject}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-500">{r.preview}</p>
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

function Composer({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => api('/support', { method: 'POST', body: JSON.stringify({ subject, body }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['support'] }); toast.success('Request sent — we\'ll reply here.'); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={onCancel} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
      <Card>
        <h1 className="mb-3 text-lg font-semibold text-ink-900">New help request</h1>
        <div className="space-y-3">
          <Field label="Subject">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. How do I enable Purchase Requests?" maxLength={150} />
          </Field>
          <Field label="Message">
            <textarea className={textareaClass} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe what you need help with…" maxLength={5000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button icon={<Send className="h-4 w-4" />} loading={create.isPending} disabled={!subject.trim() || !body.trim()} onClick={() => create.mutate()}>Send request</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const thread = useQuery({ queryKey: ['support', id], queryFn: () => api<any>(`/support/${id}`) });
  const [reply, setReply] = useState('');
  const send = useMutation({
    mutationFn: () => api(`/support/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) }),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['support', id] });
      qc.invalidateQueries({ queryKey: ['support'] });
      qc.invalidateQueries({ queryKey: ['support-unread'] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700"><ArrowLeft className="h-3.5 w-3.5" /> Back to requests</button>
      <QueryState query={thread}>
        {(t: any) => (
          <>
            <div className="flex items-center justify-between gap-3">
              <h1 className="truncate text-lg font-semibold text-ink-900">{t.subject}</h1>
              <Pill tone={STATUS[t.status]?.tone || 'gray'}>{STATUS[t.status]?.label || t.status}</Pill>
            </div>
            <Card>
              <div className="space-y-3">
                {t.messages.map((m: any) => (
                  <div key={m.id} className={'flex ' + (m.authorType === 'TENANT' ? 'justify-end' : 'justify-start')}>
                    <div className={'max-w-[80%] rounded-2xl px-3 py-2 text-sm ' + (m.authorType === 'TENANT' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-800')}>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={'mt-1 text-[10px] ' + (m.authorType === 'TENANT' ? 'text-white/70' : 'text-ink-400')}>
                        {m.authorType === 'PLATFORM' ? 'AssetMon support' : m.authorEmail} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <Field label="Reply">
                <textarea className={textareaClass} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a message…" maxLength={5000} />
              </Field>
              <div className="mt-2 flex justify-end">
                <Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!reply.trim()} onClick={() => send.mutate()}>Send</Button>
              </div>
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}

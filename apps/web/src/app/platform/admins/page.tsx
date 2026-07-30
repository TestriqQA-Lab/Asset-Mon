'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi, getPlatformSession } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button, inputClass, selectClass, Field, MobileCard, MobileCardRow } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { Plus, KeyRound, Trash2, Shield, ShieldAlert, CheckCircle, XCircle } from 'lucide-react';

export default function PlatformAdminsPage() {
  const qc = useQueryClient();
  const me = getPlatformSession()?.user;
  const list = useQuery({
    queryKey: ['platform-admins'],
    queryFn: () => papi<any[]>('/platform/admins'),
  });

  const pendingResets = useQuery({
    queryKey: ['platform-mfa-pending-resets'],
    queryFn: () => papi<any[]>('/platform/admins/reset-mfa/pending'),
  });

  const approveReset = useMutation({
    mutationFn: ({ requestId, totpCode }: { requestId: string; totpCode: string }) =>
      papi(`/platform/admins/reset-mfa/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ totpCode }) }),
    onSuccess: () => {
      toast.success('MFA reset approved and executed');
      qc.invalidateQueries({ queryKey: ['platform-mfa-pending-resets'] });
      qc.invalidateQueries({ queryKey: ['platform-admins'] });
      setApproveTarget(null);
      setApproveCode('');
    },
    onError: (e: any) => toast.error(e?.message || 'Approval failed'),
  });

  const [approveTarget, setApproveTarget] = useState<any | null>(null);
  const [approveCode, setApproveCode] = useState('');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', password: '', role: 'SUPPORT' });
  const create = useMutation({
    mutationFn: () => papi('/platform/admins', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      toast.success('Platform admin created');
      setOpen(false);
      setForm({ email: '', firstName: '', lastName: '', password: '', role: 'SUPPORT' });
      qc.invalidateQueries({ queryKey: ['platform-admins'] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) =>
      papi(`/platform/admins/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['platform-admins'] }); },
  });

  const del = useMutation({
    mutationFn: (id: string) => papi(`/platform/admins/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['platform-admins'] }); },
  });

  const [resetTarget, setResetTarget] = useState<any | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const reset = useMutation({
    mutationFn: () => papi(`/platform/admins/${resetTarget.id}/reset-password`, {
      method: 'POST', body: JSON.stringify({ password: resetPwd }),
    }),
    onSuccess: () => {
      toast.success('Password reset');
      setResetTarget(null);
      setResetPwd('');
      qc.invalidateQueries({ queryKey: ['platform-admins'] });
    },
  });

  const pendingCount = pendingResets.data?.length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Platform team</h1>
          <p className="text-sm text-ink-500">People who can access this operator console.</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)} className="self-start">
          Add platform admin
        </Button>
      </div>

      {/* Pending MFA reset requests */}
      {pendingCount > 0 && (
        <Card padded={false}>
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">
              Pending MFA resets ({pendingCount})
            </h3>
          </div>
          <div className="divide-y divide-ink-100">
            {pendingResets.data?.map((r: any) => (
              <div key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <div className="text-ink-900">
                    <span className="font-medium">{r.requester?.firstName} {r.requester?.lastName}</span>
                    <span className="text-ink-500"> requested reset for </span>
                    <span className="font-medium">{r.target?.firstName} {r.target?.lastName}</span>
                    <span className="text-ink-400"> ({r.target?.email})</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-ink-500">
                    <span>Ref: <span className="font-mono">{r.incidentRef}</span></span>
                    <span>Expires: {new Date(r.expiresAt).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<CheckCircle className="h-3.5 w-3.5" />}
                    onClick={() => setApproveTarget(r)}
                    disabled={me?.id === r.requesterId}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <QueryState query={list}>
        {(rows: any[]) => (
          <>
            <Card padded={false} className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Email</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5">2FA</th>
                      <th className="px-4 py-2.5">Active</th>
                      <th className="px-4 py-2.5">Created</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u: any) => {
                      const isMe = me?.id === u.id;
                      return (
                        <tr key={u.id} className="border-t border-ink-100">
                          <td className="px-4 py-2.5 font-medium text-ink-900">
                            {u.firstName} {u.lastName}{isMe && <span className="ml-1 text-[10px] text-ink-400">(you)</span>}
                          </td>
                          <td className="px-4 py-2.5 text-ink-700">{u.email}</td>
                          <td className="px-4 py-2.5">
                            <select
                              className={selectClass + ' h-7 py-0 text-xs sm:h-7'}
                              value={u.role}
                              disabled={isMe}
                              onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value } })}
                            >
                              <option value="SUPPORT">SUPPORT</option>
                              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                            </select>
                          </td>
                          <td className="px-4 py-2.5 text-xs">{u.totpEnabled ? <Pill tone="green">on</Pill> : <Pill tone="gray">off</Pill>}</td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => update.mutate({ id: u.id, patch: { active: !u.active } })}
                              disabled={isMe}
                              className={'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + (u.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}
                            >
                              {u.active ? 'Active' : 'Disabled'}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-ink-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex gap-1.5">
                              <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetTarget(u)}>
                                Reset
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                                disabled={isMe}
                                onClick={() => { if (confirm(`Remove ${u.email}?`)) del.mutate(u.id); }}
                              >
                                Remove
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {rows.map((u: any) => {
                const isMe = me?.id === u.id;
                return (
                  <li key={u.id}>
                    <MobileCard>
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink-900">
                            {u.firstName} {u.lastName}{isMe && <span className="ml-1 text-[10px] text-ink-400">(you)</span>}
                          </div>
                          <div className="truncate text-xs text-ink-500">{u.email}</div>
                        </div>
                        <Pill tone={u.role === 'SUPER_ADMIN' ? 'brand' : 'gray'}>{u.role}</Pill>
                      </div>
                      <MobileCardRow label="2FA" value={u.totpEnabled ? 'On' : 'Off'} />
                      <MobileCardRow
                        label="Status"
                        value={
                          <button
                            onClick={() => update.mutate({ id: u.id, patch: { active: !u.active } })}
                            disabled={isMe}
                            className={'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + (u.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}
                          >
                            {u.active ? 'Active' : 'Disabled'}
                          </button>
                        }
                      />
                      <MobileCardRow label="Created" value={new Date(u.createdAt).toLocaleDateString()} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetTarget(u)}>
                          Reset
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          disabled={isMe}
                          onClick={() => { if (confirm(`Remove ${u.email}?`)) del.mutate(u.id); }}
                        >
                          Remove
                        </Button>
                      </div>
                    </MobileCard>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </QueryState>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add platform admin"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending} icon={<Shield className="h-4 w-4" />}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name"><input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label="Last name"><input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Temporary password" hint="At least 8 characters. They'll be asked to change it later.">
            <input className={inputClass} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className={selectClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="SUPPORT">SUPPORT — can read everything and impersonate</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN — can also delete tenants and manage team</option>
            </select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!resetTarget}
        onClose={() => { setResetTarget(null); setResetPwd(''); }}
        title={resetTarget ? `Reset password for ${resetTarget.email}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setResetTarget(null); setResetPwd(''); }}>Cancel</Button>
            <Button onClick={() => reset.mutate()} loading={reset.isPending} disabled={resetPwd.length < 8}>Set new password</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-500">All of this admin's active sessions will be invalidated.</p>
          <Field label="New password" hint="At least 8 characters">
            <input className={inputClass} type="text" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} autoFocus />
          </Field>
        </div>
      </Modal>
      <Modal
        open={!!approveTarget}
        onClose={() => { setApproveTarget(null); setApproveCode(''); }}
        title="Approve MFA reset"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setApproveTarget(null); setApproveCode(''); }}>Cancel</Button>
            <Button
              onClick={() => approveTarget && approveReset.mutate({ requestId: approveTarget.id, totpCode: approveCode })}
              loading={approveReset.isPending}
              disabled={approveCode.length !== 6}
            >
              Approve and reset
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-700">
            You are approving an MFA reset for <strong>{approveTarget?.target?.email}</strong> requested by <strong>{approveTarget?.requester?.email}</strong> (Ref: <span className="font-mono">{approveTarget?.incidentRef}</span>).
          </p>
          <p className="text-sm text-ink-700">
            This action requires a step-up authentication. Please enter your current authenticator code to proceed.
          </p>
          <Field label="Your authenticator code" hint="6 digits from your authenticator app">
            <input
              className={inputClass}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={approveCode}
              onChange={(e) => setApproveCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

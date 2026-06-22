'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getSession } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';
import { MobileCard, MobileCardRow } from '@/components/ui';
import { Link2, RefreshCw, Copy, Power, Check, ShieldCheck } from 'lucide-react';

const ROLES = ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'];

export default function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ email: '', firstName: '', lastName: '', role: 'EMPLOYEE', password: '', departmentId: '', scopedDepartmentId: '', active: true });

  // ── Admin "reset a user's sign-in verification" (MFA) ──────────────────────
  const session = getSession();
  const myId = session?.user.id;
  const isAdmin = session?.user.role === 'ADMIN';
  // Does the acting admin use verification themselves? If so, the backend wants a
  // password step-up before clearing someone else's. (Cached under the same key
  // the security page uses.)
  const meMfa = useQuery({ queryKey: ['me-mfa'], queryFn: () => api<{ enabled: boolean }>('/me/mfa'), enabled: isAdmin });
  const adminHasMfa = !!meMfa.data?.enabled;
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [resetPassword, setResetPassword] = useState('');
  const closeReset = () => { setResetTarget(null); setResetPassword(''); };
  const resetMfa = useMutation({
    mutationFn: (vars: { id: string; password?: string }) =>
      api(`/users/${vars.id}/reset-mfa`, { method: 'POST', body: JSON.stringify(vars.password ? { password: vars.password } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeReset(); toast.success('Sign-in verification reset — they can set it up again next sign-in.'); },
  });
  const canReset = (u: any) => isAdmin && u.id !== myId && u.mfaMethod && u.mfaMethod !== 'NONE';

  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...form, departmentId: form.departmentId || null, scopedDepartmentId: form.scopedDepartmentId || null };
      if (editing) { delete body.email; if (!body.password) delete body.password; }
      return editing
        ? api(`/users/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/users', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setOpen(false); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const editUser = (u: any) => {
    setEditing(u);
    setForm({
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      password: '',
      departmentId: u.departmentId || '',
      scopedDepartmentId: u.role === 'EMPLOYEE' ? (u.scopedDepartmentId || '') : '',
      active: u.active,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Users</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setEditing(null); setForm({ email: '', firstName: '', lastName: '', role: 'EMPLOYEE', password: '', departmentId: '', scopedDepartmentId: '', active: true }); setOpen(true); }}>New user</button>
      </div>

      <InviteLinkCard />

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Department</th><th className="px-4 py-2">Active</th><th></th></tr>
        </thead>
        <tbody>
          {users.data?.map((u: any) => (
            <tr key={u.id} className="border-t">
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-1.5">
                  {u.firstName} {u.lastName}
                  {u.mfaMethod && u.mfaMethod !== 'NONE' && <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Sign-in verification on" />}
                </span>
              </td>
              <td className="px-4 py-2 text-gray-500">{u.email}</td>
              <td className="px-4 py-2"><span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{u.role}</span></td>
              <td className="px-4 py-2 text-gray-500">{u.department?.name || '—'}</td>
              <td className="px-4 py-2">{u.active ? '✓' : '—'}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                {canReset(u) && <button className={btnSecondary + ' mr-2'} onClick={() => { setResetTarget(u); setResetPassword(''); }}>Reset verification</button>}
                <button className={btnSecondary + ' mr-2'} onClick={() => editUser(u)}>Edit</button>
                <button className={btnDanger} onClick={() => confirm('Delete user?') && del.mutate(u.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {users.data?.map((u: any) => (
          <li key={u.id}>
            <MobileCard>
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate font-medium text-ink-900">
                    {u.firstName} {u.lastName}
                    {u.mfaMethod && u.mfaMethod !== 'NONE' && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Sign-in verification on" />}
                  </div>
                  <div className="truncate text-xs text-ink-500">{u.email}</div>
                </div>
                <span className="shrink-0 rounded bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-700">{u.role}</span>
              </div>
              <MobileCardRow label="Department" value={u.department?.name || '—'} />
              <MobileCardRow label="Active" value={u.active ? '✓' : '—'} />
              <div className="mt-2 flex flex-wrap gap-2">
                {canReset(u) && <button className={btnSecondary} onClick={() => { setResetTarget(u); setResetPassword(''); }}>Reset verification</button>}
                <button className={btnSecondary} onClick={() => editUser(u)}>Edit</button>
                <button className={btnDanger} onClick={() => confirm('Delete user?') && del.mutate(u.id)}>Delete</button>
              </div>
            </MobileCard>
          </li>
        ))}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit user' : 'New user'}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing && <Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name"><input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label="Last name"><input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Role">
            <select className={inputClass} value={form.role} onChange={(e) => {
              const next = e.target.value;
              // Clear scopedDepartmentId whenever the role leaves EMPLOYEE so we
              // don't leave a stale RBAC scope on a promoted admin/asset manager.
              setForm({ ...form, role: next, scopedDepartmentId: next === 'EMPLOYEE' ? form.scopedDepartmentId : '' });
            }}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select className={inputClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">— None —</option>
              {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          {form.role === 'EMPLOYEE' && (
            <Field label="Restrict to department (access scope)" hint="When set, this user can only see assets in this department. Leave blank for unrestricted (admins and asset managers are always unrestricted).">
              <select className={inputClass} value={form.scopedDepartmentId} onChange={(e) => setForm({ ...form, scopedDepartmentId: e.target.value })}>
                <option value="">— No restriction —</option>
                {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={editing ? 'New password (leave blank to keep)' : 'Password'}>
            <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          )}
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      </Modal>

      <Modal
        open={!!resetTarget}
        onClose={closeReset}
        title="Reset sign-in verification"
        footer={
          <>
            <button className={btnSecondary} onClick={closeReset}>Cancel</button>
            <button
              className={btnDanger}
              disabled={resetMfa.isPending || (adminHasMfa && !resetPassword)}
              onClick={() => resetMfa.mutate({ id: resetTarget.id, password: adminHasMfa ? resetPassword : undefined })}
            >
              Reset
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-700">
            This clears sign-in verification (email code and authenticator app) for{' '}
            <b>{resetTarget?.firstName} {resetTarget?.lastName}</b>. They&apos;ll be asked to set it up again the next time they sign in.
          </p>
          {adminHasMfa && (
            <Field label="Confirm your password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && resetPassword) resetMfa.mutate({ id: resetTarget.id, password: resetPassword }); }}
              />
            </Field>
          )}
          {resetMfa.error && (
            <p className="text-red-600">
              {/password/i.test((resetMfa.error as Error).message) ? 'Incorrect password.' : (resetMfa.error as Error).message}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function InviteLinkCard() {
  const qc = useQueryClient();
  const invite = useQuery({
    queryKey: ['workspace-invite'],
    queryFn: () => api<{ token: string | null; enabled: boolean }>('/workspace-invite'),
  });
  const rotate = useMutation({
    mutationFn: () => api('/workspace-invite/rotate', { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspace-invite'] }); toast.success('Invite link regenerated'); },
  });
  const disable = useMutation({
    mutationFn: () => api('/workspace-invite/disable', { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspace-invite'] }); toast.success('Invite link disabled'); },
  });
  const enable = useMutation({
    mutationFn: () => api('/workspace-invite/rotate', { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspace-invite'] }); toast.success('Invite link enabled'); },
  });
  const [copied, setCopied] = useState(false);
  const token = invite.data?.token;
  const url = token && typeof window !== 'undefined' ? `${window.location.origin}/invite/${token}` : '';

  const copy = async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      toast.success('Invite link copied');
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error('Could not copy automatically — the link is selected, press Ctrl+C / ⌘C to copy.');
    }
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-gradient-to-br from-white to-ink-50/40 p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Link2 className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-ink-900">Invite link</h2>
        <span className="ml-auto text-[11px] text-ink-500">Anyone with this link can join as <b>Employee</b></span>
      </div>
      {token ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className={inputClass + ' flex-1 min-w-[260px] font-mono text-xs'}
          />
          <button className={btnSecondary} onClick={copy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className={btnSecondary} onClick={() => rotate.mutate()} disabled={rotate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Rotate
          </button>
          <button className={btnDanger} onClick={() => { if (confirm('Disable this invite link? Existing recipients will no longer be able to join.')) disable.mutate(); }} disabled={disable.isPending}>
            <Power className="mr-1.5 h-3.5 w-3.5" /> Disable
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-sm text-ink-500">Invite link is disabled. Generate one to share with your team.</p>
          <button className={btnPrimary} onClick={() => enable.mutate()} disabled={enable.isPending}>
            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Generate invite link
          </button>
        </div>
      )}
    </div>
  );
}

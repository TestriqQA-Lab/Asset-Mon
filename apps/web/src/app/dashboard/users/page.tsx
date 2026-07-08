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

  // ── Offboard: deactivate + release OR reassign everything a user holds (Slice 6a/6b) ──
  const [offboardTarget, setOffboardTarget] = useState<any>(null);
  const [offboardPassword, setOffboardPassword] = useState('');
  const [offboardDeactivate, setOffboardDeactivate] = useState(true);
  const [offboardTargetUserId, setOffboardTargetUserId] = useState('');
  const closeOffboard = () => { setOffboardTarget(null); setOffboardPassword(''); setOffboardDeactivate(true); setOffboardTargetUserId(''); };
  const openOffboard = (u: any) => { setOffboardTarget(u); setOffboardPassword(''); setOffboardDeactivate(true); setOffboardTargetUserId(''); };

  // ── Phase 4: change role (Employee ⇄ Asset-Manager) — ADMIN only ──
  const [roleTarget, setRoleTarget] = useState<any>(null);
  const [roleTo, setRoleTo] = useState<'EMPLOYEE' | 'ASSET_MANAGER'>('EMPLOYEE');
  const [reassignToId, setReassignToId] = useState('');
  const closeRole = () => { setRoleTarget(null); setReassignToId(''); };
  const openRole = (u: any) => { setRoleTarget(u); setRoleTo(u.role === 'ASSET_MANAGER' ? 'EMPLOYEE' : 'ASSET_MANAGER'); setReassignToId(''); };
  const offboardPreview = useQuery({
    queryKey: ['offboard-preview', offboardTarget?.id],
    queryFn: () => api<any>(`/users/${offboardTarget.id}/offboarding-preview`),
    enabled: !!offboardTarget,
  });
  const isLastAdmin = !!offboardPreview.data?.isLastAdmin;
  const reassigning = !!offboardTargetUserId;
  const offboard = useMutation({
    mutationFn: () => api<any>(`/users/${offboardTarget.id}/offboard`, {
      method: 'POST',
      body: JSON.stringify({ deactivate: isLastAdmin ? false : offboardDeactivate, password: adminHasMfa ? offboardPassword : undefined, targetUserId: offboardTargetUserId || undefined }),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      const verb = res.mode === 'reassign' ? 'Reassigned' : 'Released';
      const parts: string[] = [];
      if (res.assets) parts.push(`${res.assets} asset${res.assets === 1 ? '' : 's'}`);
      if (res.tickets) parts.push(`${res.tickets} ticket${res.tickets === 1 ? '' : 's'}`);
      if (res.seats) parts.push(`${res.seats} seat${res.seats === 1 ? '' : 's'}`);
      if (res.requests) parts.push(`${res.requests} request${res.requests === 1 ? '' : 's'}`);
      let msg = parts.length ? `${verb} ${parts.join(', ')}.` : 'Nothing was held.';
      if (res.seatsSkipped) msg += ` ${res.seatsSkipped} seat${res.seatsSkipped === 1 ? '' : 's'} already held (freed).`;
      if (res.reservations) msg += ` ${res.reservations} booking${res.reservations === 1 ? '' : 's'} cancelled.`;
      if (res.apiKeys) msg += ` ${res.apiKeys} API key${res.apiKeys === 1 ? '' : 's'} revoked.`;
      if (res.deactivated) msg += ' Account deactivated.';
      toast.success(msg);
      closeOffboard();
    },
  });
  const canOffboard = (u: any) => isAdmin && u.active && u.id !== myId;

  const rolePreview = useQuery({
    queryKey: ['role-change-preview', roleTarget?.id, roleTo],
    queryFn: () => api<any>(`/users/${roleTarget.id}/role-change-preview?to=${roleTo}`),
    enabled: !!roleTarget,
  });
  const changeRole = useMutation({
    mutationFn: () => api<any>(`/users/${roleTarget.id}/change-role`, {
      method: 'POST',
      body: JSON.stringify({ role: roleTo, reassignToId: reassignToId || undefined }),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      const moved: string[] = [];
      if (res.movedRequests) moved.push(`${res.movedRequests} request${res.movedRequests === 1 ? '' : 's'}`);
      if (res.movedTickets) moved.push(`${res.movedTickets} ticket${res.movedTickets === 1 ? '' : 's'}`);
      const dir = res.to === 'ASSET_MANAGER' ? 'is now an Asset-Manager' : 'is now an Employee';
      let msg = `${roleTarget.firstName} ${roleTarget.lastName} ${dir}.`;
      if (moved.length) msg += ` ${moved.join(' and ')} reassigned.`;
      toast.success(msg);
      closeRole();
    },
  });
  const canChangeRole = (u: any) => isAdmin && u.role !== 'ADMIN' && u.id !== myId;

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
        {isAdmin && <button className={btnPrimary + ' sm:self-start'} onClick={() => { setEditing(null); setForm({ email: '', firstName: '', lastName: '', role: 'EMPLOYEE', password: '', departmentId: '', scopedDepartmentId: '', active: true }); setOpen(true); }}>New user</button>}
      </div>

      {isAdmin && <InviteLinkCard />}

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
                {isAdmin && <button className={btnSecondary + ' mr-2'} onClick={() => editUser(u)}>Edit</button>}
                {canChangeRole(u) && <button className={btnSecondary + ' mr-2'} onClick={() => openRole(u)}>Change role</button>}
                {canOffboard(u) && <button className={btnSecondary + ' mr-2'} onClick={() => openOffboard(u)}>Offboard</button>}
                {isAdmin && <button className={btnDanger} onClick={() => confirm('Delete user?') && del.mutate(u.id)}>Delete</button>}
                {!isAdmin && <span className="text-xs text-gray-400">Read-only</span>}
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
                {isAdmin && <button className={btnSecondary} onClick={() => editUser(u)}>Edit</button>}
                {canChangeRole(u) && <button className={btnSecondary} onClick={() => openRole(u)}>Change role</button>}
                {canOffboard(u) && <button className={btnSecondary} onClick={() => openOffboard(u)}>Offboard</button>}
                {isAdmin && <button className={btnDanger} onClick={() => confirm('Delete user?') && del.mutate(u.id)}>Delete</button>}
                {!isAdmin && <span className="text-xs text-gray-400">Read-only</span>}
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

      <Modal
        open={!!offboardTarget}
        onClose={closeOffboard}
        size="lg"
        title="Offboard user"
        footer={
          <>
            <button className={btnSecondary} onClick={closeOffboard}>Cancel</button>
            <button
              className={btnDanger}
              disabled={offboard.isPending || offboardPreview.isLoading || (adminHasMfa && !offboardPassword)}
              onClick={() => offboard.mutate()}
            >
              {isLastAdmin ? (reassigning ? 'Reassign holdings' : 'Release holdings') : (reassigning ? 'Reassign & deactivate' : 'Deactivate & release')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-700">
            This {reassigning ? 'reassigns' : 'releases'} everything <b>{offboardTarget?.firstName} {offboardTarget?.lastName}</b> is holding{' '}
            {reassigning ? 'to the chosen teammate' : 'back to the pool'}
            {isLastAdmin ? '.' : ' and deactivates their account.'}
          </p>

          {offboardPreview.data?.eligibleTargets && (
            <Field label="Reassign everything to (optional)" hint="Leave as “release to the pool” to return everything, or pick a teammate to take it all over.">
              <select className={inputClass} value={offboardTargetUserId} onChange={(e) => setOffboardTargetUserId(e.target.value)}>
                <option value="">— Release to the pool —</option>
                {offboardPreview.data.eligibleTargets.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.email}</option>
                ))}
              </select>
            </Field>
          )}

          {offboardPreview.isLoading && <p className="text-ink-500">Loading what they hold…</p>}
          {offboardPreview.data && (
            <>
              <div className="flex flex-wrap gap-2">
                <OffboardCount label={reassigning ? 'assets → reassigned' : 'assets → to stock'} n={offboardPreview.data.counts.assets} />
                <OffboardCount label={reassigning ? 'tickets → reassigned' : 'tickets → unassigned'} n={offboardPreview.data.counts.tickets} />
                <OffboardCount label="bookings → cancelled" n={offboardPreview.data.counts.reservations} />
                <OffboardCount label={reassigning ? 'seats → reassigned' : 'seats → freed'} n={offboardPreview.data.counts.seats} />
                <OffboardCount label={reassigning ? 'requests → reassigned' : 'requests → handed off'} n={offboardPreview.data.counts.requests} />
                <OffboardCount label={!isLastAdmin && offboardDeactivate ? 'API keys → revoked' : 'API keys → kept'} n={offboardPreview.data.counts.apiKeys} />
              </div>
              {offboardPreview.data.assets.length > 0 && <OffboardList title="Assets" items={offboardPreview.data.assets.map((a: any) => `${a.asset.assetTag} · ${a.asset.name}`)} />}
              {offboardPreview.data.tickets.length > 0 && <OffboardList title="Tickets" items={offboardPreview.data.tickets.map((t: any) => `${t.ticketNumber} · ${t.title}`)} />}
              {offboardPreview.data.reservations.length > 0 && <OffboardList title="Bookings" items={offboardPreview.data.reservations.map((r: any) => `${r.asset.assetTag} · ${r.asset.name}`)} />}
              {offboardPreview.data.seats.length > 0 && <OffboardList title="Software seats" items={offboardPreview.data.seats.map((s: any) => s.license.software.name)} />}
              {offboardPreview.data.openRequests?.length > 0 && <OffboardList title="Asset-requests" items={offboardPreview.data.openRequests.map((r: any) => `${r.number} · ${r.title}`)} />}
              {offboardPreview.data.apiKeys?.length > 0 && <OffboardList title="API keys" items={offboardPreview.data.apiKeys.map((k: any) => `${k.name} (${k.prefix}…)`)} />}
            </>
          )}

          {isLastAdmin ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
              This is the last active admin, so the account stays active — but their holdings will still be {reassigning ? 'reassigned' : 'released'}.
            </p>
          ) : (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={offboardDeactivate} onChange={(e) => setOffboardDeactivate(e.target.checked)} />
              Deactivate the account (signs them out everywhere)
            </label>
          )}

          {adminHasMfa && (
            <Field label="Confirm your password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={offboardPassword}
                onChange={(e) => setOffboardPassword(e.target.value)}
              />
            </Field>
          )}
          {offboard.error && (
            <p className="text-red-600">
              {/password/i.test((offboard.error as Error).message) ? 'Incorrect password.' : (offboard.error as Error).message}
            </p>
          )}
        </div>
      </Modal>

      {/* Change role — Employee <-> Asset-Manager (Phase 4, admin only) */}
      <Modal
        open={!!roleTarget}
        onClose={closeRole}
        title="Change role"
        footer={
          <>
            <button className={btnSecondary} onClick={closeRole}>Cancel</button>
            <button
              className={btnPrimary}
              disabled={changeRole.isPending || rolePreview.isLoading || roleTo === roleTarget?.role}
              onClick={() => changeRole.mutate()}
            >
              {changeRole.isPending ? 'Saving…' : `Switch to ${roleTo === 'ASSET_MANAGER' ? 'Asset-Manager' : 'Employee'}`}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-700">
            <b>{roleTarget?.firstName} {roleTarget?.lastName}</b> is currently{' '}
            <b>{roleTarget?.role === 'ASSET_MANAGER' ? 'an Asset-Manager' : 'an Employee'}</b>. Switch them to:
          </p>
          <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${roleTo === 'EMPLOYEE' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:bg-ink-200'}`}
              onClick={() => setRoleTo('EMPLOYEE')}
            >
              Employee
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${roleTo === 'ASSET_MANAGER' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:bg-ink-200'}`}
              onClick={() => setRoleTo('ASSET_MANAGER')}
            >
              Asset-Manager
            </button>
          </div>
          <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            They&apos;ll be signed out and asked to sign in again. An Asset-Manager gets the Asset-Requests hub and can approve requests; an Employee does not.
          </p>

          {rolePreview.isLoading && <p className="text-ink-500">Checking what they&apos;re handling…</p>}
          {rolePreview.data?.isDemotion && !rolePreview.isLoading && (
            <>
              <div className="flex flex-wrap gap-2">
                <OffboardCount label="open requests" n={rolePreview.data.counts.requests} />
                <OffboardCount label="open tickets" n={rolePreview.data.counts.tickets} />
              </div>
              {(rolePreview.data.counts.requests + rolePreview.data.counts.tickets) > 0 && (
                <Field label="Hand their open work to" hint="Auto goes to the Asset-Manager with the fewest open items — or, if there's no other manager, back to the unassigned queue. Or pick someone specific.">
                  <select className={inputClass} value={reassignToId} onChange={(e) => setReassignToId(e.target.value)}>
                    <option value="">— Auto: the manager with the fewest open items —</option>
                    {(rolePreview.data.eligibleManagers || []).map((m: any) => (
                      <option key={m.id} value={m.id}>{m.firstName} {m.lastName} · {m.role === 'ADMIN' ? 'Admin' : 'Asset-Manager'}</option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {roleTo === roleTarget?.role && <p className="text-xs text-ink-400">They already have this role.</p>}
          {changeRole.error && <p className="text-red-600">{(changeRole.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

function OffboardCount({ label, n }: { label: string; n: number }) {
  return (
    <span className={'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + (n > 0 ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-ink-50 text-ink-400 ring-ink-200')}>
      {n} {label}
    </span>
  );
}

function OffboardList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-600">{title}</p>
      <ul className="mt-0.5 space-y-0.5 text-xs text-ink-500">
        {items.slice(0, 8).map((it, i) => <li key={i} className="truncate">• {it}</li>)}
        {items.length > 8 && <li className="text-ink-400">…and {items.length - 8} more</li>}
      </ul>
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

'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button, MobileCard, MobileCardRow } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { KeyRound, ShieldOff, LockOpen, UserCog, Copy, Check } from 'lucide-react';
import { useCopy } from '../_shared';

/**
 * Users section — full tenant user table with per-user actions.
 */
export default function TenantUsersPage() {
  const params = useParams();
  const id = params?.id as string;
  const qc = useQueryClient();
  const { copied, copy } = useCopy();

  const tenantUsers = useQuery({
    queryKey: ['platform-tenant-users', id],
    queryFn: () => papi<any[]>(`/platform/tenants/${id}/users`),
    enabled: !!id,
  });

  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const resetUser = useMutation({
    mutationFn: (userId: string) => papi<any>(`/platform/tenants/${id}/users/${userId}/reset-password`, { method: 'POST' }),
    onSuccess: (d) => {
      setTempPwd(d.tempPassword);
      toast.success('Password reset — share the temporary password with the user securely.');
    },
  });

  const impersonate = useMutation({
    mutationFn: (userId: string) => papi<any>(`/platform/tenants/${id}/users/${userId}/impersonate`, { method: 'POST' }),
    onSuccess: (d) => {
      const tenantSession = {
        accessToken: d.accessToken,
        refreshToken: '',
        tenant: d.tenant,
        user: d.user,
      };
      localStorage.setItem('am.session', JSON.stringify(tenantSession));
      toast.success(`Impersonating ${d.user.email} — opening dashboard…`);
      window.open('/dashboard', '_blank', 'noopener,noreferrer');
    },
  });

  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [mfaConfirmUser, setMfaConfirmUser] = useState<any | null>(null);
  const resetMfa = useMutation({
    mutationFn: (userId: string) => papi<any>(`/platform/tenants/${id}/users/${userId}/reset-mfa`, { method: 'POST' }),
    onSuccess: (d) => {
      setMfaConfirmUser(null);
      toast.success(`MFA reset for ${d.email} — they can set it up again next sign-in.`);
      qc.invalidateQueries({ queryKey: ['platform-tenant-users', id] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const unlock = useMutation({
    mutationFn: (userId: string) => papi<any>(`/platform/tenants/${id}/users/${userId}/unlock`, { method: 'POST' }),
    onSuccess: (d) => {
      toast.success(`Account unlocked for ${d.email}.`);
      qc.invalidateQueries({ queryKey: ['platform-tenant-users', id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">All tenant users</h3>
        </div>
        <QueryState query={tenantUsers}>
          {(rows: any[]) => (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="px-4 py-2.5">User</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5">2FA</th>
                      <th className="px-4 py-2.5">Active</th>
                      <th className="px-4 py-2.5">Locked?</th>
                      <th className="px-4 py-2.5">Created</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u: any) => (
                      <tr key={u.id} className="border-t border-ink-100">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink-900">{u.firstName} {u.lastName}</div>
                          <div className="text-xs text-ink-500">{u.email}</div>
                        </td>
                        <td className="px-4 py-2.5"><Pill tone={u.role === 'ADMIN' ? 'brand' : 'gray'}>{u.role}</Pill></td>
                        <td className="px-4 py-2.5 text-xs">{u.totpEnabled ? '✓' : '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{u.active ? '✓' : '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{u.lockedUntil ? new Date(u.lockedUntil).toLocaleString() : '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-ink-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />}
                              onClick={() => { setResetUserId(u.id); setTempPwd(null); resetUser.mutate(u.id); }}
                              loading={resetUser.isPending && resetUserId === u.id}>
                              Reset password
                            </Button>
                            <Button variant="secondary" size="sm" icon={<ShieldOff className="h-3.5 w-3.5" />}
                              onClick={() => setMfaConfirmUser(u)}
                              disabled={!u.totpEnabled && (u.mfaMethod ?? 'NONE') === 'NONE'}>
                              Reset MFA
                            </Button>
                            <Button variant="secondary" size="sm" icon={<LockOpen className="h-3.5 w-3.5" />}
                              onClick={() => { setActionUserId(u.id); unlock.mutate(u.id); }}
                              loading={unlock.isPending && actionUserId === u.id}
                              disabled={!u.lockedUntil}>
                              Unlock
                            </Button>
                            <Button variant="secondary" size="sm" icon={<UserCog className="h-3.5 w-3.5" />}
                              onClick={() => impersonate.mutate(u.id)}
                              loading={impersonate.isPending}>
                              Impersonate
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="space-y-2 p-3 md:hidden">
                {rows.map((u: any) => (
                  <li key={u.id}>
                    <MobileCard>
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink-900">{u.firstName} {u.lastName}</div>
                          <div className="truncate text-xs text-ink-500">{u.email}</div>
                        </div>
                        <Pill tone={u.role === 'ADMIN' ? 'brand' : 'gray'}>{u.role}</Pill>
                      </div>
                      <MobileCardRow label="2FA" value={u.totpEnabled ? '✓' : '—'} />
                      <MobileCardRow label="Active" value={u.active ? '✓' : '—'} />
                      <MobileCardRow label="Locked" value={u.lockedUntil ? new Date(u.lockedUntil).toLocaleString() : '—'} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />}
                          onClick={() => { setResetUserId(u.id); setTempPwd(null); resetUser.mutate(u.id); }}
                          loading={resetUser.isPending && resetUserId === u.id}>
                          Reset password
                        </Button>
                        <Button variant="secondary" size="sm" icon={<ShieldOff className="h-3.5 w-3.5" />}
                          onClick={() => setMfaConfirmUser(u)}
                          disabled={!u.totpEnabled && (u.mfaMethod ?? 'NONE') === 'NONE'}>
                          Reset MFA
                        </Button>
                        <Button variant="secondary" size="sm" icon={<LockOpen className="h-3.5 w-3.5" />}
                          onClick={() => { setActionUserId(u.id); unlock.mutate(u.id); }}
                          loading={unlock.isPending && actionUserId === u.id}
                          disabled={!u.lockedUntil}>
                          Unlock
                        </Button>
                        <Button variant="secondary" size="sm" icon={<UserCog className="h-3.5 w-3.5" />}
                          onClick={() => impersonate.mutate(u.id)}
                          loading={impersonate.isPending}>
                          Impersonate
                        </Button>
                      </div>
                    </MobileCard>
                  </li>
                ))}
              </ul>
            </>
          )}
        </QueryState>
      </Card>

      {/* Temp password reveal */}
      <Modal
        open={!!tempPwd}
        onClose={() => { setTempPwd(null); setResetUserId(null); }}
        title="Temporary password generated"
        footer={<Button variant="secondary" onClick={() => { setTempPwd(null); setResetUserId(null); }}>Done</Button>}
      >
        <div className="space-y-3 text-sm">
          <p>Share this with the user over a secure channel. They can sign in and change it from <em>Account → Security</em>.</p>
          <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-sm">
            <span className="flex-1 break-all">{tempPwd}</span>
            <button onClick={() => tempPwd && copy(tempPwd)} className="rounded p-1 hover:bg-white">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-ink-500" />}
            </button>
          </div>
          <p className="text-xs text-ink-500">All of this user's existing sessions have been invalidated.</p>
        </div>
      </Modal>

      {/* Reset-MFA confirmation */}
      <Modal
        open={!!mfaConfirmUser}
        onClose={() => setMfaConfirmUser(null)}
        title="Reset this user's MFA?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMfaConfirmUser(null)}>Cancel</Button>
            <Button variant="danger" loading={resetMfa.isPending} onClick={() => mfaConfirmUser && resetMfa.mutate(mfaConfirmUser.id)}>Reset MFA</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink-700">
          <p>This wipes <strong>{mfaConfirmUser?.email}</strong>'s two-factor sign-in — authenticator, email codes and backup codes. They'll sign in with just their password and can set MFA up again.</p>
          <p className="text-xs text-ink-500">Their active sessions end immediately. This is recorded in the audit log.</p>
        </div>
      </Modal>
    </>
  );
}

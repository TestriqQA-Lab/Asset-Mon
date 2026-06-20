'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, KeyRound, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { Card, SectionHeader, Button, Field, inputClass, Pill } from '@/components/ui';

export default function SecuritySettingsPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['2fa-status'], queryFn: () => api<{ enabled: boolean }>('/me/2fa') });
  const [enroll, setEnroll] = useState<{ secret: string; otpauth: string } | null>(null);
  const [token, setToken] = useState('');

  const startEnroll = useMutation<any, Error, void>({
    mutationFn: () => api('/me/2fa/enroll', { method: 'POST' }),
    onSuccess: (r: any) => setEnroll(r),
    onError: (e) => toast.error(e.message),
  });
  const verify = useMutation<any, Error, void>({
    mutationFn: () => api('/me/2fa/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: () => { toast.success('Two-factor authentication enabled'); setEnroll(null); setToken(''); qc.invalidateQueries({ queryKey: ['2fa-status'] }); },
    onError: (e) => toast.error(e.message),
  });
  const disable = useMutation<any, Error, void>({
    mutationFn: () => api('/me/2fa/disable', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: () => { toast.success('Two-factor authentication disabled'); setToken(''); qc.invalidateQueries({ queryKey: ['2fa-status'] }); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <SectionHeader title="Security" subtitle="Manage your sign-in security: two-factor authentication, recovery, and audit." />

      <Card>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink-900">Two-factor authentication (TOTP)</h3>
              {status.data?.enabled
                ? <Pill tone="green" dot>Enabled</Pill>
                : <Pill tone="amber" dot>Disabled</Pill>}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Scan the QR with Google Authenticator, 1Password, Authy, etc. — then enter the 6-digit code to confirm.
            </p>

            {!status.data?.enabled && !enroll && (
              <Button className="mt-4" icon={<KeyRound className="h-4 w-4" />} loading={startEnroll.isPending} onClick={() => startEnroll.mutate()}>
                Enable two-factor
              </Button>
            )}

            {enroll && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-ink-500">1. Scan this in your authenticator app</p>
                  <img
                    alt="2FA QR code"
                    className="mt-2 h-44 w-44 rounded-md border border-ink-200 bg-white"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(enroll.otpauth)}`}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <code className="block flex-1 break-all rounded-md border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-[10px] text-ink-700">{enroll.secret}</code>
                    <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { const ok = await copyToClipboard(enroll.secret); ok ? toast.success('Secret copied') : toast.error('Could not copy — select the text and press Ctrl+C / ⌘C'); }}>Copy</Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-500">2. Enter the 6-digit code</p>
                  <Field label="">
                    <input className={inputClass + ' font-mono tracking-widest'} maxLength={6} value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" onClick={() => setEnroll(null)}>Cancel</Button>
                    <Button loading={verify.isPending} disabled={token.length !== 6} onClick={() => verify.mutate()}>Verify & enable</Button>
                  </div>
                </div>
              </div>
            )}

            {status.data?.enabled && (
              <div className="mt-4 flex items-end gap-3">
                <Field label="Enter a current 6-digit code to disable">
                  <input className={inputClass + ' w-40 font-mono tracking-widest'} maxLength={6} value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Button variant="danger" loading={disable.isPending} disabled={token.length !== 6} onClick={() => disable.mutate()}>Disable 2FA</Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

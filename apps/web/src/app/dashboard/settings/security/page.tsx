'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, KeyRound, Copy, Mail, Download, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { Card, SectionHeader, Button, Field, inputClass, Pill } from '@/components/ui';

type MfaStatus = {
  mfaMethod: 'NONE' | 'EMAIL' | 'EMAIL_TOTP';
  enabled: boolean;
  recoveryEmail: string | null;
  recoveryVerified: boolean;
  totpEnabled: boolean;
  backupCodesRemaining: number;
};

// Build and download the one-time recovery codes as a plain .txt file.
function downloadRecoveryCodes(codes: string[]) {
  if (typeof window === 'undefined') return;
  const body =
    'AssetMon — recovery codes\n' +
    '\n' +
    'Keep these somewhere safe. Each code works only once, and only if you\n' +
    "can't receive your email code when signing in.\n" +
    '\n' +
    codes.map((c) => `  ${c}`).join('\n') +
    '\n';
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'assetmon-recovery-codes.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const METHOD_LABEL: Record<MfaStatus['mfaMethod'], string> = {
  NONE: 'Off',
  EMAIL: "You'll be asked for a code sent to your email when you sign in.",
  EMAIL_TOTP: "You'll be asked for an email code and an authenticator-app code when you sign in.",
};

export default function SecuritySettingsPage() {
  const qc = useQueryClient();

  // ── New: email sign-in verification (the per-user MFA card) ────────────────
  const mfa = useQuery({ queryKey: ['me-mfa'], queryFn: () => api<MfaStatus>('/me/mfa') });

  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [warnMsg, setWarnMsg] = useState<string | null>(null); // same-provider nudge
  const [sentTo, setSentTo] = useState<string | null>(null); // masked email a code was sent to
  const [devHint, setDevHint] = useState<string | null>(null); // dev/staging convenience only
  const [recoveryCode, setRecoveryCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null); // shown once, right after enabling
  const [saved, setSaved] = useState(false);

  function resetEnrollState() {
    setRecoveryEmail('');
    setWarnMsg(null);
    setSentTo(null);
    setDevHint(null);
    setRecoveryCode('');
  }

  const sendRecovery = useMutation<any, Error, { ack: boolean }>({
    mutationFn: ({ ack }) =>
      api('/me/mfa/recovery/send', {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail.trim().toLowerCase(), acknowledgeRisk: ack }),
      }),
    onSuccess: (r: any) => {
      if (r?.needsAck) {
        // Use our OWN plain-language copy. The server's `message` here is
        // developer-facing (it names an internal parameter), so we never surface it.
        setWarnMsg('That looks like the same email provider as your main address. A different provider is more secure for recovery — but you can use this one anyway.');
        return;
      }
      setWarnMsg(null);
      setSentTo(r?.maskedEmail || null);
      setDevHint(r?.devCode || null);
      toast.success('We sent a code to your recovery email.');
    },
    onError: (e) => toast.error(e.message),
  });

  const verifyRecovery = useMutation<any, Error, void>({
    mutationFn: () => api('/me/mfa/recovery/verify', { method: 'POST', body: JSON.stringify({ code: recoveryCode.trim() }) }),
    onSuccess: () => {
      toast.success('Recovery email confirmed.');
      setSentTo(null);
      setDevHint(null);
      setRecoveryCode('');
      qc.invalidateQueries({ queryKey: ['me-mfa'] });
    },
    onError: (e: any) => {
      const code = e?.payload?.code;
      if (code === 'INVALID_CODE') {
        const left = e?.payload?.attemptsRemaining;
        toast.error(typeof left === 'number' ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code.');
      } else if (code === 'CODE_EXPIRED' || code === 'CODE_BURNED') {
        toast.error('That code expired — send a new one.');
        setSentTo(null); setDevHint(null); setRecoveryCode('');
      } else {
        toast.error(e.message || 'Could not verify the code.');
      }
    },
  });

  const enableEmail = useMutation<any, Error, void>({
    mutationFn: () => api('/me/mfa/enable', { method: 'POST', body: JSON.stringify({ method: 'EMAIL' }) }),
    onSuccess: (r: any) => {
      setCodes(Array.isArray(r?.codes) ? r.codes : []);
      setSaved(false);
      resetEnrollState();
    },
    onError: (e) => toast.error(e.message),
  });

  function finishCodes() {
    setCodes(null);
    setSaved(false);
    qc.invalidateQueries({ queryKey: ['me-mfa'] });
    toast.success('Email verification is on.');
  }

  // ── Existing: legacy authenticator-app 2FA (unchanged) ─────────────────────
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

  const m = mfa.data;
  const enabled = !!m?.enabled;
  const recoveryVerified = !!m?.recoveryVerified;

  return (
    <div className="space-y-5">
      <SectionHeader title="Security" subtitle="Manage your sign-in security: verification at sign-in, recovery, and audit." />

      {/* ── Email sign-in verification ─────────────────────────────────────── */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink-900">Email verification at sign-in</h3>
              {mfa.isLoading
                ? <Pill tone="neutral">…</Pill>
                : enabled
                  ? <Pill tone="green" dot>On</Pill>
                  : <Pill tone="amber" dot>Off</Pill>}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Adds a one-time code sent to your email each time you sign in — so a stolen password isn&apos;t enough on its own.
            </p>

            {/* 1) Just-generated recovery codes — show once */}
            {codes && (
              <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50/60 p-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-ink-700" />
                  <h4 className="text-sm font-semibold text-ink-900">Save your recovery codes</h4>
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  Each code can be used once if you ever can&apos;t get your email code. Store them somewhere safe —
                  they won&apos;t be shown again.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-2">
                  {codes.map((c) => (
                    <code key={c} className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-center font-mono text-sm tracking-widest text-ink-800">{c}</code>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={async () => { const ok = await copyToClipboard(codes.join('\n')); ok ? toast.success('Recovery codes copied') : toast.error('Could not copy — select the codes and press Ctrl+C / ⌘C'); }}>
                    Copy all
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadRecoveryCodes(codes)}>
                    Download
                  </Button>
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                  I&apos;ve saved my recovery codes somewhere safe
                </label>
                <div className="mt-3">
                  <Button disabled={!saved} onClick={finishCodes}>Done</Button>
                </div>
              </div>
            )}

            {/* 2) Already on — summary */}
            {!codes && enabled && (
              <div className="mt-4 space-y-1.5 text-sm">
                <p className="text-ink-700">{METHOD_LABEL[m!.mfaMethod]}</p>
                {m?.recoveryEmail && <p className="text-ink-500">Recovery email: <span className="font-medium text-ink-700">{m.recoveryEmail}</span></p>}
                <p className="text-ink-500">Recovery codes left: <span className="font-medium text-ink-700">{m?.backupCodesRemaining ?? 0}</span></p>
              </div>
            )}

            {/* 3) Not on — enrollment flow */}
            {!codes && !mfa.isLoading && !enabled && (
              <div className="mt-4 space-y-4">
                {/* Step A: recovery email (only until it's verified) */}
                {!recoveryVerified && !sentTo && (
                  <div>
                    <Field label="Recovery email" hint="Used to get back in if you're ever locked out. A different email provider than your main one is recommended.">
                      <input
                        type="email"
                        className={inputClass}
                        placeholder="you@example.com"
                        value={recoveryEmail}
                        onChange={(e) => { setRecoveryEmail(e.target.value); setWarnMsg(null); }}
                      />
                    </Field>
                    {warnMsg && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p>{warnMsg}</p>
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" loading={sendRecovery.isPending} onClick={() => sendRecovery.mutate({ ack: true })}>Send anyway</Button>
                            <Button size="sm" variant="secondary" onClick={() => setWarnMsg(null)}>Use a different email</Button>
                          </div>
                        </div>
                      </div>
                    )}
                    {!warnMsg && (
                      <Button className="mt-3" loading={sendRecovery.isPending}
                        disabled={!/.+@.+\..+/.test(recoveryEmail)}
                        onClick={() => sendRecovery.mutate({ ack: false })}>
                        Send verification code
                      </Button>
                    )}
                  </div>
                )}

                {/* Step B: confirm the recovery email with the code */}
                {!recoveryVerified && sentTo && (
                  <div>
                    <p className="text-sm text-ink-600">Enter the code we sent to <span className="font-medium text-ink-800">{sentTo}</span>.</p>
                    {devHint && <p className="mt-1 text-xs text-ink-400">Dev only — code: <span className="font-mono">{devHint}</span></p>}
                    <Field label="">
                      <input className={inputClass + ' w-40 font-mono tracking-widest'} maxLength={6} inputMode="numeric" autoFocus
                        value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, ''))} />
                    </Field>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button loading={verifyRecovery.isPending} disabled={recoveryCode.length !== 6} onClick={() => verifyRecovery.mutate()}>Verify</Button>
                      <Button variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={sendRecovery.isPending} onClick={() => sendRecovery.mutate({ ack: true })}>Resend</Button>
                      <Button variant="ghost" onClick={resetEnrollState}>Use a different email</Button>
                    </div>
                  </div>
                )}

                {/* Step C: recovery confirmed — turn it on */}
                {recoveryVerified && (
                  <div>
                    <p className="text-sm text-ink-600">
                      Recovery email confirmed{m?.recoveryEmail ? <>: <span className="font-medium text-ink-800">{m.recoveryEmail}</span></> : ''}.
                    </p>
                    <Button className="mt-3" icon={<ShieldCheck className="h-4 w-4" />} loading={enableEmail.isPending} onClick={() => enableEmail.mutate()}>
                      Turn on email verification
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Authenticator app (existing, unchanged) ────────────────────────── */}
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

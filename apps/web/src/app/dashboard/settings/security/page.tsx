'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, KeyRound, Copy, Mail, Download, AlertTriangle, RefreshCw } from 'lucide-react';
import { api, setSession } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { friendlyError } from '@/lib/mfa';
import { Card, SectionHeader, Button, Field, inputClass, Pill } from '@/components/ui';
import { QRCodeSVG } from 'qrcode.react';

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

// friendlyError now lives in @/lib/mfa-errors so the platform setup wizard uses
// the same copy; it also covers the code-rejection cases this page can hit.

export default function SecuritySettingsPage() {
  const qc = useQueryClient();

  // ── New: email sign-in verification (the per-user MFA card) ────────────────
  const mfa = useQuery({ queryKey: ['me-mfa'], queryFn: () => api<MfaStatus>('/me/mfa') });

  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [warnMsg, setWarnMsg] = useState<string | null>(null); // same-provider nudge
  const [sentTo, setSentTo] = useState<string | null>(null); // masked email a code was sent to
  const [devHint, setDevHint] = useState<string | null>(null); // dev/staging convenience only
  const [resendIn, setResendIn] = useState(0); // seconds until another code can be sent
  const [recoveryCode, setRecoveryCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null); // shown once, right after enabling
  const [saved, setSaved] = useState(false);
  const [showDisable, setShowDisable] = useState(false); // reveals the turn-off password step-up
  const [disablePassword, setDisablePassword] = useState('');
  const [switchMode, setSwitchMode] = useState<null | 'up' | 'down'>(null); // level switch in progress
  const [switchPassword, setSwitchPassword] = useState('');
  const [totpEnroll, setTotpEnroll] = useState<{ secret: string; otpauth: string } | null>(null); // inline authenticator enroll
  const [enrollCode, setEnrollCode] = useState('');

  function resetEnrollState() {
    setRecoveryEmail('');
    setWarnMsg(null);
    setSentTo(null);
    setDevHint(null);
    setRecoveryCode('');
  }

  // Tick the resend cooldown down to zero (drives the "Resend in Ns" label).
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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
      setResendIn(typeof r?.resendIn === 'number' ? r.resendIn : 60);
      toast.success('We sent a code to your recovery email.');
    },
    onError: (e: any) => {
      // Start (or sync) the visible cooldown so the button reflects the wait.
      if (e?.payload?.code === 'EMAIL_RATELIMIT' && typeof e?.payload?.resendIn === 'number') {
        setResendIn(e.payload.resendIn);
      } else if (e?.status === 429) {
        setResendIn((s) => (s > 0 ? s : 60));
      }
      toast.error(friendlyError(e) || e.message || 'Could not send the code.');
    },
  });

  const verifyRecovery = useMutation<any, Error, void>({
    mutationFn: () => api('/me/mfa/recovery/verify', { method: 'POST', body: JSON.stringify({ code: recoveryCode.trim() }) }),
    onSuccess: () => {
      toast.success('Recovery email confirmed.');
      setSentTo(null);
      setDevHint(null);
      setRecoveryCode('');
      setResendIn(0);
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
        toast.error(friendlyError(e) || e.message || 'Could not verify the code.');
      }
    },
  });

  const enableEmail = useMutation<any, Error, void>({
    mutationFn: () => api('/me/mfa/enable', { method: 'POST', body: JSON.stringify({ method: 'EMAIL' }) }),
    onSuccess: (r: any) => {
      // Enabling bumps the session version (ends other sessions). The server hands
      // back a fresh session for THIS device so we don't get signed out — store it.
      if (r?.tokens) setSession(r.tokens);
      setCodes(Array.isArray(r?.codes) ? r.codes : []);
      setSaved(false);
      resetEnrollState();
    },
    onError: (e: any) => toast.error(friendlyError(e) || e.message || 'Could not turn on verification.'),
  });

  const disableEmail = useMutation<any, Error, void>({
    mutationFn: () => api('/me/mfa/disable', { method: 'POST', body: JSON.stringify({ password: disablePassword }) }),
    onSuccess: (r: any) => {
      if (r?.tokens) setSession(r.tokens); // stay signed in after turning it off
      setShowDisable(false);
      setDisablePassword('');
      qc.invalidateQueries({ queryKey: ['me-mfa'] });
      toast.success('Email verification turned off.');
    },
    onError: (e: any) => toast.error(friendlyError(e) || e.message || 'Could not turn off verification.'),
  });

  // ── level switch: email-only (EMAIL) <-> email + authenticator app (EMAIL_TOTP) ──
  function cancelSwitch() {
    setSwitchMode(null);
    setSwitchPassword('');
    setTotpEnroll(null);
    setEnrollCode('');
  }

  // Inline authenticator enrollment, needed before switching UP when the user
  // hasn't set up an app yet. Reuses the existing /me/2fa endpoints.
  const startEnrollForSwitch = useMutation<any, Error, void>({
    mutationFn: () => api('/me/2fa/enroll', { method: 'POST' }),
    onSuccess: (r: any) => setTotpEnroll(r),
    onError: (e: any) => toast.error(friendlyError(e) || e.message),
  });
  const confirmEnrollForSwitch = useMutation<any, Error, void>({
    mutationFn: () => api('/me/2fa/verify', { method: 'POST', body: JSON.stringify({ token: enrollCode }) }),
    onSuccess: (r: any) => {
      if (r?.tokens) setSession(r.tokens); // enrolling bumps the session version — keep this device signed in
      toast.success('Authenticator app added — now confirm your password.');
      setTotpEnroll(null);
      setEnrollCode('');
      qc.invalidateQueries({ queryKey: ['me-mfa'] }); // totpEnabled flips true -> the password step shows
    },
    onError: (e: any) => toast.error(friendlyError(e) || e.message),
  });
  const switchLevel = useMutation<any, Error, 'EMAIL' | 'EMAIL_TOTP'>({
    mutationFn: (method) => api('/me/mfa/enable', { method: 'POST', body: JSON.stringify({ method, password: switchPassword }) }),
    onSuccess: (r: any) => {
      if (r?.tokens) setSession(r.tokens); // stay signed in (changing level bumps the session version)
      cancelSwitch();
      setCodes(Array.isArray(r?.codes) ? r.codes : []); // changing level re-issues recovery codes — show them
      setSaved(false);
    },
    onError: (e: any) => toast.error(friendlyError(e) || (/password/i.test(e?.message || '') ? 'Incorrect password.' : (e.message || 'Could not change the level.'))),
  });

  function finishCodes() {
    setCodes(null);
    setSaved(false);
    qc.invalidateQueries({ queryKey: ['me-mfa'] });
    toast.success('Email verification is on.');
  }

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

            {/* 2) Already on — summary + level switch + turn-off (all with password step-up) */}
            {!codes && enabled && (
              <div className="mt-4 space-y-3 text-sm">
                <div className="space-y-1.5">
                  <p className="text-ink-700">{METHOD_LABEL[m!.mfaMethod]}</p>
                  {m?.recoveryEmail && <p className="text-ink-500">Recovery email: <span className="font-medium text-ink-700">{m.recoveryEmail}</span></p>}
                  <p className="text-ink-500">Recovery codes left: <span className="font-medium text-ink-700">{m?.backupCodesRemaining ?? 0}</span></p>
                </div>

                {/* Action row — shown when no sub-flow is open */}
                {!showDisable && switchMode === null && (
                  <div className="flex flex-wrap gap-2">
                    {m!.mfaMethod === 'EMAIL'
                      ? <Button variant="secondary" onClick={() => { setSwitchMode('up'); setSwitchPassword(''); if (!m!.totpEnabled) startEnrollForSwitch.mutate(); }}>Also require an authenticator app</Button>
                      : <Button variant="secondary" onClick={() => { setSwitchMode('down'); setSwitchPassword(''); }}>Switch to email only</Button>}
                    <Button variant="secondary" onClick={() => setShowDisable(true)}>Turn off email verification</Button>
                  </div>
                )}

                {/* Switch UP: email -> email + authenticator app */}
                {switchMode === 'up' && (
                  <div className="space-y-3 rounded-lg border border-ink-200 bg-ink-50/60 p-3">
                    {!m!.totpEnabled ? (
                      <div>
                        <p className="font-medium text-ink-800">Step 1 — set up your authenticator app</p>
                        {totpEnroll ? (
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <div>
                              <QRCodeSVG value={totpEnroll.otpauth} size={160} className="rounded-md border border-ink-200 bg-white p-2" />
                              <div className="mt-2 flex items-center gap-2">
                                <code className="block flex-1 break-all rounded-md border border-ink-200 bg-white px-2 py-1 font-mono text-[10px] text-ink-700">{totpEnroll.secret}</code>
                                <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { const ok = await copyToClipboard(totpEnroll.secret); ok ? toast.success('Secret copied') : toast.error('Could not copy — select the text and press Ctrl+C / ⌘C'); }}>Copy</Button>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-ink-500">Enter the 6-digit code from the app</p>
                              <input className={inputClass + ' mt-1 max-w-[10rem] font-mono tracking-widest'} maxLength={6} inputMode="numeric" autoFocus value={enrollCode} onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ''))} />
                              <div className="mt-2">
                                <Button loading={confirmEnrollForSwitch.isPending} disabled={enrollCode.length !== 6} onClick={() => confirmEnrollForSwitch.mutate()}>Confirm app</Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 text-ink-500">Preparing your authenticator setup…</p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="text-ink-700">Confirm your password to also require your authenticator app at sign-in.</p>
                        <input
                          type="password" autoComplete="current-password" autoFocus
                          className={inputClass + ' mt-2 max-w-xs'} placeholder="Your password"
                          value={switchPassword} onChange={(e) => setSwitchPassword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && switchPassword) switchLevel.mutate('EMAIL_TOTP'); }}
                        />
                        <div className="mt-3 flex gap-2">
                          <Button loading={switchLevel.isPending} disabled={!switchPassword} onClick={() => switchLevel.mutate('EMAIL_TOTP')}>Turn on authenticator step</Button>
                        </div>
                      </div>
                    )}
                    <Button variant="ghost" onClick={cancelSwitch}>Cancel</Button>
                  </div>
                )}

                {/* Switch DOWN: email + authenticator app -> email only */}
                {switchMode === 'down' && (
                  <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3">
                    <p className="text-ink-700">Confirm your password to switch to email-only verification. Your authenticator app will no longer be required at sign-in.</p>
                    <input
                      type="password" autoComplete="current-password" autoFocus
                      className={inputClass + ' mt-2 max-w-xs'} placeholder="Your password"
                      value={switchPassword} onChange={(e) => setSwitchPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && switchPassword) switchLevel.mutate('EMAIL'); }}
                    />
                    <div className="mt-3 flex gap-2">
                      <Button loading={switchLevel.isPending} disabled={!switchPassword} onClick={() => switchLevel.mutate('EMAIL')}>Switch to email only</Button>
                      <Button variant="secondary" onClick={cancelSwitch}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Turn off entirely */}
                {showDisable && (
                  <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3">
                    <p className="text-ink-700">For your security, confirm your password to turn off email verification.</p>
                    <input
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      className={inputClass + ' mt-2 max-w-xs'}
                      placeholder="Your password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && disablePassword) disableEmail.mutate(); }}
                    />
                    <div className="mt-3 flex gap-2">
                      <Button variant="danger" loading={disableEmail.isPending} disabled={!disablePassword} onClick={() => disableEmail.mutate()}>Turn off</Button>
                      <Button variant="secondary" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>Cancel</Button>
                    </div>
                  </div>
                )}
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
                            <Button size="sm" loading={sendRecovery.isPending} disabled={resendIn > 0} onClick={() => sendRecovery.mutate({ ack: true })}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Send anyway'}</Button>
                            <Button size="sm" variant="secondary" onClick={() => setWarnMsg(null)}>Use a different email</Button>
                          </div>
                        </div>
                      </div>
                    )}
                    {!warnMsg && (
                      <Button className="mt-3" loading={sendRecovery.isPending}
                        disabled={!/.+@.+\..+/.test(recoveryEmail) || resendIn > 0}
                        onClick={() => sendRecovery.mutate({ ack: false })}>
                        {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send verification code'}
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
                      <Button variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={sendRecovery.isPending} disabled={resendIn > 0} onClick={() => sendRecovery.mutate({ ack: true })}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend'}</Button>
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
    </div>
  );
}

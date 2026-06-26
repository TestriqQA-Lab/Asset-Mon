'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { papi, setPlatformSession, type PlatformSession } from '@/lib/platform-api';
import { copyToClipboard } from '@/lib/clipboard';
import { Field, inputClass, Button } from '@/components/ui';
import { Mail, ShieldCheck, KeyRound, Copy, Download, LifeBuoy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

// Strict no-leak policy (same as the platform login): generic, public-safe copy.
const SETUP_TICKET_KEY = 'am.platform.setupTicket';

const STEPS = [
  { n: 1, label: 'Email', icon: Mail },
  { n: 2, label: 'Authenticator', icon: KeyRound },
  { n: 3, label: 'Recovery', icon: LifeBuoy },
  { n: 4, label: 'Backup codes', icon: ShieldCheck },
];

function downloadCodes(codes: string[]) {
  if (typeof window === 'undefined') return;
  const body = 'AssetMon — operator backup codes\n\nKeep these somewhere safe. Each works once.\n\n' + codes.map((c) => `  ${c}`).join('\n') + '\n';
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'assetmon-operator-backup-codes.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PlatformMfaSetupPage() {
  const r = useRouter();
  const [ticket, setTicket] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // step 1 — primary email
  const [emailSent, setEmailSent] = useState(false);
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  const [emailDev, setEmailDev] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // step 2 — authenticator
  const [totp, setTotp] = useState<{ secret: string; otpauth: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  // step 3 — recovery email
  const [recEmail, setRecEmail] = useState('');
  const [recWarn, setRecWarn] = useState<string | null>(null);
  const [recSent, setRecSent] = useState(false);
  const [recMasked, setRecMasked] = useState<string | null>(null);
  const [recDev, setRecDev] = useState<string | null>(null);
  const [recCode, setRecCode] = useState('');
  // step 4 — backup codes
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  // Call a setup endpoint with the setup ticket as Bearer (papi skips its own
  // session token when auth:false, and a 401 throws instead of redirecting).
  const sapi = <T,>(path: string, init: RequestInit = {}): Promise<T> =>
    papi<T>(path, { ...init, auth: false, headers: { ...(init.headers || {}), Authorization: `Bearer ${ticket}` } });

  // Load the ticket on mount.
  useEffect(() => {
    const t = typeof window !== 'undefined' ? sessionStorage.getItem(SETUP_TICKET_KEY) : null;
    if (!t) { r.replace('/platform/login'); return; }
    setTicket(t);
  }, [r]);

  // Resume to the first incomplete step.
  useEffect(() => {
    if (!ticket) return;
    sapi<any>('/platform/mfa/setup/state')
      .then((st) => {
        if (!st.primaryEmailVerifiedAt) setStep(1);
        else if (!st.totpEnabled) setStep(2);
        else if (!st.recoveryEmailVerifiedAt) setStep(3);
        else setStep(4);
        setReady(true);
      })
      .catch(() => { toast.error('Your setup session expired — please sign in again.'); r.replace('/platform/login'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket]);

  // Resend countdown.
  useEffect(() => { if (resendIn <= 0) return; const t = setTimeout(() => setResendIn(resendIn - 1), 1000); return () => clearTimeout(t); }, [resendIn]);

  // Auto-start the authenticator + backup-code steps when reached.
  useEffect(() => { if (ready && step === 2 && ticket && !totp) void startTotp(); /* eslint-disable-next-line */ }, [ready, step, ticket]);
  useEffect(() => { if (ready && step === 4 && ticket && !codes) void genCodes(); /* eslint-disable-next-line */ }, [ready, step, ticket]);

  const expire = () => { toast.error('Your setup session expired — please sign in again.'); r.replace('/platform/login'); };

  async function sendEmail() {
    setLoading(true);
    try {
      const res = await sapi<any>('/platform/mfa/setup/primary-email/send', { method: 'POST' });
      setEmailSent(true); setEmailMasked(res.maskedEmail || null); setEmailDev(res.devCode || null); setEmailCode(''); setResendIn(res.resendIn || 60);
    } catch { toast.error('Could not send the code — please try again.'); }
    finally { setLoading(false); }
  }
  async function verifyEmail() {
    setLoading(true);
    try { await sapi('/platform/mfa/setup/primary-email/verify', { method: 'POST', body: JSON.stringify({ code: emailCode.trim() }) }); setStep(2); }
    catch (e: any) { e?.status === 401 ? expire() : toast.error('Incorrect code.'); }
    finally { setLoading(false); }
  }

  async function startTotp() {
    try { const res = await sapi<any>('/platform/mfa/setup/totp/start', { method: 'POST' }); setTotp({ secret: res.secret, otpauth: res.otpauth }); }
    catch { toast.error('Could not start authenticator setup — please try again.'); }
  }
  async function verifyTotp() {
    setLoading(true);
    try { await sapi('/platform/mfa/setup/totp/verify', { method: 'POST', body: JSON.stringify({ token: totpCode.trim() }) }); setTotpCode(''); setStep(3); }
    catch (e: any) { e?.status === 401 ? expire() : toast.error('Incorrect code.'); }
    finally { setLoading(false); }
  }

  async function sendRecovery(ack: boolean) {
    setLoading(true);
    try {
      const res = await sapi<any>('/platform/mfa/setup/recovery-email/send', { method: 'POST', body: JSON.stringify({ email: recEmail.trim().toLowerCase(), acknowledgeRisk: ack }) });
      if (res?.needsAck) { setRecWarn('A different email provider than your primary is more secure for recovery — but you can use this one anyway.'); return; }
      setRecWarn(null); setRecSent(true); setRecMasked(res.maskedEmail || null); setRecDev(res.devCode || null); setRecCode('');
    } catch { toast.error('Could not send the code — please try again.'); }
    finally { setLoading(false); }
  }
  async function verifyRecovery() {
    setLoading(true);
    try { await sapi('/platform/mfa/setup/recovery-email/verify', { method: 'POST', body: JSON.stringify({ code: recCode.trim() }) }); setStep(4); }
    catch (e: any) { e?.status === 401 ? expire() : toast.error('Incorrect code.'); }
    finally { setLoading(false); }
  }

  async function genCodes() {
    try { const res = await sapi<any>('/platform/mfa/setup/backup-codes/generate', { method: 'POST' }); setCodes(Array.isArray(res.codes) ? res.codes : []); setSaved(false); }
    catch { toast.error('Could not generate backup codes — please try again.'); }
  }
  async function finish() {
    setLoading(true);
    try {
      const s = await sapi<PlatformSession>('/platform/mfa/setup/complete', { method: 'POST' });
      setPlatformSession(s);
      if (typeof window !== 'undefined') sessionStorage.removeItem(SETUP_TICKET_KEY);
      toast.success('Setup complete.');
      r.push('/platform');
    } catch (e: any) { e?.status === 401 ? expire() : toast.error('Could not finish setup — please try again.'); }
    finally { setLoading(false); }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-900 via-indigo-900 to-slate-900 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-grid-light bg-[size:36px_36px] opacity-10" />
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur"><ShieldCheck className="h-5 w-5" /></div>
          <div className="text-lg font-semibold tracking-tight">AssetMon</div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Secure your account</h1>
          <p className="mt-3 text-sm text-white/70">A few quick steps to finish setting up sign-in security on this account.</p>
        </div>
        <div className="relative z-10 text-xs text-white/50">Authorized personnel only</div>
      </div>

      <div className="flex items-center justify-center bg-ink-50 p-6">
        <div className="w-full max-w-md">
          {/* Stepper */}
          <ol className="mb-5 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <li key={s.n} className="flex flex-1 items-center gap-2">
                <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ' + (step > s.n ? 'bg-emerald-600 text-white' : step === s.n ? 'bg-violet-700 text-white' : 'bg-ink-200 text-ink-500')}>
                  {step > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}
                </span>
                {i < STEPS.length - 1 && <span className={'h-0.5 flex-1 ' + (step > s.n ? 'bg-emerald-600' : 'bg-ink-200')} />}
              </li>
            ))}
          </ol>

          <div className="rounded-2xl border border-ink-200 bg-white p-8 shadow-card">
            {!ready && <p className="text-sm text-ink-500">Loading…</p>}

            {/* Step 1 — primary email */}
            {ready && step === 1 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-ink-900">Confirm your email</h2>
                {!emailSent ? (
                  <>
                    <p className="text-sm text-ink-500">We&apos;ll send a one-time code to your sign-in email to confirm it.</p>
                    <Button onClick={sendEmail} loading={loading} className="w-full">Send code</Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink-500">Enter the code we sent to <span className="font-medium text-ink-700">{emailMasked || 'your email'}</span>.</p>
                    {emailDev && <p className="text-xs text-ink-400">Dev only — code: <span className="font-mono">{emailDev}</span></p>}
                    <Field label="Code"><input className={inputClass + ' font-mono tracking-widest'} maxLength={6} inputMode="numeric" autoFocus value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))} /></Field>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={verifyEmail} loading={loading} disabled={emailCode.length !== 6}>Verify</Button>
                      <Button variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={resendIn > 0 || loading} onClick={sendEmail}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend'}</Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2 — authenticator */}
            {ready && step === 2 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-ink-900">Set up your authenticator app</h2>
                {totp ? (
                  <>
                    <p className="text-sm text-ink-500">Scan this with Google Authenticator, 1Password, Authy, etc., then enter the 6-digit code.</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <QRCodeSVG value={totp.otpauth} size={160} className="rounded-md border border-ink-200 bg-white p-2" />
                        <div className="mt-2 flex items-center gap-2">
                          <code className="block flex-1 break-all rounded-md border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-[10px] text-ink-700">{totp.secret}</code>
                          <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { (await copyToClipboard(totp.secret)) ? toast.success('Secret copied') : toast.error('Could not copy'); }}>Copy</Button>
                        </div>
                      </div>
                      <div>
                        <Field label="6-digit code"><input className={inputClass + ' font-mono tracking-widest'} maxLength={6} inputMode="numeric" autoFocus value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))} /></Field>
                        <Button className="mt-2" onClick={verifyTotp} loading={loading} disabled={totpCode.length !== 6}>Verify</Button>
                      </div>
                    </div>
                  </>
                ) : <p className="text-sm text-ink-500">Preparing…</p>}
              </div>
            )}

            {/* Step 3 — recovery email */}
            {ready && step === 3 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-ink-900">Add a recovery email</h2>
                {!recSent ? (
                  <>
                    <Field label="Recovery email" hint="A different provider than your primary is recommended, so a single account compromise can't lock you out.">
                      <input type="email" className={inputClass} placeholder="you@example.com" value={recEmail} onChange={(e) => { setRecEmail(e.target.value); setRecWarn(null); }} />
                    </Field>
                    {recWarn ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p>{recWarn}</p>
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" loading={loading} onClick={() => sendRecovery(true)}>Send anyway</Button>
                            <Button size="sm" variant="secondary" onClick={() => setRecWarn(null)}>Use a different email</Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button onClick={() => sendRecovery(false)} loading={loading} disabled={!/.+@.+\..+/.test(recEmail)}>Send code</Button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink-500">Enter the code we sent to <span className="font-medium text-ink-700">{recMasked || 'your recovery email'}</span>.</p>
                    {recDev && <p className="text-xs text-ink-400">Dev only — code: <span className="font-mono">{recDev}</span></p>}
                    <Field label="Code"><input className={inputClass + ' font-mono tracking-widest'} maxLength={6} inputMode="numeric" autoFocus value={recCode} onChange={(e) => setRecCode(e.target.value.replace(/\D/g, ''))} /></Field>
                    <div className="flex gap-2">
                      <Button onClick={verifyRecovery} loading={loading} disabled={recCode.length !== 6}>Verify</Button>
                      <Button variant="ghost" onClick={() => { setRecSent(false); setRecCode(''); }}>Use a different email</Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 4 — backup codes + finish */}
            {ready && step === 4 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-ink-900">Save your backup codes</h2>
                <p className="text-sm text-ink-500">Each code can be used once if you can&apos;t get your email or authenticator code. Store them somewhere safe — they won&apos;t be shown again.</p>
                {codes ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {codes.map((c) => <code key={c} className="rounded-md border border-ink-200 bg-ink-50 px-2 py-1.5 text-center font-mono text-sm tracking-widest text-ink-800">{c}</code>)}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { (await copyToClipboard(codes.join('\n'))) ? toast.success('Backup codes copied') : toast.error('Could not copy'); }}>Copy all</Button>
                      <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadCodes(codes)}>Download</Button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-ink-700">
                      <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-violet-600 focus:ring-violet-500/30" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                      I&apos;ve saved my backup codes somewhere safe
                    </label>
                    <Button onClick={finish} loading={loading} disabled={!saved} className="w-full">Finish & sign in</Button>
                  </>
                ) : <p className="text-sm text-ink-500">Preparing…</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

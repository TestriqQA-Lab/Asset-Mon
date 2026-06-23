'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { papi, setPlatformSession, type PlatformSession } from '@/lib/platform-api';
import { Field, inputClass, Button } from '@/components/ui';
import { ShieldCheck, Mail, KeyRound } from 'lucide-react';

// Strict policy for this file: every visible string must be safe to show on
// the public internet. No API paths, no role identifiers, no CLI / env-var /
// header names, no DB names, no stack hints, no lockout / throttle details.
// The form never reveals whether the platform has been initialised — there is
// no public provisioning path; admins are added directly in the database by an
// operator with shell access.

// Where the first-time setup wizard (built separately) reads its short-lived
// ticket from. Kept in session storage, never the URL or logs.
const SETUP_TICKET_KEY = 'am.platform.setupTicket';

export default function PlatformLoginPage() {
  const r = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  // Multi-step verification (operators always use it).
  const [step, setStep] = useState<'credentials' | 'email' | 'totp'>('credentials');
  const [ticket, setTicket] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [devHint, setDevHint] = useState<string | null>(null); // dev/staging convenience only
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function restart(message?: string) {
    setStep('credentials');
    setTicket(null);
    setMaskedEmail(null);
    setDevHint(null);
    setCode('');
    setResendIn(0);
    if (message) toast.message(message);
  }

  // Route a 200 response from any step of the flow.
  function routeResponse(s: any): boolean {
    if (s?.accessToken) {
      setPlatformSession(s as PlatformSession);
      r.push('/platform');
      return true;
    }
    if (s?.code === 'MFA_SETUP_REQUIRED' && s?.setupTicket) {
      if (typeof window !== 'undefined') sessionStorage.setItem(SETUP_TICKET_KEY, s.setupTicket);
      r.push('/platform/login/mfa-setup');
      return true;
    }
    if (s?.code === 'EMAIL_OTP_REQUIRED' && s?.ticket) {
      setStep('email');
      setTicket(s.ticket);
      setMaskedEmail(s.maskedEmail || null);
      setDevHint(s.devCode || null);
      setCode('');
      setResendIn(s.resendIn || 60);
      return true;
    }
    if (s?.code === 'TOTP_REQUIRED' && s?.ticket) {
      setStep('totp');
      setTicket(s.ticket);
      setCode('');
      return true;
    }
    return false;
  }

  // Errors from a verification step — kept generic, no internal detail.
  function handleStepError(e: any) {
    const c = e?.payload?.code || e?.payload?.message?.code;
    if (c === 'CODE_EXPIRED' || c === 'MFA_RESTART' || !c) {
      restart('Please sign in again.');
    } else if (e?.status === 423) {
      restart('Too many attempts — please try again later.');
    } else {
      toast.error('Incorrect code.');
    }
  }

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await papi('/platform/auth/login', { method: 'POST', body: JSON.stringify({ email: form.email, password: form.password }), auth: false });
      if (!routeResponse(s)) toast.error('Invalid email or password.');
    } catch {
      // Generic — never reveal lockout, throttling, "no such user", etc.
      toast.error('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (endpoint: 'email' | 'totp') => {
    if (!ticket || !code.trim()) return;
    setLoading(true);
    try {
      const s = await papi(`/platform/auth/mfa/${endpoint}`, { method: 'POST', body: JSON.stringify({ ticket, code: code.trim() }), auth: false });
      if (!routeResponse(s)) restart('Please sign in again.');
    } catch (err: any) {
      handleStepError(err);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    try {
      const s = await papi('/platform/auth/login', { method: 'POST', body: JSON.stringify({ email: form.email, password: form.password }), auth: false });
      if (s?.code === 'EMAIL_OTP_REQUIRED') {
        setTicket(s.ticket);
        setMaskedEmail(s.maskedEmail || null);
        setDevHint(s.devCode || null);
        setCode('');
        setResendIn(s.resendIn || 60);
        toast.success('We sent a new code.');
      } else {
        routeResponse(s);
      }
    } catch {
      restart('Please sign in again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-900 via-indigo-900 to-slate-900 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-grid-light bg-[size:36px_36px] opacity-10" />
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="text-lg font-semibold tracking-tight">AssetMon</div>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Operations console</h1>
          <p className="mt-3 text-sm text-white/70">
            Sign in to manage your organization&apos;s workspaces.
          </p>
        </div>

        <div className="relative z-10 text-xs text-white/50">
          Authorized personnel only
        </div>
      </div>

      <div className="flex items-center justify-center bg-ink-50 p-6">
        <div className="w-full max-w-md">
          {step === 'credentials' && (
            <form onSubmit={submitCredentials} className="space-y-5 rounded-2xl border border-ink-200 bg-white p-8 shadow-card">
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in</h2>
              <Field label="Email">
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus autoComplete="email" />
              </Field>
              <Field label="Password">
                <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="current-password" />
              </Field>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? '…' : 'Sign in'}
              </Button>
            </form>
          )}

          {(step === 'email' || step === 'totp') && (
            <div className="space-y-5 rounded-2xl border border-ink-200 bg-white p-8 shadow-card">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
                {step === 'email' ? <Mail className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
                  {step === 'email' ? 'Enter your email code' : 'Enter your authenticator code'}
                </h2>
                <p className="mt-1 text-sm text-ink-500">
                  {step === 'email'
                    ? <>We sent a one-time code to <span className="font-medium text-ink-700">{maskedEmail || 'your email'}</span>.</>
                    : 'Open your authenticator app and enter the current 6-digit code.'}
                </p>
                {step === 'email' && devHint && (
                  <p className="mt-1 text-xs text-ink-400">Dev only — code: <span className="font-mono">{devHint}</span></p>
                )}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); submitCode(step === 'email' ? 'email' : 'totp'); }} className="space-y-4">
                <Field label="Code" hint="Enter the 6-digit code, or one of your backup codes.">
                  <input className={inputClass + ' font-mono tracking-widest'} type="text" inputMode="text" autoComplete="one-time-code" autoFocus maxLength={64} value={code} onChange={(e) => setCode(e.target.value)} />
                </Field>
                <Button type="submit" disabled={loading || !code.trim()} className="w-full">
                  {loading ? '…' : 'Verify & sign in'}
                </Button>
              </form>

              <div className="flex items-center justify-between text-sm">
                {step === 'email' ? (
                  <button type="button" onClick={resend} disabled={resendIn > 0 || loading} className="font-medium text-violet-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline">
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                  </button>
                ) : <span />}
                <button type="button" onClick={() => restart()} className="text-ink-500 hover:text-ink-700 hover:underline">
                  Start over
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

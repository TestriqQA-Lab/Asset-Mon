'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, setSession } from '@/lib/api';
import { Field, inputClass, Button } from '@/components/ui';
import { ArrowRight, Boxes, ShieldCheck, Sparkles, Mail, KeyRound } from 'lucide-react';

type Tokens = { accessToken: string; refreshToken: string; tenant: { id: string; slug: string }; user: { id: string; email: string; role: string } };

export default function LoginPage() {
  const r = useRouter();
  const [form, setForm] = useState({ email: '', password: '', workspaceSlug: '', totp: '' });
  const [loading, setLoading] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false); // LEGACY single-call authenticator (no ticket)
  const [availableSlugs, setAvailableSlugs] = useState<string[] | null>(null);

  // Multi-step MFA chain (only for users who enabled verification).
  const [step, setStep] = useState<'credentials' | 'email' | 'totp'>('credentials');
  const [ticket, setTicket] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [devHint, setDevHint] = useState<string | null>(null); // dev/staging only
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // Resend cooldown countdown.
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

  function finishLogin(s: Tokens) {
    setSession(s);
    toast.success(`Welcome back, ${s.user.email}`);
    r.push('/dashboard');
  }

  // Route a successful /auth/login or /auth/mfa/* response (HTTP 200 either way).
  function routeResponse(s: any): boolean {
    if (s?.accessToken) { finishLogin(s); return true; }
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

  // Errors from POST /auth/login (workspace picker, legacy authenticator, lockout).
  function handleCredentialError(e: any) {
    const msg = String(e?.message || '');
    const code = e?.payload?.message?.code || e?.payload?.code;
    if (code === 'WORKSPACE_REQUIRED' || /WORKSPACE_REQUIRED/i.test(msg)) {
      const slugs: string[] | undefined = e?.payload?.message?.availableSlugs || e?.payload?.availableSlugs;
      setAvailableSlugs(slugs ?? []);
      toast.message('Pick a workspace to continue.');
    } else if (/TOTP_REQUIRED/i.test(msg)) {
      // Legacy single-call authenticator path (no multi-step ticket).
      setNeedsTotp(true);
      toast.message('Enter your authenticator code to continue.');
    } else if (e?.status === 423) {
      toast.error('Too many attempts — your account is locked for a few minutes.');
    } else {
      toast.error('Invalid email or password.');
    }
  }

  // Errors from POST /auth/mfa/email|totp.
  function handleMfaError(e: any) {
    const code = e?.payload?.code || e?.payload?.message?.code;
    if (code === 'INVALID_CODE') {
      const left = e?.payload?.attemptsRemaining;
      toast.error(typeof left === 'number' ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code.');
    } else if (code === 'CODE_EXPIRED') {
      restart('That code expired — please sign in again.');
    } else if (e?.status === 423) {
      restart('Too many attempts — your account is locked for a few minutes.');
    } else if (code === 'MFA_RESTART' || !code) {
      restart('Please sign in again.');
    } else {
      toast.error('Incorrect code.');
    }
  }

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: any = { email: form.email, password: form.password };
      if (form.workspaceSlug) payload.workspaceSlug = form.workspaceSlug;
      if (needsTotp && form.totp) payload.totp = form.totp.replace(/\s+/g, '');
      const s = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload), auth: false });
      if (!routeResponse(s)) toast.error('Something went wrong — please try again.');
    } catch (err: any) {
      handleCredentialError(err);
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (endpoint: 'email' | 'totp') => {
    if (!ticket || !code.trim()) return;
    setLoading(true);
    try {
      const s = await api(`/auth/mfa/${endpoint}`, { method: 'POST', body: JSON.stringify({ ticket, code: code.trim() }), auth: false });
      if (!routeResponse(s)) toast.error('Something went wrong — please sign in again.');
    } catch (err: any) {
      handleMfaError(err);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    try {
      const payload: any = { email: form.email, password: form.password };
      if (form.workspaceSlug) payload.workspaceSlug = form.workspaceSlug;
      const s = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload), auth: false });
      if (s?.code === 'EMAIL_OTP_REQUIRED') {
        setTicket(s.ticket);
        setMaskedEmail(s.maskedEmail || null);
        setDevHint(s.devCode || null);
        setCode('');
        setResendIn(s.resendIn || 60);
        toast.success('We sent a new code.');
      } else {
        routeResponse(s); // edge: verification turned off in the meantime
      }
    } catch (err: any) {
      handleCredentialError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-mesh opacity-40" />
        <div className="absolute inset-0 bg-grid-light bg-[size:36px_36px] opacity-10" />
        <a href="/" className="relative z-10 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-base font-bold shadow-glow">A</div>
          <span className="text-base font-semibold tracking-tight">AssetMon</span>
        </a>
        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl font-semibold tracking-tight">
            Welcome back.<br />
            <span className="text-ink-400">Pick up where you left off.</span>
          </h2>
          <ul className="space-y-3">
            <Bullet icon={<Boxes className="h-4 w-4" />} text="A dedicated database per workspace — true isolation" />
            <Bullet icon={<ShieldCheck className="h-4 w-4" />} text="Audit-ready: every asset event is logged" />
            <Bullet icon={<Sparkles className="h-4 w-4" />} text="From procurement to depreciation, in one place" />
          </ul>
        </div>
        <div className="relative z-10 text-xs text-ink-400">© AssetMon · {new Date().getFullYear()}</div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-sm">
          {step === 'credentials' && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in</h1>
              <p className="mt-1 text-sm text-ink-500">Enter your credentials to access your workspace.</p>
              <form onSubmit={submitCredentials} className="mt-8 space-y-4">
                <Field label="Email">
                  <input className={inputClass} type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Password">
                  <input className={inputClass} type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
                <Field label="Workspace slug" hint="Only required if your email is in more than one workspace">
                  {availableSlugs && availableSlugs.length > 0 ? (
                    <select className={inputClass} value={form.workspaceSlug} onChange={(e) => setForm({ ...form, workspaceSlug: e.target.value })}>
                      <option value="">— Pick a workspace —</option>
                      {availableSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input className={inputClass} autoComplete="organization" value={form.workspaceSlug} onChange={(e) => setForm({ ...form, workspaceSlug: e.target.value })} />
                  )}
                </Field>
                {needsTotp && (
                  <Field label="Authenticator code" hint="6-digit code from your authenticator app">
                    <input className={inputClass} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} required autoFocus value={form.totp} onChange={(e) => setForm({ ...form, totp: e.target.value })} />
                  </Field>
                )}
                <Button type="submit" loading={loading} size="lg" className="w-full">
                  {needsTotp ? 'Verify & sign in' : 'Sign in'} <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-6 text-center text-sm text-ink-500">
                No workspace yet? <a href="/signup" className="font-medium text-brand-600 hover:underline">Create one</a>
              </p>
            </>
          )}

          {(step === 'email' || step === 'totp') && (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
                {step === 'email' ? <Mail className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900">
                {step === 'email' ? 'Enter your email code' : 'Enter your authenticator code'}
              </h1>
              <p className="mt-1 text-sm text-ink-500">
                {step === 'email'
                  ? <>We sent a one-time code to <span className="font-medium text-ink-700">{maskedEmail || 'your email'}</span>.</>
                  : 'Open your authenticator app and enter the current 6-digit code.'}
              </p>
              {step === 'email' && devHint && (
                <p className="mt-1 text-xs text-ink-400">Dev only — code: <span className="font-mono">{devHint}</span></p>
              )}

              <form onSubmit={(e) => { e.preventDefault(); submitCode(step === 'email' ? 'email' : 'totp'); }} className="mt-6 space-y-4">
                <Field label="Code" hint="Enter the 6-digit code, or one of your recovery codes.">
                  <input
                    className={inputClass + ' font-mono tracking-widest'}
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={64}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <Button type="submit" loading={loading} size="lg" className="w-full" disabled={!code.trim()}>
                  Verify & sign in <ArrowRight className="h-4 w-4" />
                </Button>
              </form>

              <div className="mt-4 flex items-center justify-between text-sm">
                {step === 'email' ? (
                  <button type="button" onClick={resend} disabled={resendIn > 0 || loading} className="font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline">
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                  </button>
                ) : <span />}
                <button type="button" onClick={() => restart()} className="text-ink-500 hover:text-ink-700 hover:underline">
                  Start over
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Bullet({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm text-ink-200">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">{icon}</span>
      {text}
    </li>
  );
}

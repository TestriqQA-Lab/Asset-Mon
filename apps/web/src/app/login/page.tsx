'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, setSession } from '@/lib/api';
import { Field, inputClass, Button } from '@/components/ui';
import { ArrowRight, Boxes, ShieldCheck, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const r = useRouter();
  const [form, setForm] = useState({ email: '', password: '', workspaceSlug: '', totp: '' });
  const [loading, setLoading] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [availableSlugs, setAvailableSlugs] = useState<string[] | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: any = { email: form.email, password: form.password };
      if (form.workspaceSlug) payload.workspaceSlug = form.workspaceSlug;
      if (needsTotp && form.totp) payload.totp = form.totp.replace(/\s+/g, '');
      const s = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload), auth: false });
      setSession(s);
      toast.success(`Welcome back, ${s.user.email}`);
      r.push('/dashboard');
    } catch (e: any) {
      const msg = String(e.message || '');
      const code = e?.payload?.message?.code || e?.payload?.code;
      // Functional follow-up prompts (workspace picker, authenticator code) are
      // kept because the user can't continue without them, but the generic-
      // failure path never surfaces server-side reasons (lockout, throttle, etc.).
      if (code === 'WORKSPACE_REQUIRED' || /WORKSPACE_REQUIRED/i.test(msg)) {
        const slugs: string[] | undefined = e?.payload?.message?.availableSlugs || e?.payload?.availableSlugs;
        setAvailableSlugs(slugs ?? []);
        toast.message('Pick a workspace to continue.');
      } else if (/TOTP_REQUIRED/i.test(msg) || /two[- ]factor/i.test(msg)) {
        setNeedsTotp(true);
        toast.message('Enter your authenticator code to continue.');
      } else {
        toast.error('Invalid email or password.');
      }
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
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in</h1>
          <p className="mt-1 text-sm text-ink-500">Enter your credentials to access your workspace.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
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
              <Field label="Authenticator code" hint="6-digit code from your TOTP app">
                <input
                  className={inputClass}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  autoFocus
                  value={form.totp}
                  onChange={(e) => setForm({ ...form, totp: e.target.value })}
                />
              </Field>
            )}
            <Button type="submit" loading={loading} size="lg" className="w-full">
              {needsTotp ? 'Verify & sign in' : 'Sign in'} <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-500">
            No workspace yet? <a href="/signup" className="font-medium text-brand-600 hover:underline">Create one</a>
          </p>
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

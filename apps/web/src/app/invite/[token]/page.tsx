'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { api, setSession } from '@/lib/api';
import { Field, inputClass, Button } from '@/components/ui';
import { ArrowRight, Boxes, ShieldCheck, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';

type InviteInfo = { workspaceName: string; slug: string };

export default function AcceptInvitePage() {
  const r = useRouter();
  const params = useParams<{ token: string }>();
  const token = params?.token || '';
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<InviteInfo>(`/auth/invite/${encodeURIComponent(token)}`, { auth: false });
        if (!cancelled) setInfo(res);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Invite link is invalid or revoked');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await api(`/auth/invite/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify(form),
        auth: false,
      });
      setSession(s);
      toast.success(`Joined "${s.tenant.slug}"`);
      r.push('/dashboard');
    } catch (e: any) {
      toast.error(e.message);
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
            You've been invited.<br />
            <span className="text-ink-400">Create your account to join.</span>
          </h2>
          <ul className="space-y-3">
            <Bullet icon={<Boxes className="h-4 w-4" />} text="Access shared assets, tickets and reports" />
            <Bullet icon={<ShieldCheck className="h-4 w-4" />} text="Single sign-on, audit-tracked actions" />
            <Bullet icon={<Sparkles className="h-4 w-4" />} text="Up and running in under a minute" />
          </ul>
        </div>
        <div className="relative z-10 text-xs text-ink-400">© AssetMon · {new Date().getFullYear()}</div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md">
          {checking ? (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Validating invite…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Invite unavailable
              </div>
              <p>{error}</p>
              <p className="mt-3 text-xs text-red-600/80">
                Ask the workspace admin for a fresh link, or <a href="/login" className="font-medium underline">sign in</a> if you already have an account.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6 rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3 text-sm text-ink-700">
                You've been invited to join <b>{info?.workspaceName}</b>
                <span className="ml-1 text-ink-500">({info?.slug})</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your account</h1>
              <p className="mt-1 text-sm text-ink-500">You'll be added with Employee permissions.</p>
              <form onSubmit={submit} className="mt-8 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name">
                    <input className={inputClass} name="firstName" autoComplete="given-name" required value={form.firstName} onChange={onChange} />
                  </Field>
                  <Field label="Last name">
                    <input className={inputClass} name="lastName" autoComplete="family-name" required value={form.lastName} onChange={onChange} />
                  </Field>
                </div>
                <Field label="Work email">
                  <input className={inputClass} name="email" type="email" autoComplete="email" required value={form.email} onChange={onChange} />
                </Field>
                <Field label="Password" hint="minimum 8 characters">
                  <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={onChange} />
                </Field>
                <Button type="submit" loading={loading} size="lg" className="w-full">
                  Join workspace <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-6 text-center text-sm text-ink-500">
                Already have an account? <a href="/login" className="font-medium text-brand-600 hover:underline">Sign in</a>
              </p>
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

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, setSession } from '@/lib/api';
import { Field, inputClass, Button } from '@/components/ui';
import { ArrowRight, Boxes, ShieldCheck, Sparkles } from 'lucide-react';

export default function SignupPage() {
  const r = useRouter();
  const [form, setForm] = useState({
    workspaceName: '', slug: '', firstName: '', lastName: '', email: '', password: '',
  });
  const [loading, setLoading] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await api('/auth/signup', { method: 'POST', body: JSON.stringify(form), auth: false });
      setSession(s);
      toast.success(`Workspace "${s.tenant.slug}" created`);
      r.push('/dashboard');
    } catch (e: any) {
      // The slug-already-taken case is the only one a normal user can fix
      // themselves; surface a hint for that one and keep everything else generic.
      const msg = String(e?.message || '');
      if (/slug.*taken|already.*taken|already.*exist/i.test(msg)) {
        toast.error('That workspace name is taken. Try a different one.');
      } else {
        toast.error('Could not create workspace. Please try again.');
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
            A workspace of your own.<br />
            <span className="text-ink-400">Spin one up in seconds.</span>
          </h2>
          <ul className="space-y-3">
            {/* Not "your own database": workspaces share one database and are separated
                by tenantId, enforced on every query by the scoping client in
                apps/api/src/tenancy. Promising a dedicated database would be a claim
                the product no longer meets. */}
            <Bullet icon={<Boxes className="h-4 w-4" />} text="Your data, isolated from every other workspace" />
            <Bullet icon={<ShieldCheck className="h-4 w-4" />} text="RBAC, audit log, API keys, webhooks out of the box" />
            <Bullet icon={<Sparkles className="h-4 w-4" />} text="From check-out to depreciation — one tool" />
          </ul>
        </div>
        <div className="relative z-10 text-xs text-ink-400">© AssetMon · {new Date().getFullYear()}</div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create workspace</h1>
          <p className="mt-1 text-sm text-ink-500">Ready to use in seconds — no setup, no credit card.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Workspace name">
              <input className={inputClass} name="workspaceName" autoComplete="organization" required value={form.workspaceName} onChange={onChange} />
            </Field>
            {/* The dash in `pattern` is escaped because browsers compile that attribute
                with the RegExp `v` flag, which rejects an unescaped `-` inside a
                character class. An invalid pattern is discarded silently — Chrome only
                logs it — so the field validated nothing at all, and a bad slug reached
                the server and came back as a generic "could not create workspace". */}
            <Field label="Workspace slug" hint="3+ lowercase letters, numbers, or dashes — used in your workspace URL">
              <input
                className={inputClass}
                name="slug"
                autoComplete="off"
                pattern="^[a-z0-9\-]{3,40}$"
                minLength={3}
                maxLength={40}
                required
                value={form.slug}
                onChange={onChange}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input className={inputClass} name="firstName" autoComplete="given-name" required value={form.firstName} onChange={onChange} />
              </Field>
              <Field label="Last name">
                <input className={inputClass} name="lastName" autoComplete="family-name" required value={form.lastName} onChange={onChange} />
              </Field>
            </div>
            <Field label="Email">
              <input className={inputClass} name="email" type="email" autoComplete="email" required value={form.email} onChange={onChange} />
            </Field>
            <Field label="Password" hint="minimum 8 characters">
              <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={onChange} />
            </Field>
            <Button type="submit" loading={loading} size="lg" className="w-full">
              Create workspace <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-500">
            Have a workspace? <a href="/login" className="font-medium text-brand-600 hover:underline">Sign in</a>
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

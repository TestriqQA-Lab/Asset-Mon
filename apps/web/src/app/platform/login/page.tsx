'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { papi, setPlatformSession } from '@/lib/platform-api';
import { Field, inputClass, Button } from '@/components/ui';
import { ShieldCheck } from 'lucide-react';

// Strict policy for this file: every visible string must be safe to show on
// the public internet. No API paths, no role identifiers, no CLI / env-var /
// header names, no DB names, no stack hints. The form intentionally never
// reveals whether the platform has been initialised — there is no public
// provisioning path; admins are added directly in the database by an
// operator with shell access.

export default function PlatformLoginPage() {
  const r = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await papi('/platform/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.email, password: form.password }),
        auth: false,
      });
      setPlatformSession(s);
      r.push('/platform');
    } catch {
      // Generic — never reveal lockout, throttling, "no such user", etc.
      toast.error('Invalid email or password.');
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
            Sign in to manage your organization's workspaces.
          </p>
        </div>

        <div className="relative z-10 text-xs text-white/50">
          Authorized personnel only
        </div>
      </div>

      <div className="flex items-center justify-center bg-ink-50 p-6">
        <div className="w-full max-w-md">
          <form onSubmit={submit} className="space-y-5 rounded-2xl border border-ink-200 bg-white p-8 shadow-card">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in</h2>
            </div>

            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoFocus
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="current-password"
              />
            </Field>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

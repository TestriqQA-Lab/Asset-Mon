'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { papi, clearPlatformSession, getPlatformSession } from '@/lib/platform-api';
import { Card, Field, Button, inputClass } from '@/components/ui';
import { KeyRound } from 'lucide-react';

// User-facing copy never references the underlying API path, role names,
// lockout details, or any internal terminology.

export default function PlatformAccountPage() {
  const r = useRouter();
  const session = getPlatformSession();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHint(null);

    if (form.newPassword !== form.confirm) {
      setHint('The two new password entries do not match.');
      return;
    }
    if (form.newPassword.length < 10) {
      setHint('Use at least 10 characters.');
      return;
    }
    if (!/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) {
      setHint('Include at least one letter and one digit.');
      return;
    }
    if (form.newPassword === form.currentPassword) {
      setHint('Pick a new password that is different from the current one.');
      return;
    }

    setLoading(true);
    try {
      await papi('/platform/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      toast.success('Password updated. Please sign in again.');
      // Server bumped tokenVersion, so every existing session (including this
      // tab) is now invalid. Clear locally and bounce to the sign-in page.
      clearPlatformSession();
      setTimeout(() => r.replace('/platform/login'), 600);
    } catch (e: any) {
      // Surface only the policy violation (it's user-actionable) — everything
      // else gets a single generic message.
      const msg = String(e?.message || '');
      if (/at least \d+ characters|letter and one digit|different from the current/i.test(msg)) {
        setHint(msg);
      } else {
        setHint('Could not update password. Check your current password and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Account</h1>
        <p className="truncate text-sm text-ink-500">Signed in as {session?.user.email}.</p>
      </div>

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-violet-700" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-600">Change password</h2>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              required
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
          </Field>
          <Field
            label="New password"
            hint="At least 10 characters, including a letter and a digit."
          >
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              required
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              required
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </Field>

          {hint && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {hint}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-500">
              All other open sessions will be signed out after the change.
            </p>
            <Button type="submit" disabled={loading} loading={loading} className="self-end sm:self-auto">
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

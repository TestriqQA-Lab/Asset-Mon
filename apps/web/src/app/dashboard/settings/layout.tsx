'use client';

import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/components/ui';
import { usePermissions, useSettings } from '@/lib/settings';
import { SETTINGS_GROUPS } from '@/lib/settings-nav';

/**
 * Sub-navigation for the settings area. Without it, opening a settings page from the
 * hub is a dead end — you would have to go back to reach a sibling. The hub itself
 * (/dashboard/settings) renders its own cards, so the rail is suppressed there.
 *
 * Note some settings destinations live outside /dashboard/settings (users, audit,
 * api-keys, webhooks, admin), so this layout cannot wrap them; the rail links to them
 * anyway and the hub remains the common entry point.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '';
  const perms = usePermissions();
  const settings = useSettings();

  const isHub = path === '/dashboard/settings';

  const groups = SETTINGS_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.module || settings.modules[i.module]) && perms.canSee(i.navKey)),
    }))
    .filter((g) => g.items.length > 0);

  if (isHub || groups.length === 0) return <>{children}</>;

  return (
    <div className="flex gap-6">
      <aside className="hidden w-52 shrink-0 lg:block" aria-label="Settings sections">
        <a
          href="/dashboard/settings"
          className="mb-3 flex items-center gap-1.5 px-3 text-xs text-ink-500 transition hover:text-ink-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All settings
        </a>
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = path === item.href || path.startsWith(item.href + '/');
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      active ? 'bg-ink-900 font-medium text-white' : 'text-ink-600 hover:bg-ink-100/70',
                    )}
                  >
                    <span className={active ? 'text-white' : 'text-ink-400'}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

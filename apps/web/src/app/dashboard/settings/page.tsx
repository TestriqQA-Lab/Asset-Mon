'use client';
import Link from 'next/link';

import { SectionHeader, Card, EmptyState } from '@/components/ui';
import { Settings as SettingsIcon, ChevronRight } from 'lucide-react';
import { usePermissions, useSettings } from '@/lib/settings';
import { SETTINGS_GROUPS } from '@/lib/settings-nav';

/**
 * The workspace settings hub. Configuration used to sit in the primary nav as a
 * nine-item dropdown competing with daily work; it now lives here, reached from the
 * gear icon. Items are filtered by the same role permissions and module toggles the
 * nav uses, so a role only ever sees what it may actually open.
 */
export default function SettingsHomePage() {
  const perms = usePermissions();
  const settings = useSettings();

  const groups = SETTINGS_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        if (i.module && !settings.modules[i.module]) return false;
        return perms.canSee(i.navKey);
      }),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Settings"
        subtitle="Workspace configuration, people and integrations"
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={<SettingsIcon className="h-4 w-4" />}
          title="No settings available"
          description="Your role doesn't have access to any workspace settings. Your own security options are in the account menu, top right."
        />
      ) : (
        groups.map((group) => (
          <section key={group.label} className="space-y-2">
            <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {group.label}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className="group block">
                  <Card padded={false} className="flex items-center gap-3 p-3.5 transition hover:border-brand-200 hover:shadow-pop">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-500 transition group-hover:bg-brand-50 group-hover:text-brand-600">
                      {item.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink-900">{item.label}</div>
                      <div className="truncate text-xs text-ink-500">{item.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-300 transition group-hover:text-brand-500" />
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

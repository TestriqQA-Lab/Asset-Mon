'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/components/ui';
import { usePermissions, useSettings } from '@/lib/settings';
import { ASSETS_TABS } from '@/lib/assets-nav';

/**
 * Tab strip for the Assets area, rendered by the dashboard layout so every page in
 * the area gets it without repeating markup.
 *
 * Employees get a different strip: they cannot manage categories or departments, so a
 * config strip would collapse to a single useless tab. Instead they get the two views
 * that answer their actual questions — what do I hold, and what exists.
 */
export function AssetsTabs() {
  const path = usePathname() || '';
  const searchParams = useSearchParams();
  const perms = usePermissions();
  const settings = useSettings();

  const isEmployee = perms.role === 'EMPLOYEE';
  const mineActive = searchParams?.get('assignedToMe') === '1';

  const tabs = isEmployee
    ? [
        { href: '/dashboard/assets?assignedToMe=1', label: 'Assigned to me', active: path === '/dashboard/assets' && mineActive },
        { href: '/dashboard/assets', label: 'All equipment', active: path === '/dashboard/assets' && !mineActive },
      ]
    : ASSETS_TABS
        .filter((t) => (!t.module || settings.modules[t.module]) && perms.canSee(t.navKey))
        .map((t) => ({
          href: t.href,
          label: t.label,
          active: path === t.href || path.startsWith(t.href + '/'),
        }));

  // A single tab is not a choice — don't render chrome for it.
  if (tabs.length < 2) return null;

  return (
    <div className="mb-4 border-b border-ink-200">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Assets sections">
        {tabs.map((t) => (
          <a
            key={t.href}
            href={t.href}
            aria-current={t.active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition',
              t.active
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-700',
            )}
          >
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

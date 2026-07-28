import type { NavKey } from '@/lib/permissions';
import type { ModuleKey } from '@/lib/settings';

/**
 * The Assets area is one destination with tabs, not six sibling nav entries.
 * Categories, departments, statuses, software and licences all configure or classify
 * assets — they are not peers of "Assets" in a user's mental model, and promoting
 * them to top-level nav is what made the Inventory menu long.
 *
 * Statuses lives under /dashboard/settings/statuses for historical reasons; the URL is
 * unchanged so existing links and permissions keep working.
 */
export type AssetsTab = {
  href: string;
  label: string;
  navKey: NavKey;
  module?: ModuleKey;
};

export const ASSETS_TABS: AssetsTab[] = [
  { href: '/dashboard/assets', label: 'All assets', navKey: 'assets' },
  { href: '/dashboard/categories', label: 'Categories', navKey: 'categories' },
  { href: '/dashboard/departments', label: 'Departments', navKey: 'departments' },
  { href: '/dashboard/settings/statuses', label: 'Statuses', navKey: 'settings:statuses' },
  { href: '/dashboard/software', label: 'Software', navKey: 'software', module: 'software' },
  { href: '/dashboard/licenses', label: 'Licences', navKey: 'licenses', module: 'software' },
];

/** True when `path` belongs to the Assets area (so the tab strip should render). */
export function isAssetsAreaPath(path: string): boolean {
  return ASSETS_TABS.some((t) => path === t.href || path.startsWith(t.href + '/'));
}

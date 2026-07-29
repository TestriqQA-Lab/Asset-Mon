import type { ReactNode } from 'react';
import {
  Users, Lock, Palette, Sliders, CreditCard, KeyRound, Webhook,
  ScrollText, Shield,
} from 'lucide-react';
import type { NavKey } from '@/lib/permissions';
import type { ModuleKey } from '@/lib/settings';

/**
 * Workspace configuration lives in its own area (`/dashboard/settings`) rather than
 * as a group in the primary nav — it is a destination you visit occasionally, not
 * something that should compete with daily work.
 *
 * Note these items are still consumed by the dashboard layout's page-level access
 * gate: it matches the current path against every known nav item to decide whether
 * the role may view it. Dropping them from that lookup would silently disable the
 * gate on every settings page, so `SETTINGS_ITEMS` is exported for that purpose.
 */
export type SettingsNavItem = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  navKey: NavKey;
  module?: ModuleKey;
};

export type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

export const SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    label: 'People',
    items: [
      { href: '/dashboard/users', label: 'Users & invites', description: 'Add teammates, change roles, offboard leavers', icon: <Users className="h-4 w-4" />, navKey: 'users' },
      { href: '/dashboard/settings/permissions', label: 'Permissions', description: 'Choose what each role can open', icon: <Lock className="h-4 w-4" />, navKey: 'settings:permissions' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard/settings/branding', label: 'Branding', description: 'Logo, colours and workspace name', icon: <Palette className="h-4 w-4" />, navKey: 'settings:branding' },
      { href: '/dashboard/settings/modules', label: 'Modules', description: 'Turn features on or off', icon: <Sliders className="h-4 w-4" />, navKey: 'settings:modules' },
      // Asset statuses is deliberately absent — it configures assets, so it lives as a
      // page under the Assets function in the sidebar. The URL is unchanged.
    ],
  },
  {
    label: 'Billing',
    items: [
      { href: '/dashboard/settings/billing', label: 'Plan & billing', description: 'Your plan, seats and invoices', icon: <CreditCard className="h-4 w-4" />, navKey: 'settings:billing' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { href: '/dashboard/api-keys', label: 'API keys', description: 'Keys for scripts and integrations', icon: <KeyRound className="h-4 w-4" />, navKey: 'api-keys', module: 'integrations' },
      { href: '/dashboard/webhooks', label: 'Webhooks', description: 'Send events to another system', icon: <Webhook className="h-4 w-4" />, navKey: 'webhooks', module: 'integrations' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/dashboard/audit', label: 'Audit log', description: 'A tamper-evident record of every change', icon: <ScrollText className="h-4 w-4" />, navKey: 'audit-log' },
      { href: '/dashboard/admin', label: 'Admin home', description: 'Workspace overview for administrators', icon: <Shield className="h-4 w-4" />, navKey: 'admin-home' },
    ],
  },
];

/** Flat list — used by the layout's page-level access gate. */
export const SETTINGS_ITEMS: SettingsNavItem[] = SETTINGS_GROUPS.flatMap((g) => g.items);

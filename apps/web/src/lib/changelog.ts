export type ChangelogEntry = { date: string; title: string; items: string[]; tag?: 'feature' | 'fix' | 'security' };

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-05-11', title: 'Modular platform, branding & growth bundle', tag: 'feature',
    items: [
      'Cmd+K global command palette',
      'Bulk actions on assets (status / location / retire / delete)',
      '2FA (TOTP) for any role',
      'Notifications bell with in-app inbox',
      'Setup checklist widget on dashboard',
      'Audit-log tamper-evident hash chain',
      'Billing page with plan limits enforcement',
      'PWA manifest + standalone install hint',
    ],
  },
  {
    date: '2026-05-08', title: 'Branding + module toggles', tag: 'feature',
    items: [
      'Per-tenant logo upload (PNG/JPEG/WebP/SVG)',
      'Theme colour picker — applied live across the UI',
      'Settings → Modules to toggle features at the API + UI layer',
    ],
  },
  {
    date: '2026-05-04', title: 'Integrations & reports', tag: 'feature',
    items: [
      'API keys (scoped read-only or read-write, revocable)',
      'Webhooks with HMAC-SHA256 signatures and retry queue',
      'Email notifications on key events (assignee on ticket open)',
      '8 built-in reports with CSV export',
      '/api/metrics endpoint for observability scraping',
    ],
  },
  {
    date: '2026-04-25', title: 'Physical audits + reservations', tag: 'feature',
    items: [
      'Scan-to-audit page with live discrepancy reports',
      'Reservations with conflict detection and pickup → check-out conversion',
    ],
  },
  {
    date: '2026-04-18', title: 'Software & licenses', tag: 'feature',
    items: [
      'Software catalog + license seats',
      'Compliance report with over-deployment flagging',
      'Expiry alerts surfaced on the dashboard',
    ],
  },
  {
    date: '2026-04-12', title: 'Procurement & depreciation', tag: 'feature',
    items: [
      'Purchase requests with approval workflow',
      'Purchase orders that auto-create assets on receipt',
      'Straight-line and double-declining depreciation engine',
    ],
  },
];

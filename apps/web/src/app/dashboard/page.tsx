'use client';
import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toCsv, downloadCsv } from '@/lib/csv';
import {
  Package, CheckCircle2, UserCheck, Wrench, Archive,
  AlertTriangle, CalendarClock, KeyRound, FileWarning, Activity, HandHelping,
  Search, RefreshCw, Download, Printer, Maximize, Minimize2, Save, Droplet, Keyboard, Users, Ticket, X
} from 'lucide-react';
import { Card, StatCard, Pill, SectionHeader, EmptyState, Skeleton } from '@/components/ui';
import { usePermissions } from '@/lib/settings';

const TYPE_LABEL: Record<string, string> = { ASSET: 'Asset', ACCESSORY: 'Accessory', LICENSE: 'License' };
// Escape user-provided text before interpolating it into the print window's HTML.
const escapeHtml = (v: any) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
)[c]);

export default function DashboardHome() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me') });
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/dashboard/stats') });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api('/dashboard/alerts') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const perms = usePermissions();
  const isEmployee = perms.role === 'EMPLOYEE';
  // Employee-specific: count pending asset requests
  const myRequests = useQuery({
    queryKey: ['my-asset-requests-pending'],
    queryFn: () => api('/asset-requests?status=PENDING'),
    enabled: isEmployee,
  });
  const s = stats.data;

  // ── Asset Categories panel state ──
  const [catSearch, setCatSearch] = useState('');
  const [catExpanded, setCatExpanded] = useState(false);
  const catPanelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Every category merged with its asset count. The stats "byCategory" grouping
  // only includes categories that HAVE assets, so on its own it omits empty
  // categories (e.g. a brand-new "Furniture"). Merging against the full category
  // list makes the panel show them all (count 0). Falls back to byCategory until
  // the full list loads so the table never flashes empty.
  const allCategories = useCallback((): any[] => {
    const full = categories.data as any[] | undefined;
    if (!full) return s?.byCategory || [];
    // Use the category endpoint's own live count (assetCount) and real type.
    const merged = full.map((c: any) => ({ id: c.id, name: c.name, type: c.type, count: c.assetCount ?? 0 }));
    const uncategorized = (s?.byCategory || []).find((c: any) => !c.id);
    if (uncategorized) merged.push({ id: '__uncategorized__', name: 'Uncategorized', type: null, count: uncategorized.count });
    return merged;
  }, [s, categories.data]);

  // Filter categories by search term (case-insensitive)
  const filteredCategories = useCallback(() => {
    const cats = allCategories();
    if (!catSearch.trim()) return cats;
    const term = catSearch.trim().toLowerCase();
    return cats.filter((c: any) => c.name.toLowerCase().includes(term));
  }, [allCategories, catSearch]);

  // Refresh: force a re-fetch of the stats + category data from the server.
  const handleCatRefresh = useCallback(() => {
    setCatSearch('');
    queryClient.refetchQueries({ queryKey: ['stats'] });
    queryClient.refetchQueries({ queryKey: ['categories'] });
  }, [queryClient]);

  // Download: export categories as CSV
  const handleCatDownload = useCallback(() => {
    const cats = filteredCategories();
    if (!cats.length) return;
    const rows = cats.map((c: any) => [c.name, TYPE_LABEL[c.type] || 'Asset', c.count]);
    downloadCsv(`asset-categories-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Name', 'Type', 'Asset Count'], rows));
  }, [filteredCategories]);

  // Print: open browser print dialog scoped to the category panel
  const handleCatPrint = useCallback(() => {
    const panel = catPanelRef.current;
    if (!panel) return;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Asset Categories</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1a1a1a; }
            h1 { font-size: 18px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e5e5; font-size: 13px; }
            th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
            .count { text-align: center; font-family: monospace; }
            .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 8px; vertical-align: middle; }
            .footer { margin-top: 16px; font-size: 11px; color: #999; }
          </style>
        </head>
        <body>
          <h1>Asset Categories</h1>
          <table>
            <thead><tr><th>Name</th><th>Type</th><th class="count">Asset Count</th></tr></thead>
            <tbody>
              ${filteredCategories().map((c: any) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(TYPE_LABEL[c.type] || 'Asset')}</td><td class="count">${escapeHtml(c.count)}</td></tr>`).join('')}
            </tbody>
          </table>
          <div class="footer">Printed on ${new Date().toLocaleString()} &bull; AssetMon</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }, [filteredCategories]);

  const displayedCategories = filteredCategories();

  // ── Recent Activity panel state ──
  const [actSearch, setActSearch] = useState('');
  const [actExpanded, setActExpanded] = useState(false);
  const actPanelRef = useRef<HTMLDivElement>(null);

  // Admin-gated: fetch full audit log (up to 100 entries) for the dashboard.
  // Falls back to stats.recentActivity (10 entries) for ASSET_MANAGER,
  // and empty for EMPLOYEE (API already returns []).
  const canSeeAudit = perms.isAdmin && perms.canSee('audit-log');
  const auditQuery = useQuery({
    queryKey: ['audit', 100],
    queryFn: () => api<any[]>('/audit?limit=100'),
    enabled: canSeeAudit,
  });
  const activitySource: any[] = canSeeAudit
    ? (auditQuery.data ?? [])
    : (s?.recentActivity ?? []);
  const activityLoading = canSeeAudit ? auditQuery.isLoading : !s;
  const activityFetching = canSeeAudit
    ? auditQuery.isFetching
    : stats.isFetching;

  // Prettify action string: replace underscores & dots with spaces, title-case first word
  const prettifyAction = (action: string) =>
    action.replace(/[_.]/g, ' ').toLowerCase();

  // Performer display: firstName + lastName → fallback email → —
  const performerName = (p: any) => {
    if (!p) return '—';
    if (p.firstName || p.lastName) return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
    return p.email ?? '—';
  };

  // Filter activity by search term across action, asset tag/name, performer
  const filteredActivity = useCallback(() => {
    if (!actSearch.trim()) return activitySource;
    const term = actSearch.trim().toLowerCase();
    return activitySource.filter((e: any) => {
      const action = (e.action || '').toLowerCase();
      const assetTag = (e.asset?.assetTag || '').toLowerCase();
      const assetName = (e.asset?.name || '').toLowerCase();
      const performer = performerName(e.performedBy).toLowerCase();
      return action.includes(term) || assetTag.includes(term) || assetName.includes(term) || performer.includes(term);
    });
  }, [activitySource, actSearch]);

  // Refresh: re-fetch audit (admin) + stats
  const handleActRefresh = useCallback(() => {
    setActSearch('');
    if (canSeeAudit) queryClient.invalidateQueries({ queryKey: ['audit', 100] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }, [queryClient, canSeeAudit]);

  // Download: export activity as CSV
  const handleActDownload = useCallback(() => {
    const rows = filteredActivity();
    if (!rows.length) return;
    const csvRows = rows.map((e: any) => {
      const d = new Date(e.createdAt);
      return [
        prettifyAction(e.action),
        e.asset ? `${e.asset.assetTag} · ${e.asset.name}` : '',
        performerName(e.performedBy),
        d.toLocaleDateString(),
        d.toLocaleTimeString(),
      ];
    });
    downloadCsv(`recent-activity-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Action', 'Asset', 'Performed By', 'Date', 'Time'], csvRows));
  }, [filteredActivity]);

  // Print: open browser print dialog with activity table
  const handleActPrint = useCallback(() => {
    const printWindow = window.open('', '_blank', 'width=900,height=600');
    if (!printWindow) return;
    const rows = filteredActivity();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Recent Activity</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1a1a1a; }
            h1 { font-size: 18px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e5e5; font-size: 13px; }
            th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
            .footer { margin-top: 16px; font-size: 11px; color: #999; }
          </style>
        </head>
        <body>
          <h1>Recent Activity</h1>
          <table>
            <thead><tr><th>Action</th><th>Asset</th><th>Performed By</th><th>When</th></tr></thead>
            <tbody>
              ${rows.map((e: any) => {
                const d = new Date(e.createdAt);
                const asset = e.asset ? `${e.asset.assetTag} · ${e.asset.name}` : '—';
                return `<tr><td>${escapeHtml(prettifyAction(e.action))}</td><td>${escapeHtml(asset)}</td><td>${escapeHtml(performerName(e.performedBy))}</td><td>${escapeHtml(d.toLocaleDateString() + ' ' + d.toLocaleTimeString())}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
          <div class="footer">Printed on ${new Date().toLocaleString()} &bull; AssetMon</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }, [filteredActivity]);

  const displayedActivity = filteredActivity();

  return (
    <div className="space-y-6">
      <SectionHeader
        title={`Welcome back${me.data?.user ? ', ' + me.data.user.firstName : ''}`}
        subtitle="Here's what's happening across your workspace today."
      />

      {!s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {s && !isEmployee && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total assets" value={s.total} accent="brand" icon={<Package className="h-4 w-4" />} href="/dashboard/assets" />
          <StatCard label="Total tickets" value={s.totalTickets || 0} accent="brand" icon={<Ticket className="h-4 w-4" />} href="/dashboard/tickets" />
          <StatCard label="Total users" value={s.totalUsers || 0} accent="brand" icon={<Users className="h-4 w-4" />} href="/dashboard/users" />
          <StatCard label="Total licenses" value={s.totalLicenses || 0} accent="brand" icon={<KeyRound className="h-4 w-4" />} href="/dashboard/licenses" />
        </div>
      )}

      {/* Employee-specific cards */}
      {isEmployee && s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="My pending requests" value={myRequests.data?.length || 0} accent="amber" icon={<HandHelping className="h-4 w-4" />} href="/dashboard/asset-requests" />
          <StatCard label="My open tickets" value={s.myOpenTickets ?? 0} accent="amber" icon={<AlertTriangle className="h-4 w-4" />} href="/dashboard/tickets?mine=true" />
          <StatCard label="My assets" value={s.myAssignedAssets ?? 0} accent="brand" icon={<UserCheck className="h-4 w-4" />} href="/dashboard/assets" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left: by-category + recent activity */}
        <div className="space-y-5 lg:col-span-2">
          {/* Expanded backdrop — rendered OUTSIDE the Card so z-index stacking works */}
          {catExpanded && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCatExpanded(false)} />
          )}

          <Card
            ref={catPanelRef}
            padded={false}
            className={`flex flex-col p-0 transition-all duration-300 ${
              catExpanded
                ? 'fixed inset-4 z-50 bg-white shadow-2xl rounded-xl overflow-hidden'
                : 'overflow-hidden'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 bg-ink-50/50 shrink-0">
              <h2 className="text-sm font-semibold text-ink-900">Asset Categories</h2>
              {catExpanded && (
                <span className="text-xs text-ink-400">{displayedCategories.length} categories</span>
              )}
            </div>
            
            {/* Toolbar */}
            <div className="p-3 flex flex-wrap items-center justify-end gap-2 border-b border-ink-100 bg-white shrink-0">
              <div className="flex border border-ink-200 rounded-md overflow-hidden bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-all">
                <input
                  type="text"
                  placeholder="Search categories…"
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  className="px-3 py-1.5 text-sm w-48 outline-none text-ink-900"
                />
                <button
                  onClick={() => setCatSearch('')}
                  className="bg-ink-50 hover:bg-ink-100 text-ink-500 px-2 flex items-center justify-center border-l border-ink-200 transition-colors"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex rounded-md overflow-hidden border border-ink-200 shadow-sm">
                <button onClick={handleCatRefresh} title="Refresh" className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 border-r border-ink-200 transition-colors"><RefreshCw className={`h-4 w-4 ${(stats.isFetching || categories.isFetching) ? 'animate-spin' : ''}`} /></button>
                <button onClick={handleCatDownload} title="Download CSV" className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 border-r border-ink-200 transition-colors"><Download className="h-4 w-4" /></button>
                <button onClick={handleCatPrint} title="Print" className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 border-r border-ink-200 transition-colors"><Printer className="h-4 w-4" /></button>
                <button onClick={() => setCatExpanded(!catExpanded)} title={catExpanded ? 'Collapse' : 'Expand'} className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 transition-colors">
                  {catExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Table — scrollable in both normal and expanded mode */}
            <div className={`overflow-x-auto ${
              catExpanded
                ? 'flex-1 min-h-0 overflow-y-auto'
                : 'max-h-[400px] overflow-y-auto'
            }`}>
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 border-b border-ink-100 font-medium bg-ink-50">Name</th>
                    <th className="px-4 py-3 border-b border-ink-100 font-medium bg-ink-50">Type</th>
                    <th className="px-4 py-3 border-b border-ink-100 text-center font-medium bg-ink-50" title="Asset count">Asset</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 bg-white">
                  {!s ? (
                    <tr><td colSpan={3} className="p-8 text-center text-ink-400">Loading categories...</td></tr>
                  ) : displayedCategories.length === 0 ? (
                    <tr><td colSpan={3} className="p-8 text-center text-ink-400">{catSearch ? `No categories matching "${catSearch}"` : 'No categories found.'}</td></tr>
                  ) : (
                    displayedCategories.map((c: any, i: number) => {
                      const colors = ['bg-brand-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500', 'bg-purple-500', 'bg-pink-500', 'bg-sky-500'];
                      const color = colors[i % colors.length];
                      return (
                        <tr key={c.id} className="hover:bg-ink-50 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-ink-900 flex items-center gap-2">
                            <span className={`${color} h-3.5 w-3.5 rounded-sm shrink-0`}></span>
                            {c.name}
                          </td>
                          <td className="px-4 py-2.5 text-ink-600">{TYPE_LABEL[c.type] || 'Asset'}</td>
                          <td className="px-4 py-2.5 text-center text-ink-600 font-mono text-xs">{c.count}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            
            {!catExpanded && (
              <a href="/dashboard/categories" className="block w-full text-center bg-brand-50 hover:bg-brand-100 text-brand-700 py-2.5 text-sm font-medium transition-colors border-t border-ink-100 shrink-0">
                View All
              </a>
            )}
          </Card>

          {/* Expanded activity backdrop */}
          {actExpanded && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setActExpanded(false)} />
          )}

          <Card
            ref={actPanelRef}
            padded={false}
            className={`flex flex-col p-0 transition-all duration-300 ${
              actExpanded
                ? 'fixed inset-4 z-50 bg-white shadow-2xl rounded-xl overflow-hidden'
                : 'overflow-hidden'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 bg-ink-50/50 shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-ink-500" />
                <h2 className="text-sm font-semibold text-ink-900">Recent Activity</h2>
              </div>
              {actExpanded && (
                <span className="text-xs text-ink-400">{displayedActivity.length} entries</span>
              )}
            </div>

            {/* Toolbar */}
            <div className="p-3 flex flex-wrap items-center justify-end gap-2 border-b border-ink-100 bg-white shrink-0">
              <div className="flex border border-ink-200 rounded-md overflow-hidden bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-all">
                <input
                  type="text"
                  placeholder="Search activity…"
                  value={actSearch}
                  onChange={(e) => setActSearch(e.target.value)}
                  className="px-3 py-1.5 text-sm w-48 outline-none text-ink-900"
                />
                <button
                  onClick={() => setActSearch('')}
                  className="bg-ink-50 hover:bg-ink-100 text-ink-500 px-2 flex items-center justify-center border-l border-ink-200 transition-colors"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex rounded-md overflow-hidden border border-ink-200 shadow-sm">
                <button onClick={handleActRefresh} title="Refresh" className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 border-r border-ink-200 transition-colors">
                  <RefreshCw className={`h-4 w-4 ${activityFetching ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={handleActDownload} title="Download CSV" className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 border-r border-ink-200 transition-colors"><Download className="h-4 w-4" /></button>
                <button onClick={handleActPrint} title="Print" className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 border-r border-ink-200 transition-colors"><Printer className="h-4 w-4" /></button>
                <button onClick={() => setActExpanded(!actExpanded)} title={actExpanded ? 'Collapse' : 'Expand'} className="bg-white hover:bg-ink-50 text-ink-600 p-1.5 transition-colors">
                  {actExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Table — scrollable in both normal and expanded mode */}
            <div className={`overflow-x-auto ${
              actExpanded
                ? 'flex-1 min-h-0 overflow-y-auto'
                : 'max-h-[400px] overflow-y-auto'
            }`}>
              {activityLoading ? (
                <div className="p-8"><Skeleton className="h-40" /></div>
              ) : displayedActivity.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    title={actSearch ? `No activity matching "${actSearch}"` : 'No activity yet'}
                    description={actSearch ? 'Try a different search term.' : 'Asset, ticket and maintenance events will show up here.'}
                  />
                </div>
              ) : (
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 border-b border-ink-100 font-medium bg-ink-50">Action</th>
                      <th className="px-4 py-3 border-b border-ink-100 font-medium bg-ink-50">Asset</th>
                      <th className="px-4 py-3 border-b border-ink-100 font-medium bg-ink-50">Performed By</th>
                      <th className="px-4 py-3 border-b border-ink-100 font-medium bg-ink-50">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 bg-white">
                    {displayedActivity.map((e: any) => (
                      <tr key={e.id} className="hover:bg-ink-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <Pill tone="neutral">{prettifyAction(e.action)}</Pill>
                        </td>
                        <td className="px-4 py-2.5">
                          {e.asset ? (
                            <a className="font-mono text-xs text-ink-700 hover:text-brand-600" href={`/dashboard/assets/${e.asset.id}`}>
                              {e.asset.assetTag} · <span className="font-sans text-ink-500">{e.asset.name}</span>
                            </a>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-ink-600 text-xs">{performerName(e.performedBy)}</td>
                        <td className="px-4 py-2.5 text-ink-400 text-xs">
                          {new Date(e.createdAt).toLocaleDateString()} {new Date(e.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer: View All — admin only, when audit-log is visible */}
            {!actExpanded && canSeeAudit && (
              <a href="/dashboard/audit" className="block w-full text-center bg-brand-50 hover:bg-brand-100 text-brand-700 py-2.5 text-sm font-medium transition-colors border-t border-ink-100 shrink-0">
                View All
              </a>
            )}
          </Card>
        </div>

        {/* Right: Alerts */}
        <div className="space-y-4">
          <AlertGroup
            icon={<FileWarning className="h-4 w-4" />}
            tone="amber"
            title="Warranty expiring soon"
            empty="Nothing in the next 30 days."
            items={(alerts.data?.warranty || []).map((a: any) => ({
              href: `/dashboard/assets/${a.id}`,
              primary: `${a.assetTag} · ${a.name}`,
              secondary: new Date(a.warrantyEnd).toLocaleDateString(),
            }))}
          />
          <AlertGroup
            icon={<AlertTriangle className="h-4 w-4" />}
            tone="red"
            title="Overdue check-outs"
            empty="None right now."
            items={(alerts.data?.overdue || []).map((o: any) => ({
              href: `/dashboard/assets/${o.asset.id}`,
              primary: `${o.asset.assetTag}`,
              secondary: `${o.user ? `${o.user.firstName} ${o.user.lastName}` : 'Unknown user'} · due ${new Date(o.dueAt).toLocaleDateString()}`,
            }))}
          />
          <AlertGroup
            icon={<CalendarClock className="h-4 w-4" />}
            tone="brand"
            title="Maintenance due (7d)"
            empty="No upcoming maintenance."
            items={(alerts.data?.dueMaintenance || []).map((m: any) => ({
              href: `/dashboard/assets/${m.asset.id}`,
              primary: `${m.asset.assetTag} · ${m.title}`,
              secondary: new Date(m.nextDueAt).toLocaleDateString(),
            }))}
          />
          <AlertGroup
            icon={<Wrench className="h-4 w-4" />}
            tone="amber"
            title="Open service tickets"
            empty="All clear."
            items={(alerts.data?.openTickets || []).map((t: any) => ({
              href: `/dashboard/tickets/${t.id}`,
              primary: `${t.ticketNumber} · ${t.title}`,
              secondary: `${t.priority} · ${t.status}`,
            }))}
          />
          <AlertGroup
            icon={<KeyRound className="h-4 w-4" />}
            tone="red"
            title="Licenses expiring (30d)"
            empty="Nothing soon."
            items={(alerts.data?.expiringLicenses || []).map((l: any) => ({
              href: `/dashboard/licenses/${l.id}`,
              primary: l.software.name,
              secondary: new Date(l.expiresAt).toLocaleDateString(),
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function AlertGroup({
  title, icon, tone, items, empty,
}: { title: string; icon: React.ReactNode; tone: 'brand' | 'amber' | 'red'; items: { href: string; primary: string; secondary: string }[]; empty: string }) {
  const toneClasses = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
  }[tone];
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset ${toneClasses}`}>{icon}</span>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        </div>
        <span className="text-xs text-ink-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="border-t border-ink-100 px-4 py-4 text-xs text-ink-500">{empty}</div>
      ) : (
        <ul className="divide-y divide-ink-100 border-t border-ink-100">
          {items.slice(0, 4).map((it, i) => (
            <li key={i}>
              <a href={it.href} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-ink-50">
                <span className="truncate text-ink-700">{it.primary}</span>
                <span className="ml-3 shrink-0 text-xs text-ink-400">{it.secondary}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

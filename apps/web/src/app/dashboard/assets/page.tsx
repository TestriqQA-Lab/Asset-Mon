'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Download, Upload, Search, Trash2, Archive, BookmarkPlus, Share2, Star, X, Pencil, MoreVertical } from 'lucide-react';
import { api, getSession } from '@/lib/api';
import { Modal } from '@/components/Modal';
import {
  Button, Field, inputClass, selectClass, textareaClass,
  AssetStatusPill, SectionHeader, Card, THead, TH, TBody, TR, TD, EmptyState, Skeleton,
  MobileCard, MobileCardRow,
} from '@/components/ui';

type Filter = { q: string; status: string; categoryId: string; departmentId: string; parentId: string; onlyTopLevel: boolean; assignedToMe: boolean };
const EMPTY_FILTER: Filter = { q: '', status: '', categoryId: '', departmentId: '', parentId: '', onlyTopLevel: false, assignedToMe: false };

export default function AssetsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => ({
    ...EMPTY_FILTER,
    q: searchParams?.get('q') || '',
    status: searchParams?.get('status') || '',
    categoryId: searchParams?.get('categoryId') || '',
    departmentId: searchParams?.get('departmentId') || '',
    parentId: searchParams?.get('parentId') || '',
    onlyTopLevel: searchParams?.get('onlyTopLevel') === '1',
    // Driven by the "Assigned to me" tab in the Assets tab strip.
    assignedToMe: searchParams?.get('assignedToMe') === '1',
  }));
  const [activeViewId, setActiveViewId] = useState<string>('');

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const statusDefs = useQuery({ queryKey: ['status-defs'], queryFn: () => api('/asset-status-defs') });
  const savedViews = useQuery({ queryKey: ['saved-views', 'assets'], queryFn: () => api('/saved-views?kind=assets') });

  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  // Any filter change puts you back on page 1 — staying on page 4 of a narrower result
  // set usually shows an empty table.
  useEffect(() => { setPage(1); }, [filter]);

  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.status) params.set('status', filter.status);
  if (filter.categoryId) params.set('categoryId', filter.categoryId);
  if (filter.departmentId) params.set('departmentId', filter.departmentId);
  if (filter.parentId) params.set('parentId', filter.parentId);
  if (filter.onlyTopLevel) params.set('onlyTopLevel', '1');
  if (filter.assignedToMe) params.set('assignedToMe', '1');
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  const list = useQuery({
    queryKey: ['assets', filter, page],
    queryFn: () => api(`/assets?${params.toString()}`),
    placeholderData: (prev: any) => prev,
  });

  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / PAGE_SIZE));
  const rangeFrom = (list.data?.total || 0) === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, list.data?.total || 0);

  const [open, setOpen] = useState(false);
  const [savedViewModal, setSavedViewModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const ids = list.data?.items?.map((a: any) => a.id) || [];
    setSelected((s) => s.size === ids.length ? new Set() : new Set(ids));
  };
  const EMPTY_FORM = {
    name: '', assetTag: '', serialNumber: '', model: '', status: '', statusDefId: '',
    categoryId: '', departmentId: '',
    purchaseDate: '', purchaseCost: '', warrantyEnd: '', orderNumber: '', notes: '',
    requestable: false, imageFile: null as File | null, _showExtra: false,
  };
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const openEditModal = (a: any) => {
    setForm({
      name: a.name || '',
      assetTag: a.assetTag || '',
      serialNumber: a.serialNumber || '',
      model: a.model || '',
      status: a.status || '',
      statusDefId: a.statusDefId || '',
      categoryId: a.categoryId || '',
      departmentId: a.departmentId || '',
      purchaseDate: a.purchaseDate ? new Date(a.purchaseDate).toISOString().slice(0, 10) : '',
      purchaseCost: a.purchaseCost ?? '',
      warrantyEnd: a.warrantyEnd ? new Date(a.warrantyEnd).toISOString().slice(0, 10) : '',
      orderNumber: a.orderNumber || '',
      notes: a.notes || '',
      requestable: a.requestable ?? false,
      imageFile: null,
      _showExtra: !!(a.warrantyEnd || a.orderNumber || a.purchaseDate || a.purchaseCost),
    });
    setEditId(a.id);
  };
  // Open the create modal from a clean slate (never inherit the last-edited asset's values).
  const openNewModal = () => { setForm(EMPTY_FORM); setOpen(true); };
  // Object URL for the picked image preview, revoked on change/unmount (no per-render leak).
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  useEffect(() => {
    if (!form.imageFile) { setImagePreview(null); return; }
    const url = URL.createObjectURL(form.imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [form.imageFile]);

  const bulkUpdate = useMutation({
    mutationFn: (patch: any) => api('/assets/bulk/update', { method: 'POST', body: JSON.stringify({ ids: Array.from(selected), patch }) }),
    onSuccess: (r: any) => { toast.success(`${r.updated} updated`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['assets'] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const bulkDelete = useMutation({
    mutationFn: () => api('/assets/bulk/delete', { method: 'POST', body: JSON.stringify({ ids: Array.from(selected) }) }),
    onSuccess: (r: any) => { toast.success(`${r.deleted} deleted`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['assets'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: any = { ...form };
      // Remove client-only state
      delete body.imageFile;
      delete body._showExtra;
      // NOTE: locationId is deliberately absent — Location was removed from the UI, and
      // including it here would null out each asset's stored location on every save.
      ['categoryId', 'departmentId', 'statusDefId'].forEach((k) => { if (!body[k]) body[k] = null; });
      // Strip optional empty strings — class-validator @IsOptional only skips undefined/null,
      // so '' falls through to @IsISO8601 / @IsNumber and fails with a confusing 400.
      ['purchaseDate', 'warrantyEnd', 'serialNumber', 'model', 'notes', 'orderNumber', 'status'].forEach((k) => {
        if (body[k] === '' || body[k] === undefined) delete body[k];
      });
      ['purchaseCost'].forEach((k) => {
        if (body[k] === '' || body[k] == null) { delete body[k]; }
        else { body[k] = Number(body[k]); if (!Number.isFinite(body[k])) delete body[k]; }
      });
      const asset = await api('/assets', { method: 'POST', body: JSON.stringify(body) });

      // Upload image as a second step if one was selected
      let photoFailed = false;
      if (form.imageFile && asset?.id) {
        const s = getSession();
        const fd = new FormData();
        fd.append('file', form.imageFile);
        const up = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assets/${asset.id}/photo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s?.accessToken}` },
          body: fd,
        });
        photoFailed = !up.ok;
      }
      return { ...asset, _photoFailed: photoFailed };
    },
    onSuccess: (a: any) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setOpen(false);
      setForm(EMPTY_FORM);
      if (a?._photoFailed) toast.error(`Asset ${a.assetTag} created, but the image upload failed — you can add it from the asset page.`);
      else toast.success(`Asset ${a.assetTag} created`);
      router.push(`/dashboard/assets/${a.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateAsset = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const body: any = { ...form };
      delete body.imageFile;
      delete body._showExtra;
      // NOTE: locationId is deliberately absent — Location was removed from the UI, and
      // including it here would null out each asset's stored location on every save.
      ['categoryId', 'departmentId', 'statusDefId'].forEach((k) => { if (!body[k]) body[k] = null; });
      ['purchaseDate', 'warrantyEnd', 'serialNumber', 'model', 'notes', 'orderNumber', 'status'].forEach((k) => {
        if (body[k] === '' || body[k] === undefined) delete body[k];
      });
      ['purchaseCost'].forEach((k) => {
        if (body[k] === '' || body[k] == null) { delete body[k]; }
        else { body[k] = Number(body[k]); if (!Number.isFinite(body[k])) delete body[k]; }
      });
      const asset = await api(`/assets/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
      let photoFailed = false;
      if (form.imageFile && asset?.id) {
        const s = getSession();
        const fd = new FormData();
        fd.append('file', form.imageFile);
        const up = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assets/${asset.id}/photo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s?.accessToken}` },
          body: fd,
        });
        photoFailed = !up.ok;
      }
      return { ...asset, _photoFailed: photoFailed };
    },
    onSuccess: (a: any) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setEditId(null);
      if (a?._photoFailed) toast.error('Asset updated, but the image upload failed.');
      else toast.success('Asset updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAsset = useMutation({
    mutationFn: (id: string) => api(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset deleted'); },
    onError: (e: any) => toast.error(e.message),
  });

  const saveView = useMutation({
    mutationFn: (d: { name: string; isShared: boolean }) =>
      api('/saved-views', { method: 'POST', body: JSON.stringify({ kind: 'assets', name: d.name, isShared: d.isShared, filters: filter }) }),
    onSuccess: () => { toast.success('View saved'); qc.invalidateQueries({ queryKey: ['saved-views'] }); setSavedViewModal(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteView = useMutation({
    mutationFn: (id: string) => api(`/saved-views/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('View removed'); qc.invalidateQueries({ queryKey: ['saved-views'] }); if (activeViewId) setActiveViewId(''); },
  });

  const applyView = (v: any) => {
    setActiveViewId(v.id);
    setFilter({ ...EMPTY_FILTER, ...(v.filters || {}) });
  };

  const isManager = getSession()?.user?.role !== 'EMPLOYEE';

  // Employees can ask for equipment they don't hold, so the action column belongs on
  // the browse view only — requesting something already assigned to you makes no sense.
  const showRequestActions = !isManager && !filter.assignedToMe;

  // The caller's own open requests, used to decide Request vs Cancel per row. The list
  // endpoint is already scoped to the caller, so this shows only their own activity.
  const myRequests = useQuery({
    queryKey: ['my-asset-requests'],
    queryFn: () => api('/asset-requests'),
    enabled: showRequestActions,
    staleTime: 30_000,
  });

  /** assetId -> id of the caller's still-open request covering it. */
  const openRequestByAsset = useMemo(() => {
    const rows = Array.isArray(myRequests.data) ? myRequests.data : (myRequests.data?.items || []);
    const map: Record<string, string> = {};
    for (const r of rows) {
      // Only PENDING counts as cancellable — a decided request is history, and its
      // asset should be requestable again.
      if (r.status !== 'PENDING') continue;
      for (const it of r.items || []) if (it.assetId) map[it.assetId] = r.id;
    }
    return map;
  }, [myRequests.data]);

  const requestAsset = useMutation({
    mutationFn: (asset: any) => api('/asset-requests', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'SPECIFIC',
        title: asset.name,
        categoryId: asset.categoryId || undefined,
        assetIds: [asset.id],
        urgency: 'NORMAL',
      }),
    }),
    onSuccess: (_d, asset: any) => {
      toast.success(`Requested ${asset.assetTag || asset.name}`);
      qc.invalidateQueries({ queryKey: ['my-asset-requests'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelRequest = useMutation({
    mutationFn: (requestId: string) => api(`/asset-requests/${requestId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Request cancelled');
      qc.invalidateQueries({ queryKey: ['my-asset-requests'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title={!isManager && filter.assignedToMe ? 'My assets' : 'Assets'}
        subtitle={list.data?.total != null
          ? (!isManager && filter.assignedToMe
              ? `${list.data.total} assigned to you`
              : `${list.data.total} assets total`)
          : 'All hardware, peripherals and equipment'}
        action={isManager ? (
          <>
            <ImportCsvButton onDone={() => qc.invalidateQueries({ queryKey: ['assets'] })} />
            <ExportCsvButton />
            <Button icon={<Plus className="h-4 w-4" />} onClick={openNewModal}>New asset</Button>
          </>
        ) : undefined}
      />

      {/* Saved Views row */}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <Star className="h-4 w-4 text-ink-400" />
          <span className="text-xs font-medium text-ink-500">Saved views</span>
          <button
            onClick={() => { setActiveViewId(''); setFilter(EMPTY_FILTER); }}
            className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${!activeViewId ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'}`}
          >All assets</button>
          {(savedViews.data || []).map((v: any) => (
            <span key={v.id} className={`group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${activeViewId === v.id ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'}`}>
              <button onClick={() => applyView(v)} className="inline-flex items-center gap-1">
                {v.isShared && <Share2 className="h-3 w-3 opacity-70" />}
                {v.name}
              </button>
              <button
                title="Delete view"
                onClick={() => confirm(`Remove view "${v.name}"?`) && deleteView.mutate(v.id)}
                className="ml-1 hidden h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:text-rose-600 group-hover:inline-flex"
              ><X className="h-3 w-3" /></button>
            </span>
          ))}
          <Button variant="ghost" size="sm" icon={<BookmarkPlus className="h-3.5 w-3.5" />} onClick={() => setSavedViewModal(true)}>Save current</Button>
        </div>

        {/* Filter row */}
        <div className="grid grid-cols-1 gap-2 border-b border-ink-100 p-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-center">
          <div className="relative sm:col-span-2 md:flex-1 md:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className={inputClass + ' pl-9'}
              placeholder="Search by name, tag, or serial number"
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            />
          </div>
          <select className={selectClass + ' md:w-40'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            {(statusDefs.data || []).map((d: any) => <option key={d.id} value={d.mapsTo}>{d.label}</option>)}
          </select>
          <select className={selectClass + ' md:w-44'} value={filter.categoryId} onChange={(e) => setFilter({ ...filter, categoryId: e.target.value })}>
            <option value="">All categories</option>
            {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={selectClass + ' md:w-44'} value={filter.departmentId} onChange={(e) => setFilter({ ...filter, departmentId: e.target.value })}>
            <option value="">All departments</option>
            {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-600 sm:col-span-2">
            <input type="checkbox" checked={filter.onlyTopLevel} onChange={(e) => setFilter({ ...filter, onlyTopLevel: e.target.checked, parentId: '' })} />
            Top-level only
          </label>
        </div>

        {!list.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Plus className="h-4 w-4" />}
            title="No assets match"
            description="Try clearing the filters, or add your first asset."
            action={isManager ? <Button onClick={openNewModal} icon={<Plus className="h-4 w-4" />}>New asset</Button> : undefined}
          />
        ) : (
          <>
            {isManager && selected.size > 0 && (
              <div className="flex items-center justify-between border-b border-ink-100 bg-brand-50/40 px-3 py-2 text-sm">
                <span className="text-brand-800">{selected.size} selected</span>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="h-8 rounded-md border border-ink-200 bg-white px-2 text-xs"
                    onChange={(e) => { if (e.target.value) bulkUpdate.mutate({ status: e.target.value }); e.target.value = ''; }}
                    defaultValue=""
                  >
                    <option value="" disabled>Set status…</option>
                    {(statusDefs.data || []).map((d: any) => <option key={d.id} value={d.mapsTo}>{d.label}</option>)}
                  </select>
                  <Button variant="secondary" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => bulkUpdate.mutate({ status: 'ARCHIVED' })}>Archive</Button>
                  <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (confirm(`Delete ${selected.size} assets?`)) bulkDelete.mutate(); }}>Delete</Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              </div>
            )}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <THead>
                  {isManager && (
                  <TH className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={list.data.items.length > 0 && selected.size === list.data.items.length}
                      onChange={toggleAll}
                    />
                  </TH>
                  )}
                  <TH>Tag</TH>
                  <TH>Name</TH>
                  {/* Photo, cost and purchase date are stripped from the EMPLOYEE payload
                      by toEmployeeAssetView() — rendering them for employees produced
                      permanently-empty columns. */}
                  <TH className="w-12"></TH>
                  <TH>Serial No</TH>
                  <TH>Model</TH>
                  <TH>Category</TH>
                  <TH>Status</TH>
                  {/* Who holds an asset is manager information; employees browsing the
                      catalogue don't need a column of other people's names. */}
                  {isManager && <TH>Assigned To</TH>}
                  {isManager && <TH className="text-right">Cost</TH>}
                  {isManager && <TH>Purchased</TH>}
                  {isManager && <TH className="text-right pr-4">Actions</TH>}
                  {showRequestActions && <TH className="text-right pr-4">Action</TH>}
                </THead>
                <TBody>
                  {list.data.items.map((a: any) => {
                    const assignee = a.assignments?.[0]?.user;
                    const photoSrc = a.photoUrl ? `${process.env.NEXT_PUBLIC_API_URL}${a.photoUrl}` : null;
                    return (
                    <TR
                      key={a.id}
                      className={selected.has(a.id) ? 'bg-brand-50/40' : ''}
                      onClick={() => router.push(`/dashboard/assets/${a.id}`)}
                    >
                      {isManager && (
                      <TD onClick={(e: any) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.assetTag}`}
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                        />
                      </TD>
                      )}
                      <TD className="font-mono text-xs text-ink-500 whitespace-nowrap">{a.assetTag}</TD>
                      <TD className="font-medium text-ink-900 whitespace-nowrap">
                        {a.parent && <span className="mr-1 text-ink-400">↳</span>}
                        {a.name}
                      </TD>
                      <TD className="w-12" onClick={(e: any) => e.stopPropagation()}>
                        {photoSrc ? (
                          <img src={photoSrc} alt={a.name} className="h-8 w-8 rounded object-cover" />
                        ) : (
                          <div className="h-8 w-8 rounded bg-ink-100 flex items-center justify-center text-ink-400 text-[10px]">N/A</div>
                        )}
                      </TD>
                      <TD className="text-ink-600 text-xs whitespace-nowrap">{a.serialNumber || '—'}</TD>
                      <TD className="text-ink-600 text-xs">{a.model || '—'}</TD>
                      <TD className="text-ink-600">{a.category?.name || '—'}</TD>
                      <TD><AssetStatusPill s={a.status} def={a.statusDef} /></TD>
                      {isManager && (
                      <TD className="text-ink-600">
                        {assignee ? `${assignee.firstName} ${assignee.lastName}` : '—'}
                      </TD>
                      )}
                      {isManager && (
                      <TD className="text-right text-ink-600 whitespace-nowrap">
                        {a.purchaseCost != null ? `$${Number(a.purchaseCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                      </TD>
                      )}
                      {isManager && (
                      <TD className="text-ink-600 whitespace-nowrap text-xs">
                        {a.purchaseDate ? new Date(a.purchaseDate).toLocaleDateString() : '—'}
                      </TD>
                      )}
                      {isManager && (
                      <TD className="text-right pr-4" onClick={(e: any) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="Edit"
                            className="rounded p-1.5 text-ink-400 hover:bg-brand-50 hover:text-brand-600 transition"
                            onClick={() => openEditModal(a)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title="Delete"
                            className="rounded p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600 transition"
                            onClick={() => { if (confirm(`Delete "${a.name}"?`)) deleteAsset.mutate(a.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TD>
                      )}
                      {showRequestActions && (
                      <TD className="text-right pr-4" onClick={(e: any) => e.stopPropagation()}>
                        <RequestAction
                          assetId={a.id}
                          assetName={a.name}
                          openRequestId={openRequestByAsset[a.id]}
                          onRequest={() => requestAsset.mutate(a)}
                          onCancel={(id) => cancelRequest.mutate(id)}
                          busy={requestAsset.isPending || cancelRequest.isPending}
                        />
                      </TD>
                      )}
                    </TR>
                    );
                  })}
                </TBody>
              </table>
            </div>

            {/* Mobile card list */}
            <ul className="space-y-2 p-3 md:hidden">
              {list.data.items.map((a: any) => {
                const assignee = a.assignments?.[0]?.user;
                const photoSrc = a.photoUrl ? `${process.env.NEXT_PUBLIC_API_URL}${a.photoUrl}` : null;
                return (
                  <li key={a.id}>
                    <MobileCard
                      onClick={() => router.push(`/dashboard/assets/${a.id}`)}
                      className={selected.has(a.id) ? 'border-brand-300 bg-brand-50/40' : ''}
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isManager && (photoSrc ? (
                            <img src={photoSrc} alt={a.name} className="h-10 w-10 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="h-10 w-10 rounded bg-ink-100 flex items-center justify-center text-ink-400 text-[10px] flex-shrink-0">N/A</div>
                          ))}
                          <div className="min-w-0">
                            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">{a.assetTag}</div>
                            <div className="truncate font-medium text-ink-900">{a.name}</div>
                            {a.model && <div className="truncate text-[11px] text-ink-400">{a.model}</div>}
                          </div>
                        </div>
                        <AssetStatusPill s={a.status} def={a.statusDef} />
                      </div>
                      <MobileCardRow label="Serial No" value={a.serialNumber || '—'} />
                      <MobileCardRow label="Category" value={a.category?.name || '—'} />
                      <MobileCardRow label="Assigned" value={assignee ? `${assignee.firstName} ${assignee.lastName}` : '—'} />
                      {isManager && <MobileCardRow label="Cost" value={a.purchaseCost != null ? `$${Number(a.purchaseCost).toLocaleString()}` : '—'} />}
                      {isManager && <MobileCardRow label="Purchased" value={a.purchaseDate ? new Date(a.purchaseDate).toLocaleDateString() : '—'} />}
                      {isManager && (
                        <div className="mt-2 flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                          <button className="rounded p-1.5 text-ink-400 hover:bg-brand-50 hover:text-brand-600" onClick={() => openEditModal(a)}><Pencil className="h-4 w-4" /></button>
                          <button className="rounded p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" onClick={() => { if (confirm(`Delete "${a.name}"?`)) deleteAsset.mutate(a.id); }}><Trash2 className="h-4 w-4" /></button>
                        </div>
                      )}
                    </MobileCard>
                  </li>
                );
              })}
            </ul>

            {/* Pagination. The API has always supported page/pageSize; the UI never
                exposed it, so every list was capped at the first page. */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-3 py-2.5 text-sm">
                <span className="text-xs text-ink-500">
                  {rangeFrom}–{rangeTo} of {list.data.total}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <span className="px-2 text-xs text-ink-500">Page {page} of {totalPages}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New asset"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. MacBook Pro 14-inch" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset tag" hint="leave blank for auto"><input className={inputClass} value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value })} /></Field>
            <Field label="Serial number"><input className={inputClass} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
          </div>
          <Field label="Model" hint="e.g. MacBook Pro 14 (2023)"><input className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" hint="optional">
              <select className={selectClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">— None —</option>
                {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Department" hint="optional">
              <select className={selectClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">— None —</option>
                {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select className={selectClass} value={form.statusDefId} onChange={(e) => {
                const def = (statusDefs.data || []).find((d: any) => d.id === e.target.value);
                setForm({ ...form, statusDefId: e.target.value, status: def?.mapsTo || 'AVAILABLE' });
              }}>
                <option value="">— Default (Available) —</option>
                {(statusDefs.data || []).map((d: any) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes" hint="optional"><textarea className={textareaClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={form.requestable || false} onChange={(e) => setForm({ ...form, requestable: e.target.checked })}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
            <div>
              <span className="text-sm font-medium text-ink-800">Requestable</span>
              <p className="text-xs text-ink-500">Allow employees to request this asset</p>
            </div>
          </label>

          {/* Image upload */}
          <Field label="Image" hint="optional">
            <div className="relative">
              {form.imageFile ? (
                <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3">
                  <img src={imagePreview || ''} alt="Preview" className="h-14 w-14 rounded-md object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{form.imageFile.name}</p>
                    <p className="text-xs text-ink-500">{(form.imageFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button type="button" onClick={() => setForm({ ...form, imageFile: null })} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-200 bg-ink-50/50 py-5 transition hover:border-brand-300 hover:bg-brand-50/30">
                  <Upload className="mb-1.5 h-5 w-5 text-ink-400" />
                  <span className="text-sm font-medium text-ink-600">Click to upload an image</span>
                  <span className="text-xs text-ink-400">PNG, JPG up to 5MB</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setForm({ ...form, imageFile: file });
                  }} />
                </label>
              )}
            </div>
          </Field>

          {/* Collapsible additional details */}
          <div className="rounded-xl border border-ink-100">
            <button
              type="button"
              onClick={() => setForm({ ...form, _showExtra: !form._showExtra })}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink-700 hover:bg-ink-50/50 transition rounded-xl"
            >
              <span>Additional Details <span className="font-normal text-ink-400">(optional)</span></span>
              <svg className={`h-4 w-4 text-ink-400 transition-transform ${form._showExtra ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {form._showExtra && (
              <div className="border-t border-ink-100 px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Warranty end"><input className={inputClass} type="date" value={form.warrantyEnd} onChange={(e) => setForm({ ...form, warrantyEnd: e.target.value })} /></Field>
                  <Field label="Order number"><input className={inputClass} value={form.orderNumber} onChange={(e) => setForm({ ...form, orderNumber: e.target.value })} placeholder="e.g. PO-2026-001" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Purchase date"><input className={inputClass} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></Field>
                  <Field label="Purchase cost"><input className={inputClass} type="number" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} /></Field>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Edit asset modal */}
      <Modal
        open={!!editId}
        onClose={() => setEditId(null)}
        title="Update asset"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
            <Button onClick={() => updateAsset.mutate()} loading={updateAsset.isPending}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. MacBook Pro 14-inch" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset tag"><input className={inputClass} value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value })} /></Field>
            <Field label="Serial number"><input className={inputClass} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
          </div>
          <Field label="Model"><input className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className={selectClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">— None —</option>
                {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select className={selectClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">— None —</option>
                {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select className={selectClass} value={form.statusDefId} onChange={(e) => {
                const def = (statusDefs.data || []).find((d: any) => d.id === e.target.value);
                setForm({ ...form, statusDefId: e.target.value, status: def?.mapsTo || 'AVAILABLE' });
              }}>
                <option value="">— Default (Available) —</option>
                {(statusDefs.data || []).map((d: any) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes" hint="optional"><textarea className={textareaClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={form.requestable || false} onChange={(e) => setForm({ ...form, requestable: e.target.checked })}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
            <div>
              <span className="text-sm font-medium text-ink-800">Requestable</span>
              <p className="text-xs text-ink-500">Allow employees to request this asset</p>
            </div>
          </label>

          {/* Image upload */}
          <Field label="Image" hint="optional">
            <div className="relative">
              {form.imageFile ? (
                <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3">
                  <img src={imagePreview || ''} alt="Preview" className="h-14 w-14 rounded-md object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{form.imageFile.name}</p>
                    <p className="text-xs text-ink-500">{(form.imageFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button type="button" onClick={() => setForm({ ...form, imageFile: null })} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-200 bg-ink-50/50 py-5 transition hover:border-brand-300 hover:bg-brand-50/30">
                  <Upload className="mb-1.5 h-5 w-5 text-ink-400" />
                  <span className="text-sm font-medium text-ink-600">Click to upload an image</span>
                  <span className="text-xs text-ink-400">PNG, JPG up to 5MB</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setForm({ ...form, imageFile: file });
                  }} />
                </label>
              )}
            </div>
          </Field>

          {/* Collapsible additional details */}
          <div className="rounded-xl border border-ink-100">
            <button
              type="button"
              onClick={() => setForm({ ...form, _showExtra: !form._showExtra })}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink-700 hover:bg-ink-50/50 transition rounded-xl"
            >
              <span>Additional Details <span className="font-normal text-ink-400">(optional)</span></span>
              <svg className={`h-4 w-4 text-ink-400 transition-transform ${form._showExtra ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {form._showExtra && (
              <div className="border-t border-ink-100 px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Warranty end"><input className={inputClass} type="date" value={form.warrantyEnd} onChange={(e) => setForm({ ...form, warrantyEnd: e.target.value })} /></Field>
                  <Field label="Order number"><input className={inputClass} value={form.orderNumber} onChange={(e) => setForm({ ...form, orderNumber: e.target.value })} placeholder="e.g. PO-2026-001" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Purchase date"><input className={inputClass} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></Field>
                  <Field label="Purchase cost"><input className={inputClass} type="number" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} /></Field>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <SaveViewModal open={savedViewModal} onClose={() => setSavedViewModal(false)} onSave={(name, isShared) => saveView.mutate({ name, isShared })} />
    </div>
  );
}

function SaveViewModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (name: string, isShared: boolean) => void }) {
  const [name, setName] = useState('');
  const [isShared, setIsShared] = useState(false);
  useEffect(() => { if (open) { setName(''); setIsShared(false); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Save current view" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim()} onClick={() => onSave(name.trim(), isShared)}>Save view</Button>
      </>}>
      <div className="space-y-3">
        <Field label="View name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Laptops in IT" /></Field>
        <label className="inline-flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
          Share with everyone in this workspace
        </label>
      </div>
    </Modal>
  );
}

function ImportCsvButton({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref} type="file" accept=".csv" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          const s = getSession();
          const fd = new FormData();
          fd.append('file', f);
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assets/import`, {
            method: 'POST', headers: { Authorization: `Bearer ${s?.accessToken}` }, body: fd,
          });
          const r = await res.json();
          setBusy(false);
          if (e.target) e.target.value = '';
          if (r.ok) {
            toast.success(`Imported ${r.created} assets`, { description: r.errors?.length ? `${r.errors.length} rows had errors` : undefined });
          } else {
            toast.error('Import failed', { description: r.error || 'Unknown error' });
          }
          onDone();
        }}
      />
      <Button variant="secondary" icon={<Upload className="h-4 w-4" />} loading={busy} onClick={() => ref.current?.click()}>
        Import CSV
      </Button>
    </>
  );
}

function ExportCsvButton() {
  return (
    <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={async () => {
      const s = getSession();
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assets/export.csv`, {
        headers: { Authorization: `Bearer ${s?.accessToken}` },
      });
      const b = await r.blob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = 'assets.csv'; a.click();
      URL.revokeObjectURL(url);
    }}>Export CSV</Button>
  );
}


/**
 * Request / Cancel for a single asset, shown to employees on the browse view.
 *
 * The flow deliberately has one control at a time: if the caller has no open request
 * covering this asset they can Request it; once they do, that button becomes Cancel
 * for the request they just made. A request that has been decided (approved, declined,
 * fulfilled or already cancelled) is history, so the asset becomes requestable again
 * rather than leaving a Cancel button that would fail.
 */
function RequestAction({
  assetId, assetName, openRequestId, onRequest, onCancel, busy,
}: {
  assetId: string;
  assetName: string;
  openRequestId?: string;
  onRequest: () => void;
  onCancel: (requestId: string) => void;
  busy: boolean;
}) {
  if (openRequestId) {
    return (
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        title={`Cancel your pending request for ${assetName}`}
        onClick={() => { if (confirm(`Cancel your request for "${assetName}"?`)) onCancel(openRequestId); }}
      >
        Cancel
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      disabled={busy}
      title={`Request ${assetName}`}
      onClick={onRequest}
    >
      Request
    </Button>
  );
}

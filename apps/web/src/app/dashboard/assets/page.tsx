'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Download, Upload, Search, Trash2, Archive, BookmarkPlus, Share2, Star, X } from 'lucide-react';
import { api, getSession } from '@/lib/api';
import { Modal } from '@/components/Modal';
import {
  Button, Field, inputClass, selectClass, textareaClass,
  AssetStatusPill, SectionHeader, Card, THead, TH, TBody, TR, TD, EmptyState, Skeleton,
  MobileCard, MobileCardRow,
} from '@/components/ui';

type Filter = { q: string; status: string; categoryId: string; locationId: string; departmentId: string; parentId: string; onlyTopLevel: boolean };
const EMPTY_FILTER: Filter = { q: '', status: '', categoryId: '', locationId: '', departmentId: '', parentId: '', onlyTopLevel: false };

export default function AssetsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => ({
    ...EMPTY_FILTER,
    q: searchParams?.get('q') || '',
    status: searchParams?.get('status') || '',
    categoryId: searchParams?.get('categoryId') || '',
    locationId: searchParams?.get('locationId') || '',
    departmentId: searchParams?.get('departmentId') || '',
    parentId: searchParams?.get('parentId') || '',
    onlyTopLevel: searchParams?.get('onlyTopLevel') === '1',
  }));
  const [activeViewId, setActiveViewId] = useState<string>('');

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api('/locations') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });
  const statusDefs = useQuery({ queryKey: ['status-defs'], queryFn: () => api('/asset-status-defs') });
  const savedViews = useQuery({ queryKey: ['saved-views', 'assets'], queryFn: () => api('/saved-views?kind=assets') });

  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.status) params.set('status', filter.status);
  if (filter.categoryId) params.set('categoryId', filter.categoryId);
  if (filter.locationId) params.set('locationId', filter.locationId);
  if (filter.departmentId) params.set('departmentId', filter.departmentId);
  if (filter.parentId) params.set('parentId', filter.parentId);
  if (filter.onlyTopLevel) params.set('onlyTopLevel', '1');
  const list = useQuery({
    queryKey: ['assets', filter],
    queryFn: () => api(`/assets?${params.toString()}`),
  });

  const [open, setOpen] = useState(false);
  const [savedViewModal, setSavedViewModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const ids = list.data?.items?.map((a: any) => a.id) || [];
    setSelected((s) => s.size === ids.length ? new Set() : new Set(ids));
  };
  const [form, setForm] = useState<any>({
    name: '', assetTag: '', serialNumber: '', categoryId: '', locationId: '', departmentId: '', vendorId: '',
    purchaseDate: '', purchaseCost: '', warrantyEnd: '', notes: '', customFields: {}, parentId: '',
  });
  const selectedCat = categories.data?.find((c: any) => c.id === form.categoryId);
  const parentCandidates = useQuery({
    queryKey: ['assets-parents'],
    queryFn: () => api('/assets?pageSize=200&onlyTopLevel=1'),
  });

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
    mutationFn: () => {
      const body: any = { ...form };
      ['locationId', 'departmentId', 'vendorId', 'parentId'].forEach((k) => { if (!body[k]) body[k] = null; });
      // Strip optional empty strings — class-validator @IsOptional only skips undefined/null,
      // so '' falls through to @IsISO8601 / @IsNumber and fails with a confusing 400.
      ['purchaseDate', 'warrantyEnd', 'depreciationStart', 'serialNumber', 'notes'].forEach((k) => {
        if (body[k] === '' || body[k] === undefined) delete body[k];
      });
      ['purchaseCost', 'salvageValue', 'usefulLifeMonths'].forEach((k) => {
        if (body[k] === '' || body[k] == null) { delete body[k]; }
        else { body[k] = Number(body[k]); if (!Number.isFinite(body[k])) delete body[k]; }
      });
      return api('/assets', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: (a: any) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setOpen(false);
      toast.success(`Asset ${a.assetTag} created`);
      router.push(`/dashboard/assets/${a.id}`);
    },
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

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Assets"
        subtitle={list.data?.total != null ? `${list.data.total} assets total` : 'All hardware, peripherals and equipment'}
        action={
          <>
            <ImportCsvButton onDone={() => qc.invalidateQueries({ queryKey: ['assets'] })} />
            <ExportCsvButton />
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New asset</Button>
          </>
        }
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
          <select className={selectClass + ' md:w-44'} value={filter.locationId} onChange={(e) => setFilter({ ...filter, locationId: e.target.value })}>
            <option value="">All locations</option>
            {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
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
            action={<Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" />}>New asset</Button>}
          />
        ) : (
          <>
            {selected.size > 0 && (
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
                  <select
                    className="h-8 rounded-md border border-ink-200 bg-white px-2 text-xs"
                    onChange={(e) => { if (e.target.value) bulkUpdate.mutate({ locationId: e.target.value === '__none' ? null : e.target.value }); e.target.value = ''; }}
                    defaultValue=""
                  >
                    <option value="" disabled>Set location…</option>
                    <option value="__none">— None —</option>
                    {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <Button variant="secondary" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => bulkUpdate.mutate({ status: 'RETIRED' })}>Retire</Button>
                  <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (confirm(`Delete ${selected.size} assets?`)) bulkDelete.mutate(); }}>Delete</Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              </div>
            )}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <THead>
                  <TH className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={list.data.items.length > 0 && selected.size === list.data.items.length}
                      onChange={toggleAll}
                    />
                  </TH>
                  <TH>Tag</TH>
                  <TH>Name</TH>
                  <TH>Category</TH>
                  <TH>Status</TH>
                  <TH>Assigned to</TH>
                  <TH>Location</TH>
                  <TH className="text-right pr-4">Sub</TH>
                </THead>
                <TBody>
                  {list.data.items.map((a: any) => (
                    <TR
                      key={a.id}
                      className={selected.has(a.id) ? 'bg-brand-50/40' : ''}
                      onClick={() => router.push(`/dashboard/assets/${a.id}`)}
                    >
                      <TD onClick={(e: any) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.assetTag}`}
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                        />
                      </TD>
                      <TD className="font-mono text-xs text-ink-500">{a.assetTag}</TD>
                      <TD className="font-medium text-ink-900">
                        {a.parent && <span className="mr-1 text-ink-400">↳</span>}
                        {a.name}
                      </TD>
                      <TD className="text-ink-600">{a.category?.name}</TD>
                      <TD><AssetStatusPill s={a.status} def={a.statusDef} /></TD>
                      <TD className="text-ink-600">
                        {a.assignments?.[0]?.user ? `${a.assignments[0].user.firstName} ${a.assignments[0].user.lastName}` : '—'}
                      </TD>
                      <TD className="text-ink-600">{a.location?.name || '—'}</TD>
                      <TD className="text-right pr-4 text-xs text-ink-500">
                        {a._count?.children ? `${a._count.children} child${a._count.children === 1 ? '' : 'ren'}` : ''}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </table>
            </div>

            {/* Mobile card list */}
            <ul className="space-y-2 p-3 md:hidden">
              {list.data.items.map((a: any) => {
                const assignee = a.assignments?.[0]?.user;
                return (
                  <li key={a.id}>
                    <MobileCard
                      onClick={() => router.push(`/dashboard/assets/${a.id}`)}
                      className={selected.has(a.id) ? 'border-brand-300 bg-brand-50/40' : ''}
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">{a.assetTag}</div>
                          <div className="truncate font-medium text-ink-900">
                            {a.parent && <span className="mr-1 text-ink-400">↳</span>}
                            {a.name}
                          </div>
                        </div>
                        <AssetStatusPill s={a.status} def={a.statusDef} />
                      </div>
                      <MobileCardRow label="Category" value={a.category?.name || '—'} />
                      <MobileCardRow label="Assigned" value={assignee ? `${assignee.firstName} ${assignee.lastName}` : '—'} />
                      <MobileCardRow label="Location" value={a.location?.name || '—'} />
                      {a._count?.children ? (
                        <MobileCardRow label="Sub-assets" value={`${a._count.children}`} />
                      ) : null}
                    </MobileCard>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New asset"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Asset tag" hint="leave blank for auto"><input className={inputClass} value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value })} /></Field>
            <Field label="Serial number"><input className={inputClass} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
          </div>
          <Field label="Category">
            <select className={selectClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value, customFields: {} })}>
              <option value="">— Select —</option>
              {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Parent asset" hint="optional — accessories or components roll up under their parent">
            <select className={selectClass} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— None (top-level asset) —</option>
              {parentCandidates.data?.items?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.assetTag} — {p.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Location">
              <select className={selectClass} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">— None —</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select className={selectClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">— None —</option>
                {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Vendor">
              <select className={selectClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">— None —</option>
                {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Purchase date"><input className={inputClass} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></Field>
            <Field label="Cost"><input className={inputClass} type="number" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} /></Field>
          </div>
          <Field label="Warranty end"><input className={inputClass} type="date" value={form.warrantyEnd} onChange={(e) => setForm({ ...form, warrantyEnd: e.target.value })} /></Field>
          <Field label="Notes"><textarea className={textareaClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>

          {selectedCat?.customFields?.length > 0 && (
            <div className="rounded-xl bg-ink-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Custom fields</div>
              <div className="space-y-2">
                {selectedCat.customFields.map((f: any) => (
                  <Field key={f.name} label={f.name + (f.required ? ' *' : '')}>
                    <CustomInput
                      f={f}
                      value={form.customFields[f.name]}
                      onChange={(v) => setForm({ ...form, customFields: { ...form.customFields, [f.name]: v } })}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
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

function CustomInput({ f, value, onChange }: { f: any; value: any; onChange: (v: any) => void }) {
  if (f.type === 'boolean') return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  if (f.type === 'number') return <input className={inputClass} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
  if (f.type === 'date') return <input className={inputClass} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  return <input className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

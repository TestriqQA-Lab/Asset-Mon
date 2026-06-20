'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Paperclip, Trash2, Upload, FileText, ImageIcon, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, getSession } from '@/lib/api';
import { btnDanger, btnPrimary, btnSecondary, inputClass } from '@/components/Field';

export default function AssetDetailPage() {
  const params = useParams() as { id: string };
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id;
  const asset = useQuery({ queryKey: ['asset', id], queryFn: () => api(`/assets/${id}`) });
  const photoUrl = useQuery({
    queryKey: ['asset-photo-url', id],
    queryFn: () => api(`/assets/${id}/photo-url`),
    enabled: !!asset.data?.photoUrl,
    refetchInterval: 50 * 60 * 1000,
  });
  const audit = useQuery({ queryKey: ['asset-audit', id], queryFn: () => api(`/assets/${id}/audit`) });
  const tickets = useQuery({ queryKey: ['asset-tickets', id], queryFn: () => api(`/tickets?assetId=${id}`) });
  const schedules = useQuery({ queryKey: ['asset-maint', id], queryFn: () => api(`/maintenance?assetId=${id}`) });
  const depreciation = useQuery({ queryKey: ['asset-dep', id], queryFn: () => api(`/depreciation/${id}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api('/locations') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });
  const statusDefs = useQuery({ queryKey: ['status-defs'], queryFn: () => api('/asset-status-defs') });
  const parentCandidates = useQuery({
    queryKey: ['assets-parents-detail', id],
    queryFn: () => api('/assets?pageSize=200&onlyTopLevel=1'),
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const update = useMutation({
    mutationFn: (patch: any) => api(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset', id] }); setEditing(false); },
  });

  const del = useMutation({
    mutationFn: () => api(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/dashboard/assets'),
  });

  const checkout = useMutation({
    mutationFn: (userId: string) => api(`/assets/${id}/checkout`, { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset', id] }),
  });
  const checkin = useMutation({
    mutationFn: () => api(`/assets/${id}/checkin`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset', id] }),
  });

  const [checkoutUser, setCheckoutUser] = useState('');

  if (asset.isLoading) return <p>Loading…</p>;
  if (!asset.data) return <p>Not found.</p>;

  const a = asset.data;
  const open = (a.assignments || []).find((x: any) => !x.returnedAt);

  const startEdit = () => {
    setEditing(true);
    setDraft({
      name: a.name, assetTag: a.assetTag, serialNumber: a.serialNumber || '',
      status: a.status, notes: a.notes || '',
      categoryId: a.categoryId, locationId: a.locationId || '', departmentId: a.departmentId || '', vendorId: a.vendorId || '',
      parentId: a.parentId || '',
      purchaseDate: a.purchaseDate ? a.purchaseDate.slice(0, 10) : '',
      purchaseCost: a.purchaseCost || '',
      warrantyEnd: a.warrantyEnd ? a.warrantyEnd.slice(0, 10) : '',
      depreciationMethod: a.depreciationMethod || 'NONE',
      salvageValue: a.salvageValue || '',
      usefulLifeMonths: a.usefulLifeMonths || '',
      depreciationStart: a.depreciationStart ? a.depreciationStart.slice(0, 10) : '',
      customFields: a.customFields || {},
    });
  };

  const saveEdit = () => {
    const body = { ...draft };
    ['locationId', 'departmentId', 'vendorId', 'parentId'].forEach((k) => { if (!body[k]) body[k] = null; });
    if (body.purchaseCost === '') body.purchaseCost = null;
    else if (body.purchaseCost) body.purchaseCost = Number(body.purchaseCost);
    if (body.salvageValue === '') body.salvageValue = null;
    else if (body.salvageValue) body.salvageValue = Number(body.salvageValue);
    if (body.usefulLifeMonths === '') body.usefulLifeMonths = null;
    else if (body.usefulLifeMonths) body.usefulLifeMonths = Number(body.usefulLifeMonths);
    if (body.depreciationStart === '') body.depreciationStart = null;
    update.mutate(body);
  };

  const uploadPhoto = async (file: File) => {
    const session = getSession();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assets/${id}/photo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.accessToken}` },
      body: fd,
    });
    if (!res.ok) {
      let msg = 'Upload failed';
      try { const j = await res.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message; } catch {}
      toast.error(msg);
      return;
    }
    toast.success('Photo updated');
    qc.invalidateQueries({ queryKey: ['asset', id] });
    qc.invalidateQueries({ queryKey: ['asset-photo-url', id] });
  };

  const selectedCat = (categories.data || []).find((c: any) => c.id === (editing ? draft?.categoryId : a.categoryId));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-xs text-gray-500">{a.assetTag}</div>
          <h1 className="truncate text-xl font-semibold sm:text-2xl">{a.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing && <button className={btnSecondary} onClick={startEdit}>Edit</button>}
          {editing && <button className={btnSecondary} onClick={() => setEditing(false)}>Cancel</button>}
          {editing && <button className={btnPrimary} onClick={saveEdit}>Save</button>}
          <a className={btnSecondary} href={`/dashboard/assets/${id}/label`} target="_blank" rel="noreferrer">QR / Label</a>
          <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate()}>Delete</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 rounded-lg border bg-white p-4 sm:p-5 lg:col-span-2">
          <Row label="Status">
            {!editing ? <StatusBadge s={a.status} def={a.statusDef} /> :
              <select className={inputClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {(statusDefs.data || []).map((d: any) => <option key={d.id} value={d.mapsTo}>{d.label}</option>)}
              </select>}
          </Row>
          <Row label="Parent asset">
            {!editing ? (
              a.parent ? (
                <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={`/dashboard/assets/${a.parent.id}`}>
                  <Link2 className="h-3.5 w-3.5" />
                  <span className="font-mono text-xs text-ink-500">{a.parent.assetTag}</span>
                  <span>{a.parent.name}</span>
                </a>
              ) : '—'
            ) : (
              <select className={inputClass} value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                <option value="">— None (top-level) —</option>
                {parentCandidates.data?.items?.filter((p: any) => p.id !== id).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.assetTag} — {p.name}</option>
                ))}
              </select>
            )}
          </Row>
          <Row label="Category">
            {!editing ? (a.category?.name || '—') :
              <select className={inputClass} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>}
          </Row>
          <Row label="Serial #">
            {!editing ? (a.serialNumber || '—') :
              <input className={inputClass} value={draft.serialNumber} onChange={(e) => setDraft({ ...draft, serialNumber: e.target.value })} />}
          </Row>
          <Row label="Location">
            {!editing ? (a.location?.name || '—') :
              <select className={inputClass} value={draft.locationId} onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}>
                <option value="">— None —</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>}
          </Row>
          <Row label="Department">
            {!editing ? (a.department?.name || '—') :
              <select className={inputClass} value={draft.departmentId} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}>
                <option value="">— None —</option>
                {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>}
          </Row>
          <Row label="Vendor">
            {!editing ? (a.vendor?.name || '—') :
              <select className={inputClass} value={draft.vendorId} onChange={(e) => setDraft({ ...draft, vendorId: e.target.value })}>
                <option value="">— None —</option>
                {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>}
          </Row>
          <Row label="Purchase date">
            {!editing ? (a.purchaseDate?.slice(0, 10) || '—') :
              <input className={inputClass} type="date" value={draft.purchaseDate} onChange={(e) => setDraft({ ...draft, purchaseDate: e.target.value })} />}
          </Row>
          <Row label="Cost">
            {!editing ? (a.purchaseCost ?? '—') :
              <input className={inputClass} type="number" step="0.01" value={draft.purchaseCost} onChange={(e) => setDraft({ ...draft, purchaseCost: e.target.value })} />}
          </Row>
          <Row label="Warranty end">
            {!editing ? (a.warrantyEnd?.slice(0, 10) || '—') :
              <input className={inputClass} type="date" value={draft.warrantyEnd} onChange={(e) => setDraft({ ...draft, warrantyEnd: e.target.value })} />}
          </Row>
          <Row label="Notes">
            {!editing ? (a.notes || '—') :
              <textarea className={inputClass} rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />}
          </Row>

          {editing && (
            <div className="border-t pt-3">
              <div className="mb-2 text-sm font-medium">Depreciation</div>
              <Row label="Method">
                <select className={inputClass} value={draft.depreciationMethod} onChange={(e) => setDraft({ ...draft, depreciationMethod: e.target.value })}>
                  <option value="NONE">NONE</option>
                  <option value="STRAIGHT_LINE">STRAIGHT_LINE</option>
                  <option value="DECLINING_BALANCE">DECLINING_BALANCE</option>
                </select>
              </Row>
              <Row label="Salvage value">
                <input className={inputClass} type="number" step="0.01" value={draft.salvageValue} onChange={(e) => setDraft({ ...draft, salvageValue: e.target.value })} />
              </Row>
              <Row label="Useful life (months)">
                <input className={inputClass} type="number" min={1} value={draft.usefulLifeMonths} onChange={(e) => setDraft({ ...draft, usefulLifeMonths: e.target.value })} />
              </Row>
              <Row label="Depreciation start">
                <input className={inputClass} type="date" value={draft.depreciationStart} onChange={(e) => setDraft({ ...draft, depreciationStart: e.target.value })} />
              </Row>
            </div>
          )}

          {selectedCat?.customFields?.length > 0 && (
            <div className="border-t pt-4">
              <div className="mb-2 text-sm font-medium">Custom fields</div>
              <div className="space-y-2">
                {selectedCat.customFields.map((f: any) => (
                  <Row key={f.name} label={f.name}>
                    {!editing ? String((a.customFields || {})[f.name] ?? '—') :
                      <input
                        className={inputClass}
                        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                        value={draft.customFields?.[f.name] ?? ''}
                        onChange={(e) =>
                          setDraft({ ...draft, customFields: { ...draft.customFields, [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value } })
                        }
                      />}
                  </Row>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 text-sm font-medium">Photo</div>
            {a.photoUrl && photoUrl.data?.url ? (
              <img src={`${process.env.NEXT_PUBLIC_API_URL}${photoUrl.data.url}`} alt={`Photo of ${a.assetTag}`} className="mb-3 max-h-48 rounded" />
            ) : a.photoUrl ? (
              <div className="mb-3 h-32 animate-pulse rounded bg-gray-100" />
            ) : <div className="mb-3 text-sm text-gray-500">No photo.</div>}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 text-sm font-medium">Assignment</div>
            {open ? (
              <>
                <p className="text-sm">Checked out to <b>{open.user.firstName} {open.user.lastName}</b></p>
                <p className="text-xs text-gray-500">since {new Date(open.checkedOutAt).toLocaleString()}</p>
                <button className={btnSecondary + ' mt-3'} onClick={() => checkin.mutate()}>Check in (return)</button>
              </>
            ) : (
              <>
                <select className={inputClass} value={checkoutUser} onChange={(e) => setCheckoutUser(e.target.value)}>
                  <option value="">— Select user —</option>
                  {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>)}
                </select>
                <button className={btnPrimary + ' mt-3'} disabled={!checkoutUser} onClick={() => checkout.mutate(checkoutUser)}>Check out</button>
              </>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Service tickets</span>
              <a className="text-xs text-brand-600 hover:underline" href="/dashboard/tickets">Open all</a>
            </div>
            <ul className="space-y-1 text-sm">
              {tickets.data?.slice(0, 5).map((t: any) => (
                <li key={t.id}>
                  <a className="text-brand-600 hover:underline" href={`/dashboard/tickets/${t.id}`}>{t.ticketNumber}</a>
                  <span className="ml-2">{t.title}</span>
                  <span className="ml-2 text-xs text-gray-500">{t.status}</span>
                </li>
              ))}
              {tickets.data?.length === 0 && <li className="text-gray-500">No tickets.</li>}
            </ul>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 text-sm font-medium">Depreciation</div>
            {depreciation.data?.method === 'NONE' || !depreciation.data?.usefulLifeMonths ? (
              <p className="text-xs text-gray-500">No depreciation configured. Edit the asset to set method, salvage, life.</p>
            ) : (
              <div className="text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Method</span><span>{depreciation.data.method}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Cost</span><span>{Number(depreciation.data.cost).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Depreciated</span><span className="text-red-600">−{Number(depreciation.data.accumulated).toFixed(2)}</span></div>
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Book value</span><span>{Number(depreciation.data.bookValue).toFixed(2)}</span></div>
                <div className="mt-1 text-xs text-gray-500">{depreciation.data.monthsElapsed} / {depreciation.data.usefulLifeMonths} months elapsed</div>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 text-sm font-medium">Maintenance</div>
            <ul className="space-y-1 text-sm">
              {schedules.data?.map((m: any) => (
                <li key={m.id}>
                  <span className="font-medium">{m.title}</span>
                  <span className="ml-2 text-xs text-gray-500">every {m.intervalDays}d · next {new Date(m.nextDueAt).toLocaleDateString()}</span>
                </li>
              ))}
              {schedules.data?.length === 0 && <li className="text-gray-500">No schedules.</li>}
            </ul>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 text-sm font-medium">Audit log</div>
            <ul className="space-y-1 text-xs">
              {audit.data?.slice(0, 10).map((e: any) => (
                <li key={e.id} className="text-gray-600">
                  <span className="font-mono text-[10px] text-gray-400">{new Date(e.createdAt).toLocaleString()}</span> · {e.action}
                  {e.performedBy && <> · <span className="text-gray-500">{e.performedBy.firstName}</span></>}
                </li>
              ))}
              {audit.data?.length === 0 && <li className="text-gray-500">No events.</li>}
            </ul>
          </div>

          <ChildrenPanel asset={a} />
          <AttachmentsPanel assetId={id} />

          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 text-sm font-medium">History</div>
            <ul className="space-y-2 text-sm">
              {(a.assignments || []).map((x: any) => (
                <li key={x.id} className="border-b pb-1 last:border-0">
                  {x.user.firstName} {x.user.lastName} · {new Date(x.checkedOutAt).toLocaleDateString()}
                  {x.returnedAt ? ` → ${new Date(x.returnedAt).toLocaleDateString()}` : ' · open'}
                </li>
              ))}
              {(a.assignments || []).length === 0 && <li className="text-gray-500">No assignments yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-3">
      <div className="text-xs uppercase tracking-wider text-gray-500 sm:text-sm sm:normal-case sm:tracking-normal">{label}</div>
      <div className="text-sm sm:col-span-2">{children}</div>
    </div>
  );
}

import { AssetStatusPill as StatusBadgeImpl } from '@/components/ui';
function StatusBadge({ s, def }: { s: string; def?: any }) { return <StatusBadgeImpl s={s} def={def} />; }

function ChildrenPanel({ asset }: { asset: any }) {
  const kids = asset.children || [];
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between text-sm font-medium">
        <span>Accessories / components ({kids.length})</span>
      </div>
      {kids.length === 0 ? (
        <p className="text-xs text-gray-500">No child assets attached. Edit any asset and set this one as its parent to attach it here.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {kids.map((c: any) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <a href={`/dashboard/assets/${c.id}`} className="flex-1 truncate hover:underline">
                <span className="font-mono text-xs text-ink-500">{c.assetTag}</span>
                <span className="ml-2">{c.name}</span>
              </a>
              <span className="text-xs text-ink-500">{c.category?.name}</span>
              <StatusBadgeImpl s={c.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentsPanel({ assetId }: { assetId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['asset-attachments', assetId], queryFn: () => api(`/assets/${assetId}/attachments`) });
  const [busy, setBusy] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => api(`/asset-attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset-attachments', assetId] }); toast.success('Attachment removed'); },
  });

  const upload = async (file: File) => {
    setBusy(true);
    const s = getSession();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assets/${assetId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s?.accessToken}` },
      body: fd,
    });
    setBusy(false);
    if (!res.ok) {
      const t = await res.json().catch(() => ({}));
      toast.error('Upload failed', { description: t.message || `HTTP ${res.status}` });
      return;
    }
    qc.invalidateQueries({ queryKey: ['asset-attachments', assetId] });
    toast.success('Attachment uploaded');
  };

  const download = async (url: string, filename: string) => {
    const s = getSession();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
      headers: { Authorization: `Bearer ${s?.accessToken}` },
    });
    if (!res.ok) { toast.error('Download failed'); return; }
    const b = await res.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = filename; a.click();
    URL.revokeObjectURL(u);
  };

  const icon = (k: string) => k === 'photo' ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between text-sm font-medium">
        <span className="inline-flex items-center gap-1.5"><Paperclip className="h-4 w-4" /> Attachments ({list.data?.length || 0})</span>
        <label className={btnSecondary + ' cursor-pointer'}>
          <Upload className="h-3.5 w-3.5" />
          <span className="ml-1">Upload</span>
          <input
            type="file"
            className="hidden"
            disabled={busy}
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { upload(f); e.currentTarget.value = ''; } }}
          />
        </label>
      </div>
      {(list.data || []).length === 0 ? (
        <p className="text-xs text-gray-500">No files attached. Up to 10 MB each. Photos, PDFs, and Office docs supported.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {list.data.map((att: any) => (
            <li key={att.id} className="flex items-center gap-2 rounded-md border border-ink-100 px-2 py-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-ink-50 text-ink-500">{icon(att.kind)}</span>
              <button onClick={() => download(att.url, att.filename)} className="flex-1 truncate text-left hover:underline">
                {att.filename}
              </button>
              <span className="text-[10px] text-ink-400">{prettySize(att.size)}</span>
              <button onClick={() => confirm('Remove this attachment?') && del.mutate(att.id)} className="text-ink-400 hover:text-rose-600" title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function prettySize(n: number) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

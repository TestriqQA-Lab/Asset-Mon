'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';
import { MobileCard, MobileCardRow } from '@/components/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const LICENSE_TYPES = ['SUBSCRIPTION', 'PERPETUAL', 'TRIAL', 'OPEN_SOURCE'];

type FormState = {
  softwareId: string;
  type: string;
  seats: string;
  licenseKey: string;
  purchaseDate: string;
  expiresAt: string;
  cost: string;
  vendorId: string;
  notes: string;
  newSoftwareName: string;
  newSoftwarePublisher: string;
};

const emptyForm = (): FormState => ({
  softwareId: '',
  type: 'SUBSCRIPTION',
  seats: '1',
  licenseKey: '',
  purchaseDate: '',
  expiresAt: '',
  cost: '',
  vendorId: '',
  notes: '',
  newSoftwareName: '',
  newSoftwarePublisher: '',
});

export default function LicensesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState({ expiringInDays: searchParams?.get('expiringInDays') || '' });
  const params = new URLSearchParams();
  if (filter.expiringInDays) params.set('expiringInDays', filter.expiringInDays);

  const list = useQuery({ queryKey: ['licenses', filter], queryFn: () => api(`/licenses?${params}`) });
  const compliance = useQuery({ queryKey: ['license-compliance'], queryFn: () => api('/licenses/compliance') });
  const software = useQuery({ queryKey: ['software'], queryFn: () => api('/software') });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const openNew = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };
  const openEdit = (l: any) => {
    setEditing(l);
    setForm({
      softwareId: l.software.id,
      type: l.type,
      seats: String(l.seats),
      licenseKey: l.licenseKey || '',
      purchaseDate: l.purchaseDate ? l.purchaseDate.slice(0, 10) : '',
      expiresAt: l.expiresAt ? l.expiresAt.slice(0, 10) : '',
      cost: l.cost != null ? String(l.cost) : '',
      vendorId: l.vendor?.id || '',
      notes: l.notes || '',
      newSoftwareName: '',
      newSoftwarePublisher: '',
    });
    setOpen(true);
  };

  const isAddingSoftware = form.softwareId === '__new__';

  const save = useMutation({
    mutationFn: async () => {
      let softwareId = form.softwareId;
      if (!editing && isAddingSoftware) {
        if (!form.newSoftwareName.trim()) throw new Error('Enter a name for the new software');
        const created: any = await api('/software', {
          method: 'POST',
          body: JSON.stringify({
            name: form.newSoftwareName.trim(),
            publisher: form.newSoftwarePublisher.trim() || undefined,
          }),
        });
        softwareId = created.id;
      }
      if (!editing && !softwareId) throw new Error('Pick a software product');
      const seatsNum = Number(form.seats);
      if (!Number.isFinite(seatsNum) || seatsNum < 1) throw new Error('Seats must be 1 or more');
      const payload: any = {
        type: form.type,
        seats: seatsNum,
        licenseKey: form.licenseKey || undefined,
        purchaseDate: form.purchaseDate || undefined,
        expiresAt: form.expiresAt || undefined,
        cost: form.cost === '' ? undefined : Number(form.cost),
        vendorId: form.vendorId || undefined,
        notes: form.notes || undefined,
      };
      if (editing) {
        return api(`/licenses/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      payload.softwareId = softwareId;
      return api('/licenses', { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['licenses'] });
      qc.invalidateQueries({ queryKey: ['license-compliance'] });
      qc.invalidateQueries({ queryKey: ['software'] });
      toast.success(editing ? 'License updated' : 'License added');
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message || 'Could not save license'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/licenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['licenses'] });
      qc.invalidateQueries({ queryKey: ['license-compliance'] });
      toast.success('License deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Could not delete license'),
  });

  const softwareOptions = useMemo(
    () => (software.data || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [software.data],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">All licenses</h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="flex flex-1 items-center gap-2 text-sm sm:flex-initial">
            <span className="shrink-0 text-gray-500">Expiring within</span>
            <select className={inputClass + ' min-w-0 sm:w-32'} value={filter.expiringInDays} onChange={(e) => setFilter({ expiringInDays: e.target.value })}>
              <option value="">Anytime</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <button className={btnPrimary} onClick={openNew}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New license
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Compliance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr><th className="py-1 pr-3">Software</th><th className="pr-3">Type</th><th className="pr-3">Seats</th><th className="pr-3">Used</th><th className="pr-3">Free</th><th>Status</th></tr>
            </thead>
            <tbody>
              {compliance.data?.map((c: any) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2 pr-3">{c.software.name}</td>
                  <td className="pr-3">{c.type}</td>
                  <td className="pr-3">{c.seats}</td>
                  <td className={'pr-3 ' + (c.overDeployed ? 'text-red-600 font-semibold' : '')}>{c.used}</td>
                  <td className="pr-3">{c.free}</td>
                  <td>
                    {c.overDeployed
                      ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">OVER-DEPLOYED</span>
                      : c.free === 0
                        ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">FULL</span>
                        : <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">OK</span>}
                  </td>
                </tr>
              ))}
              {compliance.data?.length === 0 && <tr><td className="py-6 text-gray-500" colSpan={6}>No licenses yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Software</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Seats</th>
            <th className="px-4 py-2">Used</th>
            <th className="px-4 py-2">Vendor</th>
            <th className="px-4 py-2">Expires</th>
            <th className="px-4 py-2">Cost</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((l: any) => {
            const used = l.assignments.length;
            const exp = l.expiresAt ? new Date(l.expiresAt) : null;
            const expired = exp && exp < new Date();
            const soon = exp && !expired && exp < new Date(Date.now() + 30 * 86_400_000);
            return (
              <tr key={l.id} className="group cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/licenses/${l.id}`)}>
                <td className="px-4 py-2 font-medium">{l.software.name}</td>
                <td className="px-4 py-2"><span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{l.type}</span></td>
                <td className="px-4 py-2">{l.seats}</td>
                <td className={`px-4 py-2 ${used > l.seats ? 'text-red-600 font-semibold' : ''}`}>{used}</td>
                <td className="px-4 py-2 text-gray-500">{l.vendor?.name || '—'}</td>
                <td className={`px-4 py-2 ${expired ? 'text-red-600 font-semibold' : soon ? 'text-amber-700' : 'text-gray-700'}`}>
                  {exp ? new Date(exp).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-2 text-gray-500">{l.cost ?? '—'}</td>
                <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={btnSecondary + ' mr-1.5 opacity-0 transition group-hover:opacity-100'}
                    onClick={() => openEdit(l)}
                    title="Edit license"
                  >
                    <Pencil className="mr-1 h-3 w-3" /> Edit
                  </button>
                  <button
                    className={btnDanger + ' opacity-0 transition group-hover:opacity-100'}
                    onClick={() => {
                      if (used > 0 && !confirm(`This license has ${used} active assignment${used === 1 ? '' : 's'}. Delete anyway?`)) return;
                      if (used === 0 && !confirm('Delete this license?')) return;
                      del.mutate(l.id);
                    }}
                    disabled={del.isPending}
                    title="Delete license"
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Delete
                  </button>
                </td>
              </tr>
            );
          })}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={8}>No licenses match.</td></tr>}
        </tbody>
      </table></div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {list.data?.map((l: any) => {
          const used = l.assignments.length;
          const exp = l.expiresAt ? new Date(l.expiresAt) : null;
          const expired = exp && exp < new Date();
          const soon = exp && !expired && exp < new Date(Date.now() + 30 * 86_400_000);
          const expColor = expired ? 'text-red-600 font-semibold' : soon ? 'text-amber-700' : 'text-ink-700';
          return (
            <li key={l.id}>
              <MobileCard onClick={() => router.push(`/dashboard/licenses/${l.id}`)}>
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <div className="truncate font-medium text-ink-900">{l.software.name}</div>
                  <span className="shrink-0 rounded bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-700">{l.type}</span>
                </div>
                <MobileCardRow label="Seats" value={`${used} / ${l.seats}`} />
                <MobileCardRow label="Vendor" value={l.vendor?.name || '—'} />
                <MobileCardRow label="Expires" value={<span className={expColor}>{exp ? new Date(exp).toLocaleDateString() : '—'}</span>} />
                <MobileCardRow label="Cost" value={l.cost ?? '—'} />
                <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <button className={btnSecondary} onClick={() => openEdit(l)}>
                    <Pencil className="mr-1 h-3 w-3" /> Edit
                  </button>
                  <button
                    className={btnDanger}
                    onClick={() => {
                      if (used > 0 && !confirm(`This license has ${used} active assignment${used === 1 ? '' : 's'}. Delete anyway?`)) return;
                      if (used === 0 && !confirm('Delete this license?')) return;
                      del.mutate(l.id);
                    }}
                    disabled={del.isPending}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Delete
                  </button>
                </div>
              </MobileCard>
            </li>
          );
        })}
        {list.data?.length === 0 && (
          <li className="rounded-lg border border-dashed border-ink-200 bg-white/60 p-6 text-center text-sm text-ink-500">
            No licenses match.
          </li>
        )}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit license — ${editing.software.name}` : 'New software license'}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending}>
              {editing ? 'Save changes' : 'Add license'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing && (
            <Field
              label="Software"
              hint={isAddingSoftware ? 'A new software product will be created and the license attached to it.' : 'Pick an existing software product, or select "+ Add new software".'}
            >
              <select
                className={inputClass}
                value={form.softwareId}
                onChange={(e) => setForm({ ...form, softwareId: e.target.value })}
              >
                <option value="">— Select software —</option>
                {softwareOptions.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}{s.publisher ? ` (${s.publisher})` : ''}</option>
                ))}
                <option value="__new__">+ Add new software…</option>
              </select>
            </Field>
          )}
          {!editing && isAddingSoftware && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-dashed border-ink-200 bg-ink-50/40 p-3 sm:grid-cols-2">
              <Field label="New software name">
                <input
                  className={inputClass}
                  placeholder="e.g. Figma"
                  value={form.newSoftwareName}
                  onChange={(e) => setForm({ ...form, newSoftwareName: e.target.value })}
                />
              </Field>
              <Field label="Publisher (optional)">
                <input
                  className={inputClass}
                  placeholder="e.g. Figma Inc."
                  value={form.newSoftwarePublisher}
                  onChange={(e) => setForm({ ...form, newSoftwarePublisher: e.target.value })}
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="License type">
              <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Seats" hint="Number of users or installs covered">
              <input
                className={inputClass}
                type="number"
                min={1}
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: e.target.value })}
              />
            </Field>
          </div>

          <Field label="License key" hint="Optional. Stored as plain text inside your tenant DB.">
            <input
              className={inputClass}
              value={form.licenseKey}
              onChange={(e) => setForm({ ...form, licenseKey: e.target.value })}
              placeholder="XXXX-XXXX-XXXX-XXXX"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Purchase date">
              <input
                className={inputClass}
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              />
            </Field>
            <Field label="Expires at">
              <input
                className={inputClass}
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Cost">
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Vendor">
              <select className={inputClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">— None —</option>
                {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className={inputClass}
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Renewal terms, contact, anything else worth remembering"
            />
          </Field>

          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

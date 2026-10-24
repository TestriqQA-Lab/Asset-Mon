'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Card, SectionHeader, Button, Field, inputClass, selectClass, Pill } from '@/components/ui';

const MAPS_TO = ['PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED'] as const;
const COLORS = ['green', 'blue', 'amber', 'red', 'purple', 'gray', 'brand'] as const;

export default function StatusesSettingsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['status-defs'], queryFn: () => api('/asset-status-defs') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ key: '', label: '', color: 'gray', mapsTo: 'AVAILABLE' });

  const create = useMutation({
    mutationFn: () => api('/asset-status-defs', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status-defs'] }); setOpen(false); toast.success('Status created'); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) =>
      api(`/asset-status-defs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status-defs'] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/asset-status-defs/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status-defs'] }); toast.success('Status removed'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Asset statuses"
        subtitle="Rename or recolor the five built-in statuses, or add your own (e.g. IN_TRANSIT). Custom statuses map back to a system state so reports keep working."
        action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ key: '', label: '', color: 'gray', mapsTo: 'AVAILABLE' }); setOpen(true); }}>New status</Button>}
      />

      <Card padded={false}>
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2.5">Preview</th>
              <th className="px-4 py-2.5">Key</th>
              <th className="px-4 py-2.5">Label</th>
              <th className="px-4 py-2.5">Color</th>
              <th className="px-4 py-2.5">Maps to</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {(list.data || []).map((d: any) => (
              <Row key={d.id} d={d} onPatch={(patch) => update.mutate({ id: d.id, patch })} onDelete={() => confirm(`Delete "${d.label}"?`) && remove.mutate(d.id)} />
            ))}
            {list.data?.length === 0 && (
              <tr><td className="p-6 text-center text-ink-500" colSpan={6}>Loading default statuses…</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New asset status" footer={<>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        <Button onClick={() => create.mutate()} loading={create.isPending}>Create</Button>
      </>}>
        <div className="space-y-3">
          <Field label="Key" hint="Uppercase identifier — e.g. IN_TRANSIT"><input className={inputClass} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} /></Field>
          <Field label="Label" hint="What users will see — e.g. In Transit"><input className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="Color">
            <select className={selectClass} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}>
              {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Maps to" hint="System state used for reports and reservations">
            <select className={selectClass} value={form.mapsTo} onChange={(e) => setForm({ ...form, mapsTo: e.target.value })}>
              {MAPS_TO.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            Preview: <Pill dot tone={form.color as any}>{form.label || form.key || '—'}</Pill>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ d, onPatch, onDelete }: { d: any; onPatch: (p: any) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(d.label);
  const [color, setColor] = useState(d.color);
  const [mapsTo, setMapsTo] = useState(d.mapsTo);
  const dirty = label !== d.label || color !== d.color || mapsTo !== d.mapsTo;
  return (
    <tr className="border-t border-ink-100">
      <td className="px-4 py-3"><Pill dot tone={color}>{label || d.key}</Pill></td>
      <td className="px-4 py-3 font-mono text-xs text-ink-500">{d.key}{d.isSystem && <Lock className="ml-1 inline h-3 w-3 text-ink-400" />}</td>
      <td className="px-4 py-3">
        <input className={inputClass + ' max-w-[180px]'} value={label} onChange={(e) => setLabel(e.target.value)} />
      </td>
      <td className="px-4 py-3">
        <select className={selectClass + ' max-w-[120px]'} value={color} onChange={(e) => setColor(e.target.value)}>
          {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        {d.isSystem ? (
          <span className="text-xs text-ink-500">{d.mapsTo.replace(/_/g, ' ')}</span>
        ) : (
          <select className={selectClass + ' max-w-[160px]'} value={mapsTo} onChange={(e) => setMapsTo(e.target.value)}>
            {MAPS_TO.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {dirty && <Button size="sm" onClick={() => onPatch({ label, color, ...(d.isSystem ? {} : { mapsTo }) })}>Save</Button>}
        {!d.isSystem && (
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} className="ml-1 text-rose-600" onClick={onDelete}>Delete</Button>
        )}
      </td>
    </tr>
  );
}

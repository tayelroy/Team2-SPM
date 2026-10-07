import { useEffect, useRef, useState } from 'react';
import { can, loadAccess, type Access } from '../auth/access';
import { EquipmentError, listEquipment, saveEquipment, STATUS_LABELS, type EquipmentRecord, type EquipmentValues } from '../api/equipment';
import { Card, Eyebrow, Fact, GhostButton, GradientButton, Notice } from '../ui';
import { color } from '../theme';
import EquipmentForm from './EquipmentForm';
/** Remount on identity changes so records and unfinished edits belong to one session. */
export default function EquipmentDesk({ accessToken = null }: { accessToken?: string | null }) {
  return <EquipmentCatalogue key={accessToken} token={accessToken} />;
}
function EquipmentCatalogue({ token }: { token: string | null }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [records, setRecords] = useState<EquipmentRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EquipmentRecord | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setAccess(null); setRecords([]);
    async function load() {
      try {
        const [identity, equipment] = await Promise.all([
          loadAccess(token, controller.signal).then(identity => {
            if (!can(identity, 'equipment.read')) throw new EquipmentError(403);
            return identity;
          }), listEquipment(token!, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setAccess(identity); setRecords(equipment);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof EquipmentError ? failure.message : 'Unable to load equipment records. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [token, attempt]);
  useEffect(() => () => { pending.current?.abort(); }, []);
  async function save(values: EquipmentValues) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true); setError('');
    try {
      const equipment = await saveEquipment(token!, controller.signal, values, editing!);
      if (controller.signal.aborted) return;
      setRecords(current => [...current.filter(item => item.equipment_id !== equipment.equipment_id), equipment]);
      setSaved(`${equipment.type} saved.`); setEditing(undefined);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof EquipmentError && [401, 403].includes(failure.status)) {
        setAccess(null); setRecords([]); setEditing(undefined);
      }
      setConflict(failure instanceof EquipmentError && failure.status === 409);
      setError(failure instanceof EquipmentError ? failure.message : 'Unable to save equipment. Your changes are still in the form. Please try again.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  if (!token) return <Notice><Eyebrow>Sign in required</Eyebrow><span>Sign in to view equipment records.</span></Notice>;
  if (loading) return <p role="status">Loading equipment records…</p>;
  if (!access) return <Notice><p role="alert">{error}</p><GhostButton onClick={() => setAttempt(n => n + 1)}>Retry</GhostButton></Notice>;
  if (editing !== undefined) return <EquipmentForm equipment={editing} saving={saving} error={error} conflict={conflict} onSave={save}
    onCancel={() => { setEditing(undefined); setError(''); setConflict(false); }}
    onReload={() => { setEditing(undefined); setConflict(false); setAttempt(n => n + 1); }} />;
  return <section aria-label="Equipment records" style={{ display: 'grid', gap: '24px', minWidth: 0 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
      <p style={{ margin: 0, color: color.silver }}>{records.length} equipment records. Available quantities exclude damaged and maintenance stock.</p>
      {can(access, 'equipment.create') ? <GradientButton onClick={() => { setSaved(''); setEditing(null); }}>Add equipment</GradientButton> : null}
    </div>
    {saved ? <Notice><span role="status">{saved}</span></Notice> : null}
    {records.length === 0 ? <Card><h2 style={{ margin: 0 }}>No equipment yet</h2><p>Record the stock ConnectSphere holds to assess equipment requests.</p></Card> : null}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '20px' }}>
      {records.map(equipment => <article key={equipment.equipment_id} aria-label={equipment.type} style={{ minWidth: 0 }}>
        <Card padding="clamp(20px, 3vw, 28px)" style={{ gap: '20px', height: '100%', overflowWrap: 'anywhere' }}>
          <Eyebrow>Equipment record</Eyebrow><h2 style={{ margin: 0, fontSize: '24px' }}>{equipment.type}</h2>
          <Fact label="Description" value={equipment.description} />
          <Fact label="Location" value={equipment.location} />
          <Fact label="Quantity held" value={String(equipment.quantity_held)} />
          <Fact label="Operational status" value={STATUS_LABELS[equipment.operational_status]} />
          <Fact label="Available quantity" value={String(equipment.available_quantity)} />
          {can(access, 'equipment.update') ? <GhostButton onClick={() => { setSaved(''); setEditing(equipment); }}>Edit {equipment.type}</GhostButton> : null}
        </Card>
      </article>)}
    </div>
  </section>;
}

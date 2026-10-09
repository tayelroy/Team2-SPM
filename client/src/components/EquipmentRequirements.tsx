import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  EquipmentRequirementsError, loadEquipmentRequirements, saveEquipmentArrangement, saveEquipmentRequirement,
  type ArrangementValues, type EquipmentRequirement, type RequirementsView, type RequirementValues,
} from '../api/equipmentRequirements';
import { Card, Fact, GhostButton, GradientButton } from '../ui';
import { color, label } from '../theme';
import { inputStyle } from '../venues/VenueForm';
import EquipmentAvailability from './EquipmentAvailability';

type Editor = { kind: 'requirement'; record: EquipmentRequirement | null } | { kind: 'arrangement'; record: EquipmentRequirement };
const optionalText = (value: string) => value.trim() || null;
const textFits = (value: string) => Array.from(value.trim()).length <= 2000;
const whole = (value: string, minimum: number, maximum: number) => /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;

/** Each event and session owns its records, drafts and cancellable requests. */
export default function EquipmentRequirements({ eventId, accessToken = null, canCheckAvailability = false }: { eventId: number; accessToken?: string | null; canCheckAvailability?: boolean }) {
  return <Requirements key={`${eventId}:${accessToken}`} eventId={eventId} token={accessToken} canCheckAvailability={canCheckAvailability} />;
}
function Requirements({ eventId, token, canCheckAvailability }: { eventId: number; token: string | null; canCheckAvailability: boolean }) {
  const [view, setView] = useState<RequirementsView | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [attempt, setAttempt] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true); setView(null); setError('');
    void loadEquipmentRequirements(eventId, token, controller.signal).then(result => {
      if (!controller.signal.aborted) setView(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof EquipmentRequirementsError ? failure.message : 'Unable to load equipment requirements. Please try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId, token, attempt]);
  useEffect(() => () => { pending.current?.abort(); }, []);
  function reload() { setEditor(null); setConflict(false); setSaved(''); setAttempt(n => n + 1); }
  function edit(next: Editor) { setEditor(next); setError(''); setSaved(''); setConflict(false); }
  async function save(values: RequirementValues | ArrangementValues) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setSaving(true); setError('');
    try {
      const result = editor!.kind === 'requirement'
        ? await saveEquipmentRequirement(eventId, token!, controller.signal, values as RequirementValues, editor!.record)
        : await saveEquipmentArrangement(eventId, token!, controller.signal, values as ArrangementValues, editor!.record!);
      if (controller.signal.aborted) return;
      setView(result); setSaved(editor!.kind === 'requirement' ? 'Equipment requirement saved.' : 'Equipment arrangement saved.'); setEditor(null);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof EquipmentRequirementsError && [401, 403, 404].includes(failure.status)) { setView(null); setEditor(null); }
      setConflict(failure instanceof EquipmentRequirementsError && failure.status === 409);
      setError(failure instanceof EquipmentRequirementsError ? failure.message : 'Unable to save equipment requirements. Your changes are still in the form. Please try again.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  if (!token) return <p>Sign in to view equipment requirements.</p>;
  if (loading) return <p role="status">Loading equipment requirements…</p>;
  if (!view) return <div><p role="alert">{error}</p><GhostButton onClick={reload}>Retry equipment requirements</GhostButton></div>;
  return <section aria-label="Equipment requirements" style={{ display: 'grid', gap: '20px', minWidth: 0 }}>
    <h3 style={{ margin: 0 }}>Equipment requirements</h3>
    <p style={{ margin: 0, color: color.silver }}>Record what this event needs. A request does not reserve equipment or guarantee stock.</p>
    {saved ? <p role="status">{saved}</p> : null}
    {editor ? <RequirementEditor key={`${editor.kind}:${editor.record?.request_id ?? 'new'}`} editor={editor} view={view} saving={saving} conflict={conflict} error={error}
      onSave={save} onReload={reload} onCancel={() => { setEditor(null); setError(''); setConflict(false); }} /> : <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {view.can_request ? <GradientButton onClick={() => edit({ kind: 'requirement', record: null })}>Add equipment requirement</GradientButton> : null}
        <GhostButton onClick={reload}>Refresh equipment requirements</GhostButton>
      </div>
      {view.requests.length === 0 ? <p>No equipment requirements recorded.</p> : null}
      {view.requests.map(record => <article key={record.request_id} aria-label={`Equipment requirement: ${record.equipment_type}`} style={{ minWidth: 0 }}>
        <Card padding="clamp(16px, 3vw, 28px)" style={{ gap: '16px', overflowWrap: 'anywhere' }}>
          <h4 style={{ margin: 0, fontSize: '20px' }}>{record.equipment_type}</h4>
          {canCheckAvailability ? <EquipmentAvailability eventId={eventId} requestId={record.request_id} equipmentType={record.equipment_type} accessToken={token} /> : null}
          <Fact label="Quantity requested" value={String(record.quantity)} />
          <Fact label="Technical notes" value={record.notes ?? 'Not recorded'} />
          <Fact label="Request status" value={record.status} />
          <Fact label="Arrangement update" value={record.arrangement_notes ?? 'Not recorded'} />
          <Fact label="Shortfall" value={record.shortfall === null ? 'Not recorded' : String(record.shortfall)} />
          <Fact label="Placement venue" value={record.placement_venue_name ?? 'Not recorded'} />
          <Fact label="Placement position" value={record.placement_position ?? 'Not recorded'} />
          {record.status === 'pending' ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {view.can_request ? <GhostButton onClick={() => edit({ kind: 'requirement', record })}>Edit requirement for {record.equipment_type}</GhostButton> : null}
            {view.can_arrange ? <GhostButton onClick={() => edit({ kind: 'arrangement', record })}>Update arrangement for {record.equipment_type}</GhostButton> : null}
          </div> : null}
        </Card>
      </article>)}
    </>}
  </section>;
}
function RequirementEditor({ editor, view, saving, conflict, error, onSave, onCancel, onReload }: {
  editor: Editor; view: RequirementsView; saving: boolean; conflict: boolean; error: string;
  onSave: (values: RequirementValues | ArrangementValues) => void; onCancel: () => void; onReload: () => void;
}) {
  const id = useId();
  const arranging = editor.kind === 'arrangement';
  const record = editor.record;
  const [equipment, setEquipment] = useState(record ? String(record.equipment_id) : '');
  const [quantity, setQuantity] = useState(record ? String(record.quantity) : '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [arrangement, setArrangement] = useState(record?.arrangement_notes ?? '');
  const [shortfall, setShortfall] = useState(record?.shortfall == null ? '' : String(record.shortfall));
  const [venue, setVenue] = useState(record?.placement_venue_id == null ? '' : String(record.placement_venue_id));
  const [position, setPosition] = useState(record?.placement_position ?? '');
  const [invalid, setInvalid] = useState(false);
  const title = arranging ? 'Update equipment arrangement' : record ? 'Edit equipment requirement' : 'Add equipment requirement';
  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || conflict) return;
    if (arranging) {
      const placementValid = venue === '' ? position.trim() === '' : view.venues.some(item => item.venue_id === Number(venue)) && position.trim() !== '';
      if (!whole(shortfall, 0, record!.quantity) || !textFits(arrangement) || !textFits(position) || !placementValid) { setInvalid(true); return; }
      setInvalid(false);
      onSave({ arrangement_notes: optionalText(arrangement), shortfall: Number(shortfall), placement_venue_id: venue === '' ? null : Number(venue), placement_position: optionalText(position) });
    } else {
      if (!view.equipment.some(item => item.equipment_id === Number(equipment)) || !whole(quantity, 1, 2147483647) || !textFits(notes)) { setInvalid(true); return; }
      setInvalid(false); onSave({ equipment_id: Number(equipment), quantity: Number(quantity), notes: optionalText(notes) });
    }
  }
  const fieldStyle = { ...label, display: 'grid', gap: '8px', minWidth: 0 };
  return <Card padding="clamp(16px, 3vw, 28px)" style={{ gap: '20px', minWidth: 0 }}>
    <h4 style={{ margin: 0, fontSize: '22px' }}>{title}</h4>
    <form aria-label={title} onSubmit={submit} noValidate>
      <fieldset disabled={saving || conflict} style={{ margin: 0, padding: 0, border: 0, display: 'grid', gap: '16px', minWidth: 0 }}>
        {arranging ? <>
          <p style={{ margin: 0 }}>Arranging {record!.quantity} × {record!.equipment_type}</p>
          <label htmlFor={`${id}-arrangement`} style={fieldStyle}>Arrangement notes<textarea id={`${id}-arrangement`} rows={3} style={inputStyle} value={arrangement} onChange={event => setArrangement(event.target.value)} /></label>
          <label htmlFor={`${id}-shortfall`} style={fieldStyle}>Shortfall quantity<input id={`${id}-shortfall`} required inputMode="numeric" style={inputStyle} value={shortfall} onChange={event => setShortfall(event.target.value)} /></label>
          <p style={{ margin: 0, color: color.silver }}>Enter 0 when the requirement is fully covered. The shortfall cannot exceed the quantity requested.</p>
          <label htmlFor={`${id}-venue`} style={fieldStyle}>Placement venue<select id={`${id}-venue`} style={inputStyle} value={venue} onChange={event => setVenue(event.target.value)}>
            <option value="">Not recorded</option>{view.venues.map(item => <option key={item.venue_id} value={item.venue_id}>{item.name}</option>)}
          </select></label>
          <label htmlFor={`${id}-position`} style={fieldStyle}>Placement position<textarea id={`${id}-position`} rows={2} style={inputStyle} value={position} onChange={event => setPosition(event.target.value)} /></label>
          <p style={{ margin: 0, color: color.silver }}>Record both a venue and a position, or leave both blank. Safety Officers can read this placement.</p>
        </> : <>
          <label htmlFor={`${id}-equipment`} style={fieldStyle}>Equipment type<select id={`${id}-equipment`} required style={inputStyle} value={equipment} onChange={event => setEquipment(event.target.value)}>
            <option value="">Choose equipment</option>{view.equipment.map(item => <option key={item.equipment_id} value={item.equipment_id}>{item.type}</option>)}
          </select></label>
          <label htmlFor={`${id}-quantity`} style={fieldStyle}>Quantity required<input id={`${id}-quantity`} required inputMode="numeric" style={inputStyle} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
          <label htmlFor={`${id}-notes`} style={fieldStyle}>Technical notes<textarea id={`${id}-notes`} rows={3} style={inputStyle} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          {record ? <p>Saving changes clears the previous arrangement update, shortfall and placement. Technical Support must recheck the amended requirement.</p> : null}
        </>}
      </fieldset>
      <p style={{ color: color.silver }}>Notes and placement position allow up to 2,000 characters each.</p>
      {invalid ? <p role="alert">{arranging ? 'Enter a whole-number shortfall from 0 to the requested quantity, keep text within 2,000 characters, and record both placement fields or neither.' : 'Choose equipment, enter a whole-number quantity from 1 to 2,147,483,647, and keep technical notes within 2,000 characters.'}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <button className="organisation-button organisation-button-primary" type="submit" disabled={saving || conflict}>{saving ? 'Saving…' : arranging ? 'Save equipment arrangement' : 'Save equipment requirement'}</button>
        <GhostButton disabled={saving} onClick={onCancel}>Cancel</GhostButton>
        {conflict ? <GhostButton onClick={onReload}>Reload requirements</GhostButton> : null}
      </div>
    </form>
  </Card>;
}

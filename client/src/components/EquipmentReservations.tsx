import { futureSgtMinute, isFuturePeriod } from '../utils/futureDates';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EquipmentReservationsError, loadEquipmentReservations, reserveEquipment, type ReservationsView } from '../api/equipmentReservations';
import { EquipmentAvailabilityError, loadEquipmentAvailability, type AvailabilityReady } from '../api/equipmentAvailability';
import type { EquipmentRequirement } from '../api/equipmentRequirements';
import { Card, Fact, GhostButton } from '../ui';
import { color, label, rule } from '../theme';
import { inputStyle } from '../venues/VenueForm';

type Props = { eventId: number; accessToken: string; requests: EquipmentRequirement[]; onReserved: (requestId: number) => void; onRefresh: () => void; onReceipts: (requestIds: number[]) => void };
const receiptRequestIds = (view: ReservationsView) => view.reservations.flatMap(item => item.request_id === null ? [] : [item.request_id]);
const timestamp = (value: string) => new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'long', hour12: false });
const submillisecond = (value: string) => /[1-9]/.test((value.match(/\.(\d+)/)?.[1] ?? '').slice(3));
// datetime-local supports milliseconds. Expand finer source periods outwards so
// confirming the suggested dates always covers the entire request/booking.
const singaporeInput = (value: string, roundEnd = false) => new Date(new Date(value).getTime() + (roundEnd && submillisecond(value) ? 1 : 0) + 8 * 60 * 60 * 1000).toISOString().slice(0, -1);
// Only a period with seconds or milliseconds needs the finer input: whole-minute
// periods show hours and minutes like every other date field (and keep AM/PM visible on a phone).
const inputStep = (value: string) => (/T\d\d:\d\d:(?!00(?:\.0*)?$)/.test(value) ? '0.001' : undefined);
export default function EquipmentReservations(props: Props) {
  return <Reservations key={`${props.eventId}:${props.accessToken}`} {...props} />;
}
function Reservations({ eventId, accessToken, requests, onReserved, onRefresh, onReceipts }: Props) {
  const [view, setView] = useState<ReservationsView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EquipmentRequirement | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setView(null); setError(''); onReceipts([]);
    void loadEquipmentReservations(eventId, accessToken, controller.signal).then(result => {
      if (!controller.signal.aborted) { setView(result); onReceipts(receiptRequestIds(result)); }
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof EquipmentReservationsError ? failure.message : 'Unable to load equipment reservations. Please try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId, accessToken, attempt, onReceipts]);
  function refresh() { setSelected(null); setSaved(''); setAttempt(value => value + 1); }
  function reserved(result: ReservationsView, requestId: number) {
    setView(result); setSelected(null); onReceipts(receiptRequestIds(result));
    setSaved(result.coordinator_notified ? 'Equipment reserved for this event. The assigned Event Coordinator has been notified.' : 'Equipment reserved for this event.');
    onReserved(requestId);
  }
  const reservedRequests = new Set(view?.reservations.map(item => item.request_id));
  const eligible = requests.filter(item => item.status === 'pending' && !reservedRequests.has(item.request_id));
  return <section aria-label="Equipment reservations" style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
    <h3 style={{ margin: 0 }}>Equipment reservations</h3>
    <p style={{ margin: 0, color: color.silver }}>Reserved equipment is committed to this event for the recorded period and reduces availability for overlapping events.</p>
    {loading ? <p role="status">Loading equipment reservations…</p> : !view ? <div><p role="alert">{error}</p><GhostButton onClick={refresh}>Retry equipment reservations</GhostButton></div> : <>
      {saved ? <p role="status">{saved}</p> : null}
      {selected ? <ReservationForm key={`${selected.request_id}:${selected.version}`} eventId={eventId} token={accessToken} record={selected}
        onSaved={reserved} onCancel={() => setSelected(null)} onRefresh={onRefresh}
        onUnavailable={message => { setError(message); setView(null); setSelected(null); onReceipts([]); }} /> : <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <GhostButton onClick={refresh}>Refresh equipment reservations</GhostButton>
          {view.can_reserve ? eligible.map(item => <GhostButton key={item.request_id} onClick={() => { setSaved(''); setSelected(item); }}>Reserve {item.equipment_type}</GhostButton>) : null}
        </div>
        {view.can_reserve && eligible.length === 0 ? <p>No unreserved pending equipment requests are available.</p> : null}
      </>}
      {view.reservations.length === 0 ? <p>No equipment reservations recorded.</p> : view.reservations.map(item => <article key={item.reservation_id} aria-label={`Reserved equipment: ${item.equipment_type}`} style={{ minWidth: 0 }}>
        <Card padding="clamp(16px, 3vw, 28px)" style={{ gap: '12px', minWidth: 0, overflowWrap: 'anywhere', border: rule.edge }}>
          <h4 style={{ margin: 0 }}>{item.equipment_type}</h4>
          <Fact label="Quantity reserved" value={String(item.quantity_reserved)} />
          <Fact label="Reservation starts (Singapore time)" value={item.starts_at ? timestamp(item.starts_at) : 'Not recorded'} />
          <Fact label="Reservation ends (Singapore time)" value={item.ends_at ? timestamp(item.ends_at) : 'Not recorded'} />
          <Fact label="Reserved at (Singapore time)" value={item.reserved_at ? timestamp(item.reserved_at) : 'Not recorded'} />
          {!item.starts_at || !item.ends_at ? <p role="note">This legacy reservation has no complete period and is conservatively counted against availability.</p> : null}
        </Card>
      </article>)}
    </>}
  </section>;
}
function ReservationForm({ eventId, token, record, onSaved, onCancel, onRefresh, onUnavailable }: {
  eventId: number; token: string; record: EquipmentRequirement;
  onSaved: (view: ReservationsView, requestId: number) => void; onCancel: () => void; onRefresh: () => void; onUnavailable: (message: string) => void;
}) {
  const id = useId();
  const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [availability, setAvailability] = useState<AvailabilityReady | null>(null);
  const [checking, setChecking] = useState(true);
  const [advisory, setAdvisory] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadEquipmentAvailability(eventId, record.request_id, token, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.status === 'ready') {
        setAvailability(result); setStart(singaporeInput(result.starts_at)); setEnd(singaporeInput(result.ends_at, true));
        if (submillisecond(result.starts_at) || submillisecond(result.ends_at)) setAdvisory('Suggested dates were expanded to millisecond precision so the full period is covered.');
      }
      else { if (result.proposed_start) setStart(singaporeInput(result.proposed_start)); setAdvisory('Choose a complete reservation period. No event duration has been assumed.'); }
    }).catch(failure => {
      if (!controller.signal.aborted) setAdvisory(failure instanceof EquipmentAvailabilityError ? failure.message : 'Availability could not be loaded. Choose the reservation period; stock will be checked when you reserve.');
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [eventId, record.request_id, token]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || checking || conflict) return;
    const from = new Date(`${start}+08:00`); const until = new Date(`${end}+08:00`);
    if (!isFuturePeriod(start, end)) { setError('Choose both dates in the future, with the end after the start.'); return; }
    const controller = new AbortController(); pending.current = controller; setSaving(true); setError('');
    try {
      const result = await reserveEquipment(eventId, record.request_id, token, controller.signal, { version: record.version, starts_at: from.toISOString(), ends_at: until.toISOString() });
      if (!controller.signal.aborted) onSaved(result, record.request_id);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const uncertain = !(failure instanceof EquipmentReservationsError) || failure.status >= 500;
      const message = uncertain ? 'Unable to confirm the reservation. Refresh reservations and requirements to check whether it was saved before trying again.' : failure.message;
      if (failure instanceof EquipmentReservationsError && [401, 403, 404].includes(failure.status)) { onUnavailable(message); return; }
      setConflict(uncertain || failure.status === 409);
      setError(message); setAvailability(null);
    } finally { pending.current = null; if (!controller.signal.aborted) setSaving(false); }
  }
  const fieldStyle = { ...label, display: 'grid', gap: '8px', minWidth: 0 };
  return <Card padding="clamp(16px, 3vw, 28px)" style={{ gap: '16px', minWidth: 0, border: rule.edge }}>
    <h4 style={{ margin: 0 }}>Reserve equipment for this event</h4>
    <p style={{ margin: 0 }}>Reserve the full request: {record.quantity} × {record.equipment_type}.</p>
    <p style={{ margin: 0 }}>Availability is advisory. Stock is checked again when you reserve. A successful reservation notifies the assigned Event Coordinator.</p>
    {checking ? <p role="status">Loading the suggested reservation period…</p> : null}
    {advisory ? <p role="note">{advisory}</p> : null}
    {availability ? <div style={{ display: 'grid', gap: '8px' }}>
      <Fact label="Available for the suggested period" value={String(availability.quantity_remaining)} />
      <Fact label="Calculated shortfall" value={String(availability.shortfall)} />
      <Fact label="Availability checked at (Singapore time)" value={timestamp(availability.checked_at)} />
    </div> : null}
    <form aria-label={`Reserve equipment: ${record.equipment_type}`} onSubmit={submit} noValidate>
      <fieldset disabled={checking || saving || conflict} style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <label htmlFor={`${id}-start`} style={fieldStyle}>Reserve from (Singapore time)<input id={`${id}-start`} type="datetime-local" min={futureSgtMinute()} step={inputStep(start)} required value={start} onChange={event => { setStart(event.target.value); setAvailability(null); }} style={{ ...inputStyle, minWidth: 0 }} /></label>
        <label htmlFor={`${id}-end`} style={fieldStyle}>Reserve until (Singapore time)<input id={`${id}-end`} type="datetime-local" min={Date.parse(`${start}+08:00`) > Date.now() ? start : futureSgtMinute()} step={inputStep(end)} required value={end} onChange={event => { setEnd(event.target.value); setAvailability(null); }} style={{ ...inputStyle, minWidth: 0 }} /></label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '16px' }}>
        <button className="organisation-button organisation-button-primary" type="submit" disabled={checking || saving || conflict}>{saving ? 'Reserving…' : 'Reserve equipment'}</button>
        <GhostButton disabled={saving} onClick={onCancel}>Cancel reservation</GhostButton>
        {conflict ? <GhostButton onClick={onRefresh}>Refresh reservations and requirements</GhostButton> : null}
      </div>
    </form>
  </Card>;
}

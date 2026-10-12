import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EquipmentAvailabilityError, loadEquipmentAvailability, type AvailabilityPeriod, type EquipmentAvailability as Availability } from '../api/equipmentAvailability';
import { Fact, GhostButton } from '../ui';
import { inputStyle } from '../venues/VenueForm';
import { label } from '../theme';
function timestamp(value: string) { return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'long', hour12: false }); }
// The form explicitly uses Singapore time, independent of the browser's zone.
function singaporeInput(value: string) { return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16); }
export default function EquipmentAvailability({ eventId, requestId, equipmentType, accessToken }: { eventId: number; requestId: number; equipmentType: string; accessToken: string }) {
  return <AvailabilityCheck key={`${eventId}:${requestId}:${accessToken}`} eventId={eventId} requestId={requestId} equipmentType={equipmentType} token={accessToken} />;
}
function AvailabilityCheck({ eventId, requestId, equipmentType, token }: { eventId: number; requestId: number; equipmentType: string; token: string }) {
  const id = useId();
  const [opened, setOpened] = useState(false);
  const [result, setResult] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [period, setPeriod] = useState<AvailabilityPeriod | undefined>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  async function check(selected?: AvailabilityPeriod) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setOpened(true); setLoading(true); setError(''); setResult(null); setPeriod(selected);
    try {
      const answer = await loadEquipmentAvailability(eventId, requestId, token, controller.signal, selected);
      if (controller.signal.aborted) return;
      setResult(answer);
      if (answer.status === 'dates_required' && answer.proposed_start) setStart(singaporeInput(answer.proposed_start));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof EquipmentAvailabilityError ? failure.message : 'Equipment availability could not be checked. Please try again.');
    } finally { pending.current = null; if (!controller.signal.aborted) setLoading(false); }
  }
  function choose(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const from = new Date(`${start}+08:00`); const until = new Date(`${end}+08:00`);
    if (!start || !end || !Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || until <= from) {
      setResult(null); setError('Choose both dates, with the end after the start.'); return;
    }
    void check({ starts_at: from.toISOString(), ends_at: until.toISOString() });
  }
  return <section aria-label={`Availability for ${equipmentType}`} style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
    {!opened ? <GhostButton onClick={() => void check()}>Check availability for {equipmentType}</GhostButton> : <>
      <h5 style={{ margin: 0, fontSize: '18px' }}>Availability check</h5>
      <p style={{ margin: 0 }}>This check does not reserve equipment or guarantee stock. It does not change the recorded arrangement shortfall.</p>
      {loading ? <p role="status">Checking equipment availability…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {result?.status === 'dates_required' ? <p role="status">A complete period is needed. Choose when the equipment is required; no event duration has been assumed.</p> : null}
      {result?.status === 'ready' ? <div style={{ display: 'grid', gap: '12px', minWidth: 0 }}>
        <Fact label="Quantity held" value={String(result.quantity_held)} />
        <Fact label="Committed to other events (peak)" value={String(result.quantity_committed)} />
        <Fact label="Quantity remaining" value={String(result.quantity_remaining)} />
        <Fact label="Quantity requested" value={String(result.quantity_requested)} />
        <Fact label="Calculated shortfall" value={String(result.shortfall)} />
        <Fact label="Period starts (Singapore time)" value={timestamp(result.starts_at)} />
        <Fact label="Period ends (Singapore time)" value={timestamp(result.ends_at)} />
        <Fact label="Period source" value={{ request: 'Equipment request', event_bookings: 'Confirmed venue bookings', chosen: 'Selected dates' }[result.period_source]} />
        <Fact label="Checked at (Singapore time)" value={timestamp(result.checked_at)} />
        {result.operational_status !== 'operational' ? <p role="note">{result.operational_status === 'damaged' ? 'Damaged equipment' : 'Equipment under maintenance'} contributes no available stock; quantity held is shown for reference.</p> : null}
        {result.undated_commitments > 0 ? <p role="note">{result.undated_commitments} reservation(s) have no recorded period and are conservatively counted throughout these dates.</p> : null}
      </div> : null}
      <form aria-label={`Availability dates for ${equipmentType}`} onSubmit={choose} noValidate>
        <fieldset disabled={loading} style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label style={{ ...label, display: 'grid', gap: '8px', minWidth: 0 }} htmlFor={`${id}-start`}>Availability starts (Singapore time)<input id={`${id}-start`} type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} style={{ ...inputStyle, minWidth: 0 }} /></label>
          <label style={{ ...label, display: 'grid', gap: '8px', minWidth: 0 }} htmlFor={`${id}-end`}>Availability ends (Singapore time)<input id={`${id}-end`} type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} style={{ ...inputStyle, minWidth: 0 }} /></label>
          <button type="submit" className="organisation-button" disabled={loading}>Check selected dates</button>
        </fieldset>
      </form>
      <GhostButton disabled={loading} onClick={() => void check(period)}>Refresh availability</GhostButton>
    </>}
  </section>;
}

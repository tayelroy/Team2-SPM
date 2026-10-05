import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Role } from '../mock/types';
import { changeHold, createHold, fetchHolds, fetchHoldOptions, type HoldOptions, type VenueHold } from '../venues/holdsApi';

const EMPTY = { event: '', venue: '', start: '', end: '', expiry: '' };
const LABELS = { tentative: 'Tentative', converted: 'Confirmed booking', released: 'Released', expired: 'Expired' };
const formatter = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false });

/** SG2-84/85: persisted venue holds. Staff place, release and approve;
 * coordinators read only their assigned events. The API enforces both scopes. */
export default function VenueHolds({ role, accessToken }: { role: Role; accessToken: string }) {
  const allowed = role === 'Venue Staff' || role === 'Event Coordinator';
  const staff = role === 'Venue Staff';
  const [holds, setHolds] = useState<VenueHold[] | null>(null);
  const [options, setOptions] = useState<HoldOptions>({ events: [], venues: [] });
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setHolds(null); setLoadError('');
    Promise.all([fetchHolds(accessToken), staff ? fetchHoldOptions(accessToken)
      : Promise.resolve({ ok: true as const, data: { events: [], venues: [] } })]).then(([rows, choices]) => {
      if (cancelled) return;
      if (!rows.ok) { setLoadError(rows.error); return; }
      if (!choices.ok) { setLoadError(choices.error); return; }
      setHolds(rows.data); setOptions(choices.data);
    });
    return () => { cancelled = true; };
  }, [allowed, staff, accessToken, revision]);

  useEffect(() => {
    if (!holds || pending) return;
    const deadlines = holds.filter(hold => hold.status === 'tentative' && Date.parse(hold.expires_at) > Date.now());
    if (!deadlines.length) return;
    const next = Math.min(...deadlines.map(hold => Date.parse(hold.expires_at)));
    // Refresh no later than the next deadline, and at least once a minute
    // while a hold is active so remote approval/release is also visible.
    const timer = window.setTimeout(() => setRevision(value => value + 1), Math.min(next - Date.now(), 60_000));
    return () => window.clearTimeout(timer);
  }, [holds, pending]);

  async function place(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError(''); setMessage('');
    if (Object.values(form).some(value => !value)) {
      setError('Select an event and venue, and enter the period and expiry.'); return;
    }
    const start = Date.parse(form.start), end = Date.parse(form.end), expiry = Date.parse(form.expiry);
    if (start >= end || expiry <= Date.now()) {
      setError('The period must end after it starts, and the expiry must be in the future.'); return;
    }
    busy.current = true; setPending(true);
    const result = await createHold(accessToken, { event_id: Number(form.event), venue_id: Number(form.venue),
      starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), expires_at: new Date(expiry).toISOString() });
    busy.current = false; setPending(false);
    if (!result.ok) { setError(result.error); return; }
    setHolds(previous => [...previous!, result.data]); setForm(EMPTY);
    setMessage('Hold placed. The Event Coordinator has been notified of its expiry.');
  }

  async function change(hold: VenueHold, action: 'convert' | 'release') {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setMessage('');
    const result = await changeHold(accessToken, hold.hold_id, action);
    busy.current = false; setPending(false);
    if (!result.ok) { setError(result.error); return; }
    setHolds(previous => previous!.map(row => row.hold_id === hold.hold_id ? result.data : row));
    setMessage(action === 'convert' ? 'Booking approved. The hold is now a confirmed booking.'
      : 'Hold released. The period is available for other requests.');
  }

  if (!allowed) return <p role="alert">Venue holds are available to Venue Staff and Event Coordinators.</p>;
  return <div className="venue-holds">
    <div className="work-queue-heading"><h2>Tentative venue holds</h2>
      <button type="button" className="organisation-button" disabled={pending} onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    <p className="organisation-detail-hint">A Tentative hold reserves the period until its expiry. It does not count as an approved venue booking.</p>
    {loadError ? <p role="alert">{loadError}</p> : holds === null ? <p role="status">Loading venue holds…</p> : <>
      {staff && (options.events.length > 0 && options.venues.length > 0 ?
        <form aria-label="Place a tentative hold" className="venue-hold-form" onSubmit={place}>
          <h3>Place a tentative hold</h3>
          <p>Choose an approved or planning event with an assigned coordinator. Date and time inputs use your device’s local time.</p>
          <div className="venue-hold-fields">
            <label>Event<select required value={form.event} onChange={event => setForm(previous => ({ ...previous, event: event.target.value }))}>
              <option value="">Select event</option>{options.events.map(event => <option key={event.event_id} value={event.event_id}>{event.name} · #{event.event_id}</option>)}
            </select></label>
            <label>Venue<select required value={form.venue} onChange={event => setForm(previous => ({ ...previous, venue: event.target.value }))}>
              <option value="">Select venue</option>{options.venues.map(venue => <option key={venue.venue_id} value={venue.venue_id}>{venue.name}</option>)}
            </select></label>
            <label>Period starts<input required type="datetime-local" value={form.start} onChange={event => setForm(previous => ({ ...previous, start: event.target.value }))} /></label>
            <label>Period ends<input required type="datetime-local" value={form.end} onChange={event => setForm(previous => ({ ...previous, end: event.target.value }))} /></label>
            <label>Hold expires<input required type="datetime-local" value={form.expiry} onChange={event => setForm(previous => ({ ...previous, expiry: event.target.value }))} /></label>
          </div>
          <button type="submit" className="organisation-button organisation-button-primary" disabled={pending}>{pending ? 'Placing hold…' : 'Place hold'}</button>
        </form> : <p>No eligible events or venues. An approved or planning event needs an assigned Event Coordinator before a hold can be placed.</p>)}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {holds.length === 0 ? <p>No venue holds yet.</p> : <div className="venue-hold-list">
        {holds.map(hold => {
          const status = hold.status === 'tentative' && Date.parse(hold.expires_at) <= Date.now() ? 'expired' : hold.status;
          return <article key={hold.hold_id} className="venue-hold-card" aria-label={`Hold #${hold.hold_id}`}>
            <div className="venue-hold-header"><h3>{hold.venue_name}</h3><span className={`venue-hold-status venue-hold-${status}`}>{LABELS[status]}</span></div>
            <p>{hold.event_name} · Event #{hold.event_id}</p>
            <p>{formatter.format(new Date(hold.starts_at))} – {formatter.format(new Date(hold.ends_at))} (SGT)</p>
            <p>Expiry: {formatter.format(new Date(hold.expires_at))} (SGT) · Hold #{hold.hold_id}</p>
            {status === 'expired' && <p>A new request is needed. This expired hold cannot be approved.</p>}
            {status === 'converted' && <p>Booking #{hold.booking_id}</p>}
            {staff && status === 'tentative' && <>
              <p>Booking request #{hold.request_id}. Approval checks current venue conflicts and suitability.</p>
              <div className="venue-hold-actions">
                <button type="button" className="organisation-button organisation-button-primary" disabled={pending} onClick={() => change(hold, 'convert')}>Approve booking</button>
                <button type="button" className="organisation-button" disabled={pending} onClick={() => change(hold, 'release')}>Release hold</button>
              </div>
            </>}
          </article>;
        })}
      </div>}
    </>}
  </div>;
}

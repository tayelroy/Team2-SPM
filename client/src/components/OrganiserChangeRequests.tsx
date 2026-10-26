import { useEffect, useId, useState } from 'react';
import {
  fetchOwnChangeRequests,
  raiseChangeRequest,
  type ChangeValue,
  type OwnChangeRequest,
} from '../api/changeRequests';
import { formatSgtTimestamp } from './EventAuditDrawer';

export interface OrganiserChangeRequestsProps {
  eventId: number;
  accessToken: string;
}

/** What may change, in the order the request form asks for it. Mirrors
 * CHANGEABLE_FIELDS in server/src/events/changeImpact.ts. */
export const CHANGE_FIELDS = [
  { field: 'name', label: 'Event name', input: 'text' },
  { field: 'purpose', label: 'Purpose', input: 'textarea' },
  { field: 'description', label: 'Description', input: 'textarea' },
  { field: 'proposed_date', label: 'Event date and time', input: 'datetime' },
  { field: 'expected_attendance', label: 'Expected attendance', input: 'number' },
  { field: 'venue_requirements', label: 'Venue requirements', input: 'textarea' },
  { field: 'accessibility_needs', label: 'Accessibility needs', input: 'textarea' },
  { field: 'equipment_requirements', label: 'Equipment requirements', input: 'textarea' },
] as const;

const MAX_REASON = 1000;

/** How a requested value reads: dates in Singapore time, blanks as "Not set". */
export function formatChangeValue(field: string, value: ChangeValue): string {
  if (value === null || value === '') return 'Not set';
  return field === 'proposed_date' && typeof value === 'string' ? formatSgtTimestamp(value) : String(value);
}

/**
 * SG2-64: the organiser who created a submitted event asks for a change to it
 * (what, to what and why, AC1) and sees their outstanding requests (AC3). The
 * server checks ownership and status, refuses a closed event (AC4) and
 * notifies the assigned coordinator (AC2); this panel only collects the ask.
 */
export default function OrganiserChangeRequests({ eventId, accessToken }: OrganiserChangeRequestsProps) {
  const ids = useId();
  const [requests, setRequests] = useState<OwnChangeRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchOwnChangeRequests(eventId, accessToken).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRequests(result.requests);
        setLoadError(null);
      } else setLoadError(result.message);
    });
    return () => { active = false; };
  }, [eventId, accessToken, reloadKey]);

  const chosen = CHANGE_FIELDS.find((option) => option.field === field);

  const send = async () => {
    const trimmed = reason.trim();
    if (!chosen || value.trim() === '' || !trimmed || trimmed.length > MAX_REASON) {
      setError(`Choose what to change, give the new value, and a reason up to ${MAX_REASON} characters.`);
      return;
    }
    let to: string | number = value;
    if (chosen.input === 'number') to = Number(value);
    if (chosen.input === 'datetime') {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        setError('Give a valid date and time.');
        return;
      }
      to = parsed.toISOString();
    }
    setBusy(true);
    setError(null);
    setSent(null);
    const result = await raiseChangeRequest(eventId, { field: chosen.field, to, reason: trimmed }, accessToken);
    setBusy(false);
    if (!result.ok) {
      setError(result.details?.length ? result.details.join(' ') : result.message);
      return;
    }
    setField('');
    setValue('');
    setReason('');
    setSent(result.coordinatorNotified
      ? 'Your change request was sent to your coordinator.'
      : 'Your change request is saved. Your coordinator will see it once one is assigned.');
    setReloadKey((key) => key + 1);
  };

  const valueId = `${ids}-value`;
  const valueInput = !chosen ? null : chosen.input === 'textarea' ? (
    <textarea id={valueId} rows={3} value={value} onChange={(event) => setValue(event.target.value)} className="organisation-textarea" />
  ) : (
    <input
      id={valueId}
      type={chosen.input === 'datetime' ? 'datetime-local' : chosen.input}
      min={chosen.input === 'number' ? 1 : undefined}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="organisation-textarea"
    />
  );

  return (
    <section className="organisation-detail-intro" aria-label="Change requests">
      <h3>Change requests</h3>
      {loadError ? <p role="alert" className="work-queue-empty">{loadError}</p> : requests.length === 0 ? (
        <p className="organisation-detail-hint">You have no outstanding change requests on this event.</p>
      ) : (
        <ul aria-label="Outstanding change requests" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map((request) => (
            <li key={request.id} style={{ overflowWrap: 'anywhere' }}>
              {request.changes.map((change) => (
                <span key={change.field}>
                  <strong>{change.label}</strong>: {formatChangeValue(change.field, change.from)} → {formatChangeValue(change.field, change.to)}.{' '}
                </span>
              ))}
              Reason: {request.reason}
              <span className="organisation-detail-hint"> Asked {formatSgtTimestamp(request.requested_at)}, waiting for your coordinator.</span>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={`${ids}-field`}>What should change</label>
      <select
        id={`${ids}-field`}
        value={field}
        onChange={(event) => { setField(event.target.value); setValue(''); }}
        className="organisation-textarea"
        style={{ minHeight: 44, maxWidth: '100%' }}
      >
        <option value="">Choose a detail</option>
        {CHANGE_FIELDS.map((option) => <option key={option.field} value={option.field}>{option.label}</option>)}
      </select>
      {chosen ? <><label htmlFor={valueId}>{`New ${chosen.label.toLowerCase()}`}</label>{valueInput}</> : null}
      <label htmlFor={`${ids}-reason`}>Why it should change</label>
      <textarea id={`${ids}-reason`} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="organisation-textarea" />
      <button type="button" className="organisation-button" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Ask for this change'}
      </button>
      {error ? <p role="alert" className="work-queue-empty">{error}</p> : null}
      {sent ? <p role="status" className="organisation-detail-hint">{sent}</p> : null}
    </section>
  );
}

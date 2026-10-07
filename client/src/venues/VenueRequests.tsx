import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Card, Fact, GhostButton } from '../ui';
import { color, gradient, label, radius } from '../theme';
import { inputStyle } from './VenueForm';
import { LAYOUT_LABELS, describeLayouts, type Layout, type VenueLayout } from './layoutsApi';
import { formatSgt, sgtToIso } from './searchApi';
import { describeConflict, fetchVenueRequests, requestVenue, type VenueConflict, type VenueRequest } from './requestsApi';
import type { BookingReadiness } from './suitabilityApi';

const STATUS: Record<string, { text: string; bg: string; fg: string }> = {
  pending: { text: 'Pending', bg: 'rgba(255, 180, 0, 0.16)', fg: '#fde047' },
  approved: { text: 'Approved', bg: 'rgba(0, 130, 124, 0.35)', fg: color.accent },
  rejected: { text: 'Rejected', bg: 'rgba(255, 99, 99, 0.16)', fg: '#fca5a5' },
  cancelled: { text: 'Cancelled', bg: 'rgba(112, 119, 119, 0.25)', fg: color.silver }
};

/** What the coordinator is told once a request has been made (AC3), and
 * anything it overlaps at the venue (SG2-50 AC1). */
export function requestedNotice(venueName: string, booking: BookingReadiness, conflicts: VenueConflict[] = []): string {
  let notice = `${venueName} requested. It is pending until Venue Staff decide, and the venue is not held until then.`;
  if (booking === 'needs_capacity_exception') notice += ' A capacity exception must also be approved before it can be booked.';
  if (conflicts.length > 0) {
    notice += ` It overlaps ${conflicts.map(describeConflict).join('; ')}, so it cannot be approved while that conflict stands.`;
  }
  return notice;
}

interface RequestFormProps {
  accessToken: string;
  eventId: number;
  venue: { venue_id: number; name: string; layouts: VenueLayout[] };
  /** The searched period, `YYYY-MM-DDTHH:mm` in Singapore time. */
  period: { from: string; until: string };
  layout: Layout | '';
  venueRequirements: string | null;
  onRequested: (request: VenueRequest, booking: BookingReadiness, conflicts: VenueConflict[]) => void;
  onCancel: () => void;
}

/**
 * SG2-48 AC1: request one venue for the event, for a period and one of the
 * layouts the venue offers. The event's venue requirements go with it.
 */
export function VenueRequestForm(props: RequestFormProps) {
  const offered = props.venue.layouts.map(item => item.layout);
  if (offered.length === 0) {
    return <div style={{ display: 'grid', gap: '10px' }}>
      <p role="alert" style={{ margin: 0, color: color.silver }}>{props.venue.name} has no layouts recorded, so it cannot be requested yet.</p>
      <GhostButton onClick={props.onCancel} style={{ justifySelf: 'start' }}>Close</GhostButton>
    </div>;
  }
  // The searched layout when the venue offers it, otherwise its first.
  return <RequestFields {...props} layout={props.layout && offered.includes(props.layout) ? props.layout : offered[0]} />;
}

function RequestFields({ accessToken, eventId, venue, period, layout, venueRequirements, onRequested, onCancel }: RequestFormProps & { layout: Layout }) {
  const [values, setValues] = useState({ from: period.from, until: period.until, layout });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const id = `request-${venue.venue_id}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.from || !values.until || values.from >= values.until) {
      setError('Enter a period that starts before it ends.');
      return;
    }
    setError('');
    setSubmitting(true);
    const result = await requestVenue(accessToken, {
      event_id: eventId, venue_id: venue.venue_id, layout: values.layout,
      starts_at: sgtToIso(values.from), ends_at: sgtToIso(values.until)
    });
    setSubmitting(false);
    if (result.ok) onRequested(result.request, result.booking, result.conflicts);
    else setError(result.error);
  }

  const set = (key: 'from' | 'until' | 'layout') => (event: { target: { value: string } }) =>
    setValues(current => ({ ...current, [key]: event.target.value }));

  return <form onSubmit={submit} aria-label={`Request ${venue.name}`} style={{ display: 'grid', gap: '14px' }}>
    {([['from', 'Request from'], ['until', 'Request until']] as const).map(([key, title]) => (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
        <label htmlFor={`${id}-${key}`} style={label}>{title} (Singapore time)</label>
        <input id={`${id}-${key}`} type="datetime-local" required value={values[key]} style={inputStyle} onChange={set(key)} />
      </div>
    ))}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      <label htmlFor={`${id}-layout`} style={label}>Required layout</label>
      <select id={`${id}-layout`} value={values.layout} style={inputStyle} onChange={set('layout')}>
        {venue.layouts.map(item => <option key={item.layout} value={item.layout}>{describeLayouts([item])}</option>)}
      </select>
    </div>
    <Fact label="Venue requirements" value={venueRequirements ?? 'None recorded for this event'} />
    {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <button type="submit" disabled={submitting} style={{ border: 0, borderRadius: radius.sm, padding: '15px 22px',
        background: gradient.aurora, color: '#222', fontSize: '14px', cursor: submitting ? 'wait' : 'pointer' }}>
        {submitting ? 'Requesting…' : 'Send request'}
      </button>
      <GhostButton onClick={onCancel}>Cancel</GhostButton>
    </div>
  </form>;
}

/**
 * SG2-48 AC3/AC4: every venue requested for the event and where each stands.
 * Pending requests await Venue Staff and do not hold the venue.
 */
export function EventVenueRequests({ accessToken, eventId, eventName, refresh }: { accessToken: string; eventId: number; eventName: string; refresh: number }) {
  const [requests, setRequests] = useState<VenueRequest[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchVenueRequests(accessToken, eventId).then(result => {
      if (cancelled) return;
      if (result.ok) { setRequests(result.requests); setError(''); }
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [accessToken, eventId, refresh]);

  return <section aria-label={`Venue requests for ${eventName}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>Venue requests for {eventName}</h2>
    {error ? <p style={{ margin: 0, color: color.silver }}>{error}</p>
      : !requests ? <p style={{ margin: 0, color: color.silver }}>Loading venue requests…</p>
        : requests.length === 0 ? <p style={{ margin: 0, color: color.silver }}>No venues have been requested for this event yet.</p>
          : <div className="venue-grid">
            {requests.map(request => {
              const status = STATUS[request.status];
              return <Card key={request.request_id} padding="24px" style={{ gap: '12px', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 500, overflowWrap: 'anywhere' }}>{request.venue_name ?? `Venue #${request.venue_id}`}</h3>
                  <Badge bg={status.bg} fg={status.fg}>{status.text}</Badge>
                </div>
                <p style={{ margin: 0, color: color.silver, fontSize: '14px' }}>
                  {formatSgt(request.starts_at)} – {formatSgt(request.ends_at)} · {request.layout ? LAYOUT_LABELS[request.layout] : 'Layout not recorded'}
                </p>
                {request.status === 'pending' ? <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
                  Awaiting a Venue Staff decision. The venue is not held until the request is approved.
                </p> : null}
                <p style={{ margin: 0, color: color.slate, fontSize: '13px' }}>Requested by {request.requester_name ?? 'an unnamed account'}</p>
                {/* SG2-49 AC2/AC3: who decided, when, and why a request was rejected. */}
                {request.decided_at ? <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
                  {STATUS[request.status].text} by {request.decider_name ?? 'an unnamed account'} on {formatSgt(request.decided_at)}
                  {request.decision_reason ? <>{request.status === 'rejected' ? '. Reason: ' : '. Note: '}{request.decision_reason}</> : null}
                </p> : null}
              </Card>;
            })}
          </div>}
  </section>;
}

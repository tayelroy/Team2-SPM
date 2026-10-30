import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Card, Fact, GhostButton, Notice } from '../ui';
import { color, gradient, label, radius } from '../theme';
import { inputStyle } from './VenueForm';
import { LAYOUT_LABELS, describeLayouts, type Layout, type VenueLayout } from './layoutsApi';
import { formatSgt, sgtToIso } from './searchApi';
import {
  MAX_CHANGE_REASON, describeConflict, fetchVenueRequests, requestVenue, withdrawVenueRequest,
  type VenueArrangement, type VenueConflict, type VenueRequest
} from './requestsApi';
import type { BookingReadiness } from './suitabilityApi';

const STATUS: Record<string, { text: string; bg: string; fg: string }> = {
  pending: { text: 'Pending', bg: 'rgba(255, 180, 0, 0.16)', fg: '#fde047' },
  approved: { text: 'Approved', bg: 'rgba(0, 130, 124, 0.35)', fg: color.accent },
  rejected: { text: 'Rejected', bg: 'rgba(255, 99, 99, 0.16)', fg: '#fca5a5' },
  cancelled: { text: 'Cancelled', bg: 'rgba(112, 119, 119, 0.25)', fg: color.silver },
  // SG2-82: a cancelled request the coordinator withdrew.
  withdrawn: { text: 'Withdrawn', bg: 'rgba(112, 119, 119, 0.25)', fg: color.silver }
};

const venues = (count: number) => `${count} ${count === 1 ? 'venue' : 'venues'}`;

/** SG2-82 AC5: whether the event's venue arrangement is ready, and if not,
 * what is still holding it back. The same rule decides whether the event can
 * be confirmed (SG2-58). */
export function arrangementSummary(arrangement: VenueArrangement): string {
  if (arrangement.state === 'ready') return `Venue arrangement ready: ${arrangement.needed === 1 ? 'the venue is' : `all ${venues(arrangement.needed)} are`} approved.`;
  if (arrangement.state === 'none') return 'Venue arrangement not started: no venue requests are live for this event.';
  const outstanding = [
    arrangement.pending > 0 ? `${venues(arrangement.pending)} awaiting Venue Staff` : '',
    arrangement.rejected > 0 ? `${venues(arrangement.rejected)} rejected — request another venue, then withdraw the rejected request` : '',
    arrangement.unbooked > 0 ? `${venues(arrangement.unbooked)} approved but no longer booked` : '',
    arrangement.affected > 0 ? `${venues(arrangement.affected)} unavailable — alternative venue arrangements are required` : ''
  ].filter(Boolean);
  return `Venue arrangement not ready: ${arrangement.approved} of ${venues(arrangement.needed)} approved; ${outstanding.join('; ')}.`;
}

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
  /** SG2-48 AC1: the event's preferred layout, used when the searched one is not offered. */
  preferredLayout?: Layout | null;
  venueRequirements: string | null;
  /** SG2-81 AC4: the affected booking this request replaces, if it does.
   * SG2-83 AC1: or the current booking it changes. */
  replacesBookingId?: number;
  /** SG2-83 AC4: a change of a booking that is not affected says why. */
  changeReasonRequired?: boolean;
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
  // The searched layout when the venue offers it, else the event's preferred
  // layout when offered, otherwise the venue's first.
  const layout = [props.layout, props.preferredLayout].find((wanted): wanted is Layout => !!wanted && offered.includes(wanted)) ?? offered[0];
  return <RequestFields {...props} layout={layout} />;
}

function RequestFields({ accessToken, eventId, venue, period, layout, venueRequirements, replacesBookingId, changeReasonRequired = false,
  onRequested, onCancel }: RequestFormProps & { layout: Layout }) {
  const [values, setValues] = useState({ from: period.from, until: period.until, layout });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const id = `request-${venue.venue_id}`;
  const asksReason = replacesBookingId !== undefined && changeReasonRequired;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.from || !values.until || values.from >= values.until) {
      setError('Enter a period that starts before it ends.');
      return;
    }
    if (asksReason && !reason.trim()) {
      setError('Give a reason for changing this venue. Venue Staff will see it.');
      return;
    }
    setError('');
    setSubmitting(true);
    const result = await requestVenue(accessToken, {
      event_id: eventId, venue_id: venue.venue_id, layout: values.layout,
      starts_at: sgtToIso(values.from), ends_at: sgtToIso(values.until),
      ...(replacesBookingId === undefined ? {} : { replaces_booking_id: replacesBookingId }),
      ...(asksReason ? { change_reason: reason.trim() } : {})
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
    {replacesBookingId === undefined ? null
      : <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>This replaces booking #{replacesBookingId}, which is released once Venue Staff approve this request.</p>}
    {asksReason ? <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      <label htmlFor={`${id}-reason`} style={label}>Reason for the change</label>
      <textarea id={`${id}-reason`} rows={2} maxLength={MAX_CHANGE_REASON} value={reason} placeholder="e.g. The new seating plan needs a larger room"
        style={{ ...inputStyle, resize: 'vertical' }} onChange={event => setReason(event.target.value)} />
    </div> : null}
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

/** SG2-82 AC5: confirm withdrawing one request the event no longer needs. */
function WithdrawControl({ accessToken, request, onWithdrawn }: {
  accessToken: string; request: VenueRequest; onWithdrawn: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = request.venue_name ?? `Venue #${request.venue_id}`;

  async function confirm() {
    setBusy(true);
    const result = await withdrawVenueRequest(accessToken, request.request_id);
    setBusy(false);
    if (result.ok) onWithdrawn(`${name} withdrawn. It no longer counts towards this event's venues, and it can be requested again.`);
    else setError(result.error);
  }

  if (!confirming) {
    return <GhostButton onClick={() => setConfirming(true)} style={{ alignSelf: 'flex-start' }}>Withdraw request</GhostButton>;
  }
  return <div role="group" aria-label={`Withdraw ${name}`} style={{ display: 'grid', gap: '10px' }}>
    <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
      Withdraw this request? The event will no longer need {name}, so it stops holding the venue arrangement back.
    </p>
    {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <button type="button" disabled={busy} onClick={confirm} style={{ border: 0, borderRadius: radius.sm, padding: '13px 20px',
        background: gradient.aurora, color: '#222', fontSize: '14px', cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Withdrawing…' : 'Confirm withdrawal'}
      </button>
      <GhostButton onClick={() => { setConfirming(false); setError(''); }}>Keep request</GhostButton>
    </div>
  </div>;
}

/**
 * SG2-48 AC3/AC4: every venue requested for the event and where each stands.
 * Pending requests await Venue Staff and do not hold the venue. SG2-82: an
 * event may need several venues; the list says whether all of them are
 * approved (AC4/AC5), and a pending or rejected request the event no longer
 * needs can be withdrawn.
 */
export function EventVenueRequests({ accessToken, eventId, eventName, refresh }: { accessToken: string; eventId: number; eventName: string; refresh: number }) {
  const [loaded, setLoaded] = useState<{ requests: VenueRequest[]; arrangement: VenueArrangement } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // A successful mutation invalidates the previous list. While its replacement
    // is in flight, an old empty/ready result would contradict the saved change.
    setLoaded(null);
    setError('');
    fetchVenueRequests(accessToken, eventId).then(result => {
      if (cancelled) return;
      if (result.ok) { setLoaded({ requests: result.requests, arrangement: result.arrangement }); setError(''); }
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [accessToken, eventId, refresh, version]);

  const requests = loaded?.requests;
  return <section aria-label={`Venue requests for ${eventName}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>Venue requests for {eventName}</h2>
    {notice ? <Notice><span role="status">{notice}</span></Notice> : null}
    {error ? <p style={{ margin: 0, color: color.silver }}>{error}</p>
      : !requests ? <p style={{ margin: 0, color: color.silver }}>Loading venue requests…</p>
        : requests.length === 0 ? <p style={{ margin: 0, color: color.silver }}>No venues have been requested for this event yet.</p>
          : <>
            <p aria-label="Venue arrangement" style={{ margin: 0, fontSize: '15px',
              color: loaded!.arrangement.state === 'ready' ? color.accent : color.mist }}>
              {arrangementSummary(loaded!.arrangement)}
            </p>
            <div className="venue-grid">
              {requests.map(request => {
                const status = STATUS[request.withdrawn_at ? 'withdrawn' : request.status];
                // A withdrawn request that had been decided was rejected (approved
                // ones cannot be withdrawn); any other decided, cancelled one was
                // approved and its booking later released (SG2-51).
                const decision = request.status === 'cancelled' ? (request.withdrawn_at ? 'rejected' : 'approved') : request.status;
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
                    {STATUS[decision].text} by {request.decider_name ?? 'an unnamed account'} on {formatSgt(request.decided_at)}
                    {request.decision_reason ? <>{decision === 'rejected' ? '. Reason: ' : '. Note: '}{request.decision_reason}</> : null}
                  </p> : null}
                  {/* SG2-82 AC4: who withdrew the request and when. */}
                  {request.withdrawn_at ? <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
                    Withdrawn by {request.withdrawer_name ?? 'an unnamed account'} on {formatSgt(request.withdrawn_at)}
                  </p> : null}
                  {request.status === 'pending' || request.status === 'rejected'
                    ? <WithdrawControl accessToken={accessToken} request={request}
                        onWithdrawn={message => { setNotice(message); setVersion(value => value + 1); }} />
                    : null}
                </Card>;
              })}
            </div>
          </>}
  </section>;
}

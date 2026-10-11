import { useEffect, useState } from 'react';
import { Card, Eyebrow } from '../ui';
import { color } from '../theme';
import {
  approveCapacityException,
  fetchEventFit,
  fetchRequestFit,
  type BookingReadiness,
  type RequestFit,
  type Suitability,
  type VenueFit
} from './suitabilityApi';

const APPROVER_ROLES: Record<string, string> = {
  venue_staff: 'Venue Staff', technical_support_staff: 'Technical Support Staff', event_organiser: 'Event Organiser'
};

/** What a coordinator can do about a venue that does not fit (SG2-47). */
export function consequence(suitability: Suitability): string | null {
  const kinds = suitability.issues.map(issue => issue.kind);
  if (kinds.includes('facility')) return 'Cannot be booked: no exception is permitted for a missing facility.';
  if (kinds.includes('capacity')) return 'Can be booked only once Venue Staff, Technical Support Staff or the Event Organiser approve a capacity exception.';
  if (kinds.length > 0) return 'Raise the missing accessibility features with the organiser before booking.';
  return null;
}

/** Every reason a venue does not fit, followed by what that means for booking. */
export function FitIssues({ suitability }: { suitability: Suitability }) {
  return <div className="venue-fit-issues">
    <ul aria-label="Why this venue does not fit" style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '6px' }}>
      {suitability.issues.map(issue => <li key={issue.kind}>{issue.message}</li>)}
    </ul>
    <p style={{ margin: '10px 0 0', fontSize: '13px', color: color.silver }}>{consequence(suitability)}</p>
  </div>;
}

/**
 * Shown under a venue search opened from an event: each venue that does not
 * fit the event and why (AC1, AC2, AC4). Search hides venues that miss its
 * criteria; this says what is wrong with them. The organiser's request form
 * shows the same check for a saved draft (SG2-30).
 */
export function EventVenueFit({ accessToken, eventId, eventName }: { accessToken: string | null | undefined; eventId: number; eventName: string }) {
  const [venues, setVenues] = useState<VenueFit[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchEventFit(accessToken, eventId).then(result => {
      if (cancelled) return;
      if (result.ok) setVenues(result.venues);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [accessToken, eventId]);

  if (error) return <p style={{ margin: 0, color: color.silver }}>{error}</p>;
  if (!venues) return <p style={{ margin: 0, color: color.silver }}>Checking how venues fit this event…</p>;
  const unfit = venues.filter(venue => !venue.suitability.suitable);
  return <section aria-label={`Venues that do not fit ${eventName}`} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>
      {unfit.length === 0 ? `Every venue fits ${eventName}` : `${unfit.length} of ${venues.length} venues do not fit ${eventName}`}
    </h2>
    <div className="venue-grid">
      {unfit.map(venue => (
        <Card key={venue.venue_id} padding="24px" style={{ gap: '12px', minWidth: 0 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 500, overflowWrap: 'anywhere' }}>{venue.name}</h3>
            <Eyebrow>Capacity {venue.capacity ?? 'not recorded'}</Eyebrow>
          </div>
          <FitIssues suitability={venue.suitability} />
        </Card>
      ))}
    </div>
  </section>;
}

function approvalText(exception: RequestFit['exceptions'][number]) {
  const when = new Date(exception.approved_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false });
  return `Capacity exception for ${exception.expected_attendance} people approved by ${exception.approver_name ?? 'an unnamed account'} (${APPROVER_ROLES[exception.approver_role] ?? exception.approver_role}) on ${when}.`;
}

/**
 * On a venue booking request: whether the venue fits the event, the capacity
 * exceptions approved so far, and approval of a new one when it is needed
 * (AC3). Approving it does not approve the booking (AC5).
 */
export function BookingRequestFit({ accessToken, requestId, onReadiness }: {
  accessToken?: string | null;
  requestId: number;
  /** SG2-49: whether the booking may now be approved, as it changes. */
  onReadiness?: (booking: BookingReadiness) => void;
}) {
  const [fit, setFit] = useState<RequestFit | null>(null);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRequestFit(accessToken, requestId).then(result => {
      if (cancelled) return;
      if (result.ok) { setFit(result); onReadiness?.(result.booking); }
      else setError(result.error);
    });
    return () => { cancelled = true; };
    // onReadiness is a state setter from the parent; reloading on its identity is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, requestId]);

  async function approve() {
    setError('');
    setApproving(true);
    const result = await approveCapacityException(accessToken, requestId);
    setApproving(false);
    if (!result.ok) setError(result.error);
    // The button only shows once the fit has loaded.
    else {
      setFit(current => ({ ...current!, booking: result.booking, exceptions: [...current!.exceptions, result.exception] }));
      onReadiness?.(result.booking);
    }
  }

  return <section className="organisation-detail-footer" aria-label="Venue suitability">
    <h3>Venue suitability</h3>
    {!fit && !error && <p className="organisation-detail-hint">Checking how this venue fits the event…</p>}
    {fit && (fit.venue.suitability.suitable
      ? <p className="organisation-detail-hint">This venue fits the event.</p>
      : <FitIssues suitability={fit.venue.suitability} />)}
    {fit?.exceptions.map(exception => <p key={exception.exception_id} className="organisation-detail-hint">{approvalText(exception)}</p>)}
    {error && <p role="alert" className="work-queue-empty">{error}</p>}
    {fit?.booking === 'needs_capacity_exception' && <>
      <p className="organisation-detail-hint">Approving the exception does not approve the booking. The booking request still needs a decision.</p>
      <button type="button" className="organisation-button organisation-button-primary" style={{ alignSelf: 'flex-start' }}
        disabled={approving} onClick={approve}>{approving ? 'Approving…' : 'Approve capacity exception'}</button>
    </>}
  </section>;
}

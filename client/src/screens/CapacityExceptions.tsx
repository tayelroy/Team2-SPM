import { useEffect, useState } from 'react';
import { Card, GhostButton } from '../ui';
import { color } from '../theme';
import { BookingRequestFit } from '../venues/VenueFit';
import { fetchCapacityExceptions, type CapacityExceptionRequest } from '../venues/capacityExceptionsApi';

function period(value: string) {
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false });
}

/** Venue Staff discover an eligible request and keep its real approval receipt
 * visible until an explicit refresh (SG2-47 AC3, SG2-66 AC5). A booked venue
 * whose event's attendance was raised is marked so (SG2-66 AC2). */
export default function CapacityExceptions({ accessToken }: { accessToken: string }) {
  const [requests, setRequests] = useState<CapacityExceptionRequest[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CapacityExceptionRequest | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRequests(null);
    setError('');
    fetchCapacityExceptions(accessToken).then(result => {
      if (cancelled) return;
      if (result.ok) setRequests(result.requests);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [accessToken, revision]);

  return <section aria-label="Capacity exception requests" style={{ display: 'grid', gap: '20px', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
      <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 500 }}>Requests needing a capacity exception</h2>
      <GhostButton onClick={() => { setSelected(null); setRevision(value => value + 1); }}>Refresh requests</GhostButton>
    </div>
    <p style={{ margin: 0, color: color.silver, lineHeight: 1.6 }}>Review the venue suitability before approving an exception. An exception does not reserve the venue or approve its booking; a pending booking request still needs your decision. A venue already booked for an event whose attendance has risen needs a new exception for the revised attendance.</p>
    {!requests && !error ? <p role="status">Loading capacity exception requests…</p> : null}
    {error ? <p role="alert" className="work-queue-empty">{error}</p> : null}
    {requests?.length === 0 ? <p className="work-queue-empty">No booking requests need a capacity exception right now.</p> : null}
    <div className="venue-grid">
      {requests?.map(request => <Card key={request.request_id} padding="24px" style={{ minWidth: 0, gap: '12px', overflowWrap: 'anywhere' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>{request.event_name}</h3>
        {request.booked ? <p style={{ margin: 0, fontWeight: 500, color: color.accent }}>Booked — attendance raised</p> : null}
        <p style={{ margin: 0 }}>{request.venue_name}</p>
        <p style={{ margin: 0, color: color.silver, fontSize: '13px', lineHeight: 1.6 }}>{period(request.starts_at)} – {period(request.ends_at)} (Singapore)</p>
        <p style={{ margin: 0, color: color.silver }}>Expected attendance: {request.expected_attendance} · Venue capacity: {request.venue_capacity ?? 'not recorded'}</p>
        <button type="button" className="organisation-button organisation-button-primary" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}
          aria-pressed={selected?.request_id === request.request_id} onClick={() => setSelected(request)}>Review exception for {request.event_name} at {request.venue_name}</button>
      </Card>)}
    </div>
    {selected ? <Card padding="24px" style={{ minWidth: 0, gap: '16px', overflowWrap: 'anywhere' }}>
      <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 500 }}>{selected.event_name} · {selected.venue_name}</h2>
      <p style={{ margin: 0, color: color.silver, lineHeight: 1.6 }}>The approval receipt stays here until you refresh requests or leave this screen.</p>
      <BookingRequestFit key={selected.request_id} accessToken={accessToken} requestId={selected.request_id} />
    </Card> : null}
  </section>;
}

import { useEffect, useState } from 'react';
import { describeConflict, fetchRequestConflicts, type VenueConflict } from './requestsApi';

/**
 * SG2-50 AC1/AC2: on a venue booking request, every booking or tentative hold
 * already committing the venue over the requested period. While any stands
 * the request cannot be approved, so Venue Staff see the clash before deciding.
 */
export function BookingRequestConflicts({ accessToken, requestId }: { accessToken?: string | null; requestId: number }) {
  const [conflicts, setConflicts] = useState<VenueConflict[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchRequestConflicts(accessToken, requestId).then(result => {
      if (cancelled) return;
      if (result.ok) setConflicts(result.conflicts);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [accessToken, requestId]);

  return <section className="organisation-detail-footer" aria-label="Booking conflicts">
    <h3>Booking conflicts</h3>
    {!conflicts && !error && <p className="organisation-detail-hint">Checking for overlapping bookings…</p>}
    {error && <p className="work-queue-empty">{error}</p>}
    {conflicts?.length === 0 && <p className="organisation-detail-hint">Nothing else is booked at this venue over the requested period.</p>}
    {conflicts && conflicts.length > 0 && <>
      <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '6px', overflowWrap: 'anywhere' }}>
        {conflicts.map(conflict => <li key={`${conflict.kind}-${conflict.reference_id}`}>{describeConflict(conflict)}</li>)}
      </ul>
      <p className="organisation-detail-hint">This request cannot be approved while {conflicts.length === 1 ? 'this conflict stands' : 'these conflicts stand'}.</p>
      {/* SG2-78 AC2: clashes include the venue's setup and turnaround time. */}
      <p className="organisation-detail-hint">Clashes include the venue&apos;s setup and turnaround time, so a booking can clash even when it ends before this request starts.</p>
    </>}
  </section>;
}

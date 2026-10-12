import { useEffect, useState } from 'react';
import { describePeriod, eventLabel, fetchVenueClashes, type VenueClash } from './clashesApi';

/**
 * SG2-79 AC3: bookings that clash once their venue's setup and turnaround
 * time apply, each with the booking it clashes with. Neither booking is ever
 * changed automatically (AC2); a flag disappears once the clash is resolved
 * (AC5). Venue Staff see every flag, a coordinator their own events'.
 */
export function BookingClashes({ accessToken }: { accessToken?: string | null }) {
  const [clashes, setClashes] = useState<VenueClash[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchVenueClashes(accessToken).then(result => {
      if (cancelled) return;
      if (result.ok) setClashes(result.clashes);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [accessToken]);

  return <section className="work-queue-group" aria-label="Clashing bookings">
    <div className="work-queue-group-heading"><h3>Clashing bookings</h3><span>{clashes?.length ?? '…'}</span></div>
    <p className="work-queue-empty">
      Bookings closer together than their venue&apos;s setup and turnaround time. Neither booking has been changed:
      move or release one, or change the venue&apos;s times, to clear the flag.
    </p>
    {error ? <p role="alert" className="work-queue-empty">{error}</p>
      : !clashes ? <p className="work-queue-empty">Checking for clashing bookings…</p>
        : clashes.length === 0 ? <p className="work-queue-empty">No bookings clash once setup and turnaround time are included.</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
            {clashes.map(clash => <li key={`${clash.booking.booking_id}:${clash.clashes_with.booking_id}`}
              className="work-queue-item work-queue-flag" aria-label={`Booking #${clash.booking.booking_id}`}>
              <span className="work-queue-item-meta">
                <span className="work-queue-status">Clash</span><span>Booking #{clash.booking.booking_id}</span>
              </span>
              <strong>{clash.booking.event_name ?? (clash.booking.event_id === null ? 'Booking with no event' : `Event #${clash.booking.event_id}`)}</strong>
              <span>{clash.booking.venue_name ?? `Venue #${clash.booking.venue_id}`} · {describePeriod(clash.booking)} (SGT)</span>
              <span>Clashes with {eventLabel(clash.clashes_with)}, {describePeriod(clash.clashes_with)} (booking #{clash.clashes_with.booking_id})</span>
            </li>)}
          </ul>}
  </section>;
}

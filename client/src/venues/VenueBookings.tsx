import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Card, Eyebrow, GhostButton, Notice, RecessedCard } from '../ui';
import { color, gradient, label, radius, rule } from '../theme';
import { inputStyle } from './VenueForm';
import type { Venue } from './api';
import { formatSgt } from './searchApi';
import {
  MAX_RELEASE_REASON, fetchEventBookings, fetchVenueBookings, releaseBooking,
  type BookingsResult, type VenueBooking
} from './bookingsApi';

const STATUS: Record<string, { text: string; bg: string; fg: string }> = {
  confirmed: { text: 'Confirmed', bg: 'rgba(0, 130, 124, 0.35)', fg: color.accent },
  cancelled: { text: 'Released', bg: 'rgba(112, 119, 119, 0.25)', fg: color.silver }
};

const period = (booking: VenueBooking) => `${formatSgt(booking.starts_at)} – ${formatSgt(booking.ends_at)}`;

/** SG2-51 AC1: release one booking, giving a reason. */
function ReleaseForm({ booking, accessToken, onReleased, onCancel }: {
  booking: VenueBooking; accessToken: string | null | undefined;
  onReleased: (message: string) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `release-${booking.booking_id}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!reason.trim()) {
      setError('Give a reason for releasing this booking. The coordinator and Event Organiser will see it.');
      return;
    }
    setError('');
    setBusy(true);
    const result = await releaseBooking(accessToken, booking.booking_id, reason);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    const released = `${booking.venue_name ?? 'The venue'} released for ${period(booking)}. It is available again`;
    // Only a booking for an event has a coordinator and organiser to tell.
    onReleased(booking.event_id === null ? `${released}.` : `${released}, and the coordinator and Event Organiser have been notified.`);
  }

  return <form onSubmit={submit} aria-label={`Release booking #${booking.booking_id}`} style={{ display: 'grid', gap: '10px', width: '100%' }}>
    <label htmlFor={id} style={label}>Reason for releasing</label>
    <textarea id={id} rows={3} maxLength={MAX_RELEASE_REASON} value={reason} placeholder="e.g. The event moved to another venue"
      style={{ ...inputStyle, resize: 'vertical' }} onChange={event => setReason(event.target.value)} />
    {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <button type="submit" disabled={busy} style={{ border: 0, borderRadius: radius.sm, padding: '13px 20px',
        background: gradient.aurora, color: '#222', fontSize: '14px', cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Releasing…' : 'Confirm release'}
      </button>
      <GhostButton onClick={onCancel}>Keep booking</GhostButton>
    </div>
  </form>;
}

/**
 * SG2-51: bookings with their status, each confirmed one releasable with a
 * reason; released ones say who released them, when and why (AC5).
 */
function BookingList({ accessToken, load, refresh, describe, empty, label: listLabel, onReleased }: {
  accessToken: string | null | undefined;
  load: () => Promise<BookingsResult<{ bookings: VenueBooking[] }>>;
  refresh: number;
  describe: (booking: VenueBooking) => string;
  empty: string;
  label: string;
  /** After a release, e.g. so the event's requests show the request as cancelled. */
  onReleased?: () => void;
}) {
  const [bookings, setBookings] = useState<VenueBooking[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [releasing, setReleasing] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(result => {
      if (cancelled) return;
      if (result.ok) { setBookings(result.bookings); setError(''); }
      else setError(result.error);
    });
    return () => { cancelled = true; };
    // load is rebuilt each render; the caller's ids and refresh decide when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, refresh, version, listLabel]);

  return <section aria-label={listLabel} style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
    {notice ? <Notice><span role="status">{notice}</span></Notice> : null}
    {error ? <p style={{ margin: 0, color: color.silver }}>{error}</p>
      : !bookings ? <p role="status" style={{ margin: 0, color: color.silver }}>Loading bookings…</p>
        : bookings.length === 0 ? <p style={{ margin: 0, color: color.silver, fontSize: '14px' }}>{empty}</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
            {bookings.map(booking => {
              const status = STATUS[booking.status] ?? { text: booking.status, bg: 'transparent', fg: color.silver };
              const releasable = booking.status === 'confirmed' && Date.parse(booking.ends_at) > Date.now();
              return <li key={booking.booking_id} aria-label={`Booking #${booking.booking_id}`}
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '12px', borderBottom: rule.edge, overflowWrap: 'anywhere' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span style={{ color: color.mist, fontSize: '15px' }}>{describe(booking)}</span>
                  <Badge bg={status.bg} fg={status.fg}>{status.text}</Badge>
                </div>
                <span style={{ color: color.silver, fontSize: '13px' }}>{period(booking)} · Booking #{booking.booking_id}</span>
                {booking.status === 'cancelled' ? <span style={{ color: color.silver, fontSize: '13px' }}>
                  Released by {booking.canceller_name ?? 'an unnamed account'}{booking.cancelled_at ? ` on ${formatSgt(booking.cancelled_at)}` : ''}: {booking.cancellation_reason}
                </span> : null}
                {releasable ? (releasing === booking.booking_id
                  ? <ReleaseForm booking={booking} accessToken={accessToken} onCancel={() => setReleasing(null)}
                      onReleased={message => { setReleasing(null); setNotice(message); setVersion(value => value + 1); onReleased?.(); }} />
                  : <GhostButton onClick={() => { setNotice(''); setReleasing(booking.booking_id); }} style={{ alignSelf: 'flex-start' }}>
                      Release booking
                    </GhostButton>) : null}
              </li>;
            })}
          </ul>}
  </section>;
}

/** SG2-51 AC3: every venue booked for the event, each released on its own. */
export function EventVenueBookings({ accessToken, eventId, eventName, refresh, onReleased }: {
  accessToken: string; eventId: number; eventName: string; refresh: number; onReleased?: () => void;
}) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>Booked venues for {eventName}</h2>
    <BookingList accessToken={accessToken} refresh={refresh} label={`Booked venues for ${eventName}`}
      load={() => fetchEventBookings(accessToken, eventId)}
      describe={booking => booking.venue_name ?? `Venue #${booking.venue_id}`}
      empty="No venues are booked for this event yet." onReleased={onReleased} />
  </div>;
}

/** SG2-51: Venue Staff see a venue's upcoming bookings and release one. */
export default function VenueBookings({ token, venue, onClose }: { token: string | null; venue: Venue; onClose: () => void }) {
  return <div className="venue-editor">
    <Card padding="clamp(20px, 4vw, 36px)" style={{ gap: '24px', minWidth: 0 }}>
      <div>
        <Eyebrow>Venue bookings</Eyebrow>
        <h2 style={{ fontSize: '28px', fontWeight: 500, letterSpacing: '-0.03em', margin: '10px 0 0', overflowWrap: 'anywhere' }}>
          Bookings for {venue.name}
        </h2>
      </div>
      <BookingList accessToken={token} refresh={0} label={`Upcoming bookings for ${venue.name}`}
        load={() => fetchVenueBookings(token, venue.venue_id)}
        describe={booking => booking.event_name ?? (booking.event_id === null ? 'No event recorded' : `Event #${booking.event_id}`)}
        empty={`No upcoming bookings for ${venue.name}.`} />
      <GhostButton onClick={onClose} style={{ alignSelf: 'flex-start' }}>Back to catalogue</GhostButton>
    </Card>
    <RecessedCard padding="28px" style={{ gap: '14px', alignSelf: 'start' }}>
      <Eyebrow>Releasing a booking</Eyebrow>
      <p style={{ margin: 0, color: color.silver, fontSize: '14px', lineHeight: 1.6 }}>
        A released booking frees the venue for that period straight away. The event&apos;s other venues are not affected.
        The coordinator and the Event Organiser are told, with your reason, and the release is kept in the event&apos;s history.
      </p>
    </RecessedCard>
  </div>;
}

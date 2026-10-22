import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Card, Eyebrow, GhostButton, Notice, RecessedCard } from '../ui';
import { color, gradient, label, radius, rule } from '../theme';
import { inputStyle } from './VenueForm';
import type { Venue } from './api';
import { formatSgt } from './searchApi';
import { UNAVAILABILITY_CATEGORIES } from './blocksApi';
import {
  MAX_RELEASE_REASON, fetchEventBookings, fetchVenueBookings, releaseBooking,
  type BookingsResult, type VenueBooking
} from './bookingsApi';

const STATUS: Record<string, { text: string; bg: string; fg: string }> = {
  confirmed: { text: 'Confirmed', bg: 'rgba(0, 130, 124, 0.35)', fg: color.accent },
  cancelled: { text: 'Released', bg: 'rgba(112, 119, 119, 0.25)', fg: color.silver }
};

const period = (booking: VenueBooking) => `${formatSgt(booking.starts_at)} – ${formatSgt(booking.ends_at)}`;

const venueName = (booking: VenueBooking) => booking.venue_name ?? `Venue #${booking.venue_id}`;

/**
 * SG2-51 AC1: release one booking, giving a reason. SG2-83 AC1/AC2: the
 * event's other venues stay booked unless the coordinator ticks them too.
 */
function ReleaseForm({ booking, others, accessToken, onReleased, onCancel }: {
  booking: VenueBooking; others: VenueBooking[]; accessToken: string | null | undefined;
  onReleased: (message: string) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [also, setAlso] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `release-${booking.booking_id}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!reason.trim()) {
      setError('Give a reason for releasing this booking. The Event Organiser and Venue Staff will see it.');
      return;
    }
    setError('');
    setBusy(true);
    const result = await releaseBooking(accessToken, booking.booking_id, reason, also);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    const count = result.released.also_released.length;
    const released = `${venueName(booking)} released for ${period(booking)}`
      + (count === 0 ? '. It is' : `, with ${count} other ${count === 1 ? 'venue' : 'venues'}. They are`)
      + ' available again, and the Event Organiser and Venue Staff have been notified.';
    // SG2-83 AC7: a Confirmed or Preparation event goes back through its checks.
    onReleased(result.released.returned_to_planning
      ? `${released} The event is back in Planning: recheck its venues before it is confirmed again.`
      : `${released}${others.length > count ? ' The event\'s other venues are unchanged.' : ''}`);
  }

  const toggle = (bookingId: number) => setAlso(current =>
    current.includes(bookingId) ? current.filter(item => item !== bookingId) : [...current, bookingId]);

  return <form onSubmit={submit} aria-label={`Release booking #${booking.booking_id}`} style={{ display: 'grid', gap: '10px', width: '100%' }}>
    <label htmlFor={id} style={label}>Reason for releasing</label>
    <textarea id={id} rows={3} maxLength={MAX_RELEASE_REASON} value={reason} placeholder="e.g. The event moved to another venue"
      style={{ ...inputStyle, resize: 'vertical' }} onChange={event => setReason(event.target.value)} />
    {others.length > 0 ? <fieldset style={{ border: rule.edge, borderRadius: radius.sm, padding: '10px 12px', margin: 0, display: 'grid', gap: '8px', minWidth: 0 }}>
      <legend style={{ ...label, padding: '0 4px' }}>Also cancel (optional)</legend>
      <span style={{ color: color.silver, fontSize: '13px' }}>The event&apos;s other venues stay booked unless you tick them.</span>
      {others.map(other => <label key={other.booking_id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', color: color.mist, fontSize: '14px' }}>
        <input type="checkbox" checked={also.includes(other.booking_id)} onChange={() => toggle(other.booking_id)} />
        <span>{venueName(other)} · {period(other)} · Booking #{other.booking_id}</span>
      </label>)}
    </fieldset> : null}
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
 * SG2-51: bookings with their status; released ones say who released them,
 * when and why (AC5). SG2-83 AC5: only the event's coordinator (canRelease)
 * releases or changes a confirmed one.
 */
function BookingList({ accessToken, load, refresh, describe, empty, label: listLabel, canRelease = false, onReleased, onFindReplacement }: {
  accessToken: string | null | undefined;
  load: () => Promise<BookingsResult<{ bookings: VenueBooking[] }>>;
  refresh: number;
  describe: (booking: VenueBooking) => string;
  empty: string;
  label: string;
  canRelease?: boolean;
  /** After a release, e.g. so the event's requests show the request as cancelled. */
  onReleased?: () => void;
  /** SG2-81 AC4: offered on a booking a venue's unavailability affects.
   * SG2-83 AC1: and as a change on any other current booking. */
  onFindReplacement?: (booking: VenueBooking) => void;
}) {
  const [bookings, setBookings] = useState<VenueBooking[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [releasing, setReleasing] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // A refreshed search invalidates even a previously empty booking list.
    setBookings(null);
    setError('');
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
              const current = (item: VenueBooking) => item.status === 'confirmed' && Date.parse(item.ends_at) > Date.now();
              const releasable = canRelease && current(booking);
              const affected = booking.status === 'confirmed' && booking.affected_by.length > 0;
              return <li key={booking.booking_id} aria-label={`Booking #${booking.booking_id}`}
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '12px', borderBottom: rule.edge, overflowWrap: 'anywhere' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span style={{ color: color.mist, fontSize: '15px' }}>{describe(booking)}</span>
                  <Badge bg={status.bg} fg={status.fg}>{status.text}</Badge>
                </div>
                <span style={{ color: color.silver, fontSize: '13px' }}>{period(booking)} · Booking #{booking.booking_id}</span>
                {affected ? <div role="alert" aria-label={`Booking #${booking.booking_id} is affected by venue unavailability`}
                  style={{ display: 'grid', gap: '6px', padding: '10px 12px', borderRadius: radius.sm, border: rule.edge }}>
                  <strong style={{ color: color.mist, fontSize: '14px' }}>Venue unavailable</strong>
                  {booking.affected_by.map(period => <span key={period.starts_at} style={{ color: color.silver, fontSize: '13px' }}>
                    {formatSgt(period.starts_at)} – {formatSgt(period.ends_at)} · {(UNAVAILABILITY_CATEGORIES as Record<string, string>)[period.category] ?? period.category}: {period.reason}
                  </span>)}
                  <span style={{ color: color.mist, fontSize: '13px' }}>Alternative venue arrangements are required for this booking.</span>
                  {booking.replacement
                    ? <span style={{ color: color.silver, fontSize: '13px' }}>
                      Replacement requested: {booking.replacement.venue_name ?? `request #${booking.replacement.request_id}`}, awaiting Venue Staff.
                    </span>
                    : onFindReplacement
                      ? <GhostButton onClick={() => onFindReplacement(booking)} style={{ justifySelf: 'start' }}>Find a replacement venue</GhostButton>
                      : null}
                </div> : null}
                {booking.status === 'cancelled' ? <span style={{ color: color.silver, fontSize: '13px' }}>
                  Released by {booking.canceller_name ?? 'an unnamed account'}{booking.cancelled_at ? ` on ${formatSgt(booking.cancelled_at)}` : ''}: {booking.cancellation_reason}
                </span> : null}
                {/* SG2-83 AC1: change one venue; it stays booked until Venue Staff approve the change. */}
                {releasable && !affected && booking.replacement ? <span style={{ color: color.silver, fontSize: '13px' }}>
                  Change requested: {booking.replacement.venue_name ?? `request #${booking.replacement.request_id}`}, awaiting Venue Staff. This booking stays until then.
                </span> : null}
                {releasable ? (releasing === booking.booking_id
                  ? <ReleaseForm booking={booking} others={bookings.filter(other => other.booking_id !== booking.booking_id && current(other))}
                      accessToken={accessToken} onCancel={() => setReleasing(null)}
                      onReleased={message => { setReleasing(null); setNotice(message); setVersion(value => value + 1); onReleased?.(); }} />
                  : <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <GhostButton onClick={() => { setNotice(''); setReleasing(booking.booking_id); }}>Release booking</GhostButton>
                    {onFindReplacement && !affected && !booking.replacement
                      ? <GhostButton onClick={() => onFindReplacement(booking)}>Change venue</GhostButton> : null}
                  </div>) : null}
              </li>;
            })}
          </ul>}
  </section>;
}

/** SG2-51 AC3: every venue booked for the event, each released or (SG2-83)
 * changed on its own by the event's coordinator. */
export function EventVenueBookings({ accessToken, eventId, eventName, refresh, onReleased, onFindReplacement }: {
  accessToken: string; eventId: number; eventName: string; refresh: number; onReleased?: () => void;
  onFindReplacement?: (booking: VenueBooking) => void;
}) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>Booked venues for {eventName}</h2>
    <BookingList accessToken={accessToken} refresh={refresh} label={`Booked venues for ${eventName}`}
      load={() => fetchEventBookings(accessToken, eventId)}
      describe={booking => booking.venue_name ?? `Venue #${booking.venue_id}`}
      empty="No venues are booked for this event yet." canRelease onReleased={onReleased} onFindReplacement={onFindReplacement} />
  </div>;
}

/** SG2-51: Venue Staff see a venue's upcoming bookings. SG2-83 AC5: they no
 * longer release one; they mark the venue unavailable (SG2-80) instead. */
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
      <Eyebrow>Cancelling a booking</Eyebrow>
      <p style={{ margin: 0, color: color.silver, fontSize: '14px', lineHeight: 1.6 }}>
        Only the event&apos;s coordinator cancels or changes a booking, and you are notified when they do.
        If the venue cannot be used, mark it unavailable for that period instead: the coordinator is told and finds a replacement.
      </p>
    </RecessedCard>
  </div>;
}

import { useEffect, useState } from 'react';
import { EventConfirmationError, loadEventConfirmation, type ConfirmationView, type RegistrationWindow } from '../api/eventConfirmation';
import { formatSgtTimestamp } from './EventAuditDrawer';
import { Card, Fact, GhostButton } from '../ui';

type Props = { eventId: number; accessToken: string };

const WINDOW_TEXT: Record<Exclude<RegistrationWindow, 'not_required'>, string> = {
  not_confirmed: 'Registration opens once the event is confirmed.',
  not_yet_open: 'Registration has not opened yet.',
  open: 'Registration is open. Attendees can register now.',
  closed: 'Registration has closed.',
};
const wrap = { minWidth: 0, overflowWrap: 'anywhere' } as const;

/** SG2-58 AC1/AC3: what the organiser and the coordinator see once an event is confirmed. */
export default function ConfirmedArrangements(props: Props) {
  return <Arrangements key={`${props.eventId}:${props.accessToken}`} {...props} />;
}

function Arrangements({ eventId, accessToken }: Props) {
  const [view, setView] = useState<ConfirmationView | null>(null);
  const [failure, setFailure] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setView(null); setFailure(null);
    void loadEventConfirmation(eventId, accessToken, controller.signal).then(result => {
      if (!controller.signal.aborted) setView(result);
    }).catch(error => {
      if (!controller.signal.aborted) setFailure(error instanceof EventConfirmationError ? error.status : 0);
    });
    return () => controller.abort();
  }, [eventId, accessToken, attempt]);
  // 404: not confirmed for this caller, so there is nothing to show.
  if (failure === 404) return null;
  return <section className="organisation-detail-confirmed" aria-label="Confirmed arrangements" style={{ display: 'grid', gap: '16px', ...wrap }}>
    <h3 style={{ margin: 0 }}>Confirmed arrangements</h3>
    {failure !== null ? <div>
      <p role="alert">Confirmed arrangements could not be loaded. Please try again.</p>
      <GhostButton onClick={() => setAttempt(value => value + 1)}>Retry</GhostButton>
    </div> : !view ? <p role="status">Loading confirmed arrangements…</p> : <Card padding="clamp(16px, 3vw, 28px)" style={{ gap: '12px', ...wrap }}>
      {view.confirmed_at ? <Fact label="Confirmed at" value={formatSgtTimestamp(view.confirmed_at)} /> : null}
      <h4 style={{ margin: 0 }}>Venues</h4>
      {view.venues.length === 0 ? <p>No venue bookings recorded.</p> : <ul style={wrap}>
        {view.venues.map(venue => <li key={`${venue.venue_name}:${venue.starts_at}`}>
          {venue.venue_name}: {formatSgtTimestamp(venue.starts_at)} – {formatSgtTimestamp(venue.ends_at)}
        </li>)}
      </ul>}
      <h4 style={{ margin: 0 }}>Equipment</h4>
      {view.equipment.length === 0 ? <p>No equipment reserved.</p> : <ul style={wrap}>
        {view.equipment.map((item, index) => <li key={index}>{item.quantity_reserved} × {item.equipment_type}</li>)}
      </ul>}
      <h4 style={{ margin: 0 }}>Registration</h4>
      <Registration registration={view.registration} />
    </Card>}
  </section>;
}

function Registration({ registration }: { registration: ConfirmationView['registration'] }) {
  if (!registration.needed || registration.window === 'not_required') return <p>Registration is not required for this event.</p>;
  return <>
    <Fact label="Capacity" value={registration.capacity === null ? 'Not set' : String(registration.capacity)} />
    <Fact label="Opens" value={registration.opens_at ? formatSgtTimestamp(registration.opens_at) : 'Not set'} />
    <Fact label="Closes" value={registration.closes_at ? formatSgtTimestamp(registration.closes_at) : 'Not set'} />
    <p>{WINDOW_TEXT[registration.window]}</p>
  </>;
}

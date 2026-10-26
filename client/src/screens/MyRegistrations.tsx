import { useEffect, useRef, useState } from 'react';
import { categoryLabel } from '../api/eventRequests';
import { fetchMyRegistrations, withdrawRegistration, type MyRegistration, type RegistrationStanding } from '../api/myRegistrations';
import { color, gradient, radius } from '../theme';
import { Badge, Card, Fact, GhostButton, Notice } from '../ui';
import { formatSgt } from '../venues/searchApi';

const NOT_ANNOUNCED = 'To be announced';
const UNAVAILABLE = 'Your registrations are temporarily unavailable. Please try again.';
const UNAUTHORIZED = 'Only attendees can see registrations here. Sign in again if your role has changed.';

type ListState =
  | { kind: 'loading' }
  | { kind: 'loaded'; registrations: MyRegistration[] }
  | { kind: 'error'; message: string; retry: boolean };

/** AC1: where each registration stands, as a short badge. */
export const STANDING: Record<RegistrationStanding, { label: string; bg: string; fg: string }> = {
  registered: { label: 'Registered', bg: color.teal, fg: color.abyss },
  withdrawn: { label: 'Withdrawn', bg: 'rgba(112,119,119,0.35)', fg: color.silver },
  event_cancelled: { label: 'Event cancelled', bg: 'rgba(112,119,119,0.35)', fg: color.silver },
  event_started: { label: 'Event started', bg: 'rgba(112,119,119,0.35)', fg: color.mist },
  event_completed: { label: 'Event completed', bg: 'rgba(112,119,119,0.35)', fg: color.mist },
};

function venueNames(registration: MyRegistration): string {
  return registration.event.venues.length ? registration.event.venues.map((venue) => venue.name).join(', ') : NOT_ANNOUNCED;
}

/**
 * AC2: withdraw after confirming. On success the list is reloaded so the
 * registration shows as withdrawn; a refusal (AC4: the event has started)
 * is shown where the button was.
 */
function WithdrawControl({ registration, accessToken, onWithdrawn }: {
  registration: MyRegistration; accessToken: string; onWithdrawn: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const title = registration.event.name.trim() || 'Untitled event';

  async function confirm() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await withdrawRegistration(registration.registrationId, accessToken);
    sending.current = false;
    setBusy(false);
    if (result.ok) onWithdrawn(`You have withdrawn from ${title}. Your place has been given back.`);
    else if (result.kind === 'started' || result.kind === 'withdrawn' || result.kind === 'cancelled') setError(result.message);
    else if (result.kind === 'not_found') setError('This registration was not found. Refresh the list.');
    else setError(result.kind === 'unauthorized' ? UNAUTHORIZED : 'The withdrawal could not be completed. Please try again.');
  }

  if (!confirming) {
    return <div><GhostButton onClick={() => setConfirming(true)}>Withdraw</GhostButton></div>;
  }
  return (
    <div role="group" aria-label={`Withdraw from ${title}`} style={{ display: 'grid', gap: '10px' }}>
      <p style={{ margin: 0, color: color.silver }}>
        Withdraw from {title}? Your place goes back to the event and someone else can take it. You can register again only while registration is open and places remain.
      </p>
      {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => void confirm()} style={{ border: 0, borderRadius: radius.sm, padding: '13px 20px',
          background: gradient.aurora, color: '#222', fontSize: '14px', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Withdrawing…' : 'Confirm withdrawal'}
        </button>
        <GhostButton onClick={() => { setConfirming(false); setError(''); }}>Keep my place</GhostButton>
      </div>
    </div>
  );
}

/**
 * SG2-62: an attendee sees every event they registered for, with its date,
 * time, venue and host and where the registration stands (AC1), and can
 * withdraw an active one before the event starts, after confirming, even
 * once registration has closed (AC2). The place goes back to the event (AC3);
 * once the event has started the server refuses and says so (AC4).
 */
export default function MyRegistrations({ accessToken }: { accessToken: string }) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setList({ kind: 'loading' });
    fetchMyRegistrations(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setList({ kind: 'loaded', registrations: result.registrations });
      else if (result.kind === 'unauthorized') setList({ kind: 'error', message: UNAUTHORIZED, retry: false });
      else setList({ kind: 'error', message: UNAVAILABLE, retry: true });
    });
    return () => { cancelled = true; };
  }, [accessToken, attempt]);

  return (
    <section aria-label="My registrations" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {notice ? <Notice role="status"><p style={{ margin: 0 }}>{notice}</p></Notice> : null}

      {list.kind === 'loading' ? <p role="status">Loading your registrations…</p> : null}

      {list.kind === 'error' ? (
        <Notice>
          <p role="alert">{list.message}</p>
          {list.retry ? <GhostButton onClick={() => setAttempt((count) => count + 1)}>Retry</GhostButton> : null}
        </Notice>
      ) : null}

      {list.kind === 'loaded' && list.registrations.length === 0 ? (
        <Card style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No registrations yet</h2>
          <p style={{ margin: 0, color: color.silver }}>Events you register for from Find events appear here.</p>
        </Card>
      ) : null}

      {list.kind === 'loaded' && list.registrations.length > 0 ? (
        <section aria-label="Registrations" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {list.registrations.map((registration) => {
            const { event } = registration;
            const title = event.name.trim() || 'Untitled event';
            const titleId = `my-registration-${registration.registrationId}`;
            const standing = STANDING[registration.standing];
            return (
              <Card key={registration.registrationId} padding="24px 28px" style={{ gap: '16px' }}>
                <article aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                    <h3 id={titleId} style={{ margin: 0, fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</h3>
                    <Badge bg={standing.bg} fg={standing.fg}>{standing.label}</Badge>
                  </div>
                  {event.description?.trim() ? (
                    <p style={{ margin: 0, lineHeight: 1.5, color: color.silver, overflowWrap: 'anywhere' }}>{event.description.trim()}</p>
                  ) : null}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }}>
                    <Fact label="Date and time" value={event.proposedDate ? formatSgt(event.proposedDate) : NOT_ANNOUNCED} />
                    <Fact label="Venue" value={venueNames(registration)} />
                    <Fact label="Hosted by" value={event.organisation ?? NOT_ANNOUNCED} />
                    <Fact label="Category" value={categoryLabel(event.category)} />
                    <Fact label={registration.withdrawnAt ? 'Withdrawn' : 'Registered'}
                      value={registration.withdrawnAt ? formatSgt(registration.withdrawnAt)
                        : registration.registeredAt ? formatSgt(registration.registeredAt) : NOT_ANNOUNCED} />
                    <Fact label="Contact phone" value={registration.contactPhone ?? 'From your profile'} />
                  </div>
                  {registration.needs ? <Fact label="Accessibility or dietary needs" value={registration.needs} /> : null}
                  {registration.canWithdraw ? (
                    <WithdrawControl registration={registration} accessToken={accessToken}
                      onWithdrawn={(message) => { setNotice(message); setAttempt((count) => count + 1); }} />
                  ) : null}
                </article>
              </Card>
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

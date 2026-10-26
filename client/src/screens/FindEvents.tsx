import { useEffect, useRef, useState } from 'react';
import { categoryLabel } from '../api/eventRequests';
import { fetchProfile } from '../api/profile';
import {
  fetchRegistrableEvent,
  fetchRegistrableEvents,
  registerForEvent,
  type RegistrableEvent,
} from '../api/registrableEvents';
import { color } from '../theme';
import { Badge, Card, Fact, Field, GhostButton, GradientButton, Notice, TextField } from '../ui';
import { formatSgt } from '../venues/searchApi';

const NOT_ANNOUNCED = 'To be announced';
const UNAVAILABLE = 'Events are temporarily unavailable. Please try again.';
const UNAUTHORIZED = 'Only attendees can browse events here. Sign in again if your role has changed.';
/** SG2-60 AC4: SG2-27's phone rule, and the longest needs note. */
const SINGAPORE_PHONE = /^(?:\+65)?[0-9]{8}$/;
const MAX_PHONE_LENGTH = 40;
export const MAX_NEEDS_LENGTH = 500;

type ListState =
  | { kind: 'loading' }
  | { kind: 'loaded'; events: RegistrableEvent[] }
  | { kind: 'error'; message: string; retry: boolean };

type DetailState =
  | { kind: 'loading' }
  | { kind: 'loaded'; event: RegistrableEvent }
  | { kind: 'error'; message: string };

/**
 * Where registration stands for a listed event: open (closing at a time) or
 * opening later (SG2-59 AC1; the server lists nothing else). `label` is the
 * short badge; `when` gives the time.
 */
export function registrationState(event: RegistrableEvent, now: number): { label: string; when: string; open: boolean } {
  const opens = event.registrationOpensAt ? Date.parse(event.registrationOpensAt) : NaN;
  if (event.registrationOpensAt && now < opens) {
    return { label: 'Opening soon', when: `Opens ${formatSgt(event.registrationOpensAt)}`, open: false };
  }
  return {
    label: 'Registration open',
    when: event.registrationClosesAt ? `Closes ${formatSgt(event.registrationClosesAt)}` : 'Open now',
    open: true,
  };
}

/**
 * SG2-60 AC4: what is wrong with the details before they are sent; the server
 * checks the same rules again. Empty when they can be sent.
 */
export function registrationProblems(phone: string, needs: string): string[] {
  const problems: string[] = [];
  const trimmed = phone.trim();
  if (trimmed === '') problems.push('Enter a contact phone number.');
  else if (trimmed.length > MAX_PHONE_LENGTH || !SINGAPORE_PHONE.test(trimmed.replace(/[()\-.\s]/g, ''))) {
    problems.push('Enter a Singapore phone number with 8 digits, optionally starting with +65.');
  }
  if (needs.trim().length > MAX_NEEDS_LENGTH) problems.push(`Keep accessibility or dietary needs to ${MAX_NEEDS_LENGTH} characters.`);
  return problems;
}

function venueNames(event: RegistrableEvent): string {
  return event.venues.length ? event.venues.map((venue) => venue.name).join(', ') : NOT_ANNOUNCED;
}

function StateBadge({ event }: { event: RegistrableEvent }) {
  const state = registrationState(event, Date.now());
  return (
    <Badge bg={state.open ? color.teal : 'rgba(112,119,119,0.35)'} fg={state.open ? color.abyss : color.silver}>
      {state.label}
    </Badge>
  );
}

type Registering =
  | { kind: 'form'; problems: string[]; message: string | null }
  | { kind: 'sending' }
  /** The place is held: just now, or it already was (AC2). */
  | { kind: 'registered'; message: string }
  /** Refused for good on this screen: full, closed, or no longer open (AC1, AC3). */
  | { kind: 'refused'; message: string };

const REGISTERED = 'You are registered. Your place is held.';

/**
 * SG2-60: register for an open event with a contact phone (filled in from the
 * profile) and any accessibility or dietary needs (AC4). Confirms the place
 * with the event's date, time and venue (AC1); an event already registered
 * for shows that instead of the form (AC2); one not yet open says when it
 * opens (AC3).
 */
function RegisterSection({ event, accessToken }: { event: RegistrableEvent; accessToken: string }) {
  const [phone, setPhone] = useState('');
  const [needs, setNeeds] = useState('');
  const [state, setState] = useState<Registering>(
    event.registered ? { kind: 'registered', message: 'You are already registered for this event.' } : { kind: 'form', problems: [], message: null });
  const sending = useRef(false);
  const opening = registrationState(event, Date.now());
  const showForm = opening.open && !event.registered;

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    // A profile phone saves typing; without one the attendee enters it.
    fetchProfile().then((result) => {
      if (!cancelled && result.ok && result.profile.phone) setPhone((current) => current || result.profile.phone!);
    });
    return () => { cancelled = true; };
  }, [showForm]);

  async function submit() {
    if (sending.current) return;
    const problems = registrationProblems(phone, needs);
    if (problems.length) {
      setState({ kind: 'form', problems, message: null });
      return;
    }
    sending.current = true;
    setState({ kind: 'sending' });
    const result = await registerForEvent(event.eventId, { contactPhone: phone, needs }, accessToken);
    sending.current = false;
    if (result.ok) setState({ kind: 'registered', message: REGISTERED });
    else if (result.kind === 'duplicate') setState({ kind: 'registered', message: result.message });
    else if (result.kind === 'full' || result.kind === 'closed' || result.kind === 'not_open') setState({ kind: 'refused', message: result.message });
    else if (result.kind === 'not_found') setState({ kind: 'refused', message: 'This event is no longer open for registration.' });
    else if (result.kind === 'invalid') setState({ kind: 'form', problems: result.errors, message: result.message });
    else setState({ kind: 'form', problems: [], message: result.kind === 'unauthorized' ? UNAUTHORIZED : 'Registration could not be completed. Please try again.' });
  }

  const heading = <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 500 }}>Registration</h3>;
  if (state.kind === 'registered') {
    return (
      <section aria-label="Registration" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {heading}
        <Notice role="status">
          <p style={{ margin: 0, fontSize: '16px', color: color.mist }}>{state.message}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }}>
            <Fact label="When" value={event.proposedDate ? formatSgt(event.proposedDate) : NOT_ANNOUNCED} />
            <Fact label="Where" value={venueNames(event)} />
          </div>
          <p style={{ margin: 0, color: color.silver }}>A confirmation is in your notifications.</p>
        </Notice>
      </section>
    );
  }
  if (state.kind === 'refused') {
    return (
      <section aria-label="Registration" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {heading}
        <Notice><p role="alert" style={{ margin: 0 }}>{state.message}</p></Notice>
      </section>
    );
  }
  if (!opening.open) {
    return (
      <section aria-label="Registration" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {heading}
        <p style={{ margin: 0, color: color.silver }}>Registration opens {formatSgt(event.registrationOpensAt!)}. Come back then to register.</p>
      </section>
    );
  }

  const problems = state.kind === 'form' ? state.problems : [];
  const message = state.kind === 'form' ? state.message : null;
  return (
    <section aria-label="Registration" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {heading}
      <p style={{ margin: 0, color: color.silver }}>Your name and email come from your account.</p>
      <Field label="Contact phone" type="tel" value={phone} onChange={setPhone}
        hint="Required. A Singapore number with 8 digits, optionally starting with +65." />
      <TextField label="Accessibility or dietary needs (optional)" value={needs} onChange={setNeeds} rows={3} />
      <span style={{ fontSize: '12px', color: needs.trim().length > MAX_NEEDS_LENGTH ? color.accent : color.slate }}>
        {needs.trim().length}/{MAX_NEEDS_LENGTH} characters
      </span>
      {message || problems.length ? (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: color.mist }}>
          {message ? <p style={{ margin: 0 }}>{message}</p> : null}
          {problems.length ? (
            <ul style={{ margin: 0, paddingLeft: '20px' }}>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      <div>
        <GradientButton onClick={() => void submit()} disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Registering…' : 'Register'}
        </GradientButton>
      </div>
    </section>
  );
}

function EventDetails({ eventId, accessToken, onBack }: { eventId: number; accessToken: string; onBack: () => void }) {
  const [state, setState] = useState<DetailState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchRegistrableEvent(eventId, accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setState({ kind: 'loaded', event: result.event });
      else if (result.kind === 'not_found') setState({ kind: 'error', message: 'This event is no longer open for registration.' });
      else setState({ kind: 'error', message: result.kind === 'unauthorized' ? UNAUTHORIZED : UNAVAILABLE });
    });
    return () => { cancelled = true; };
  }, [eventId, accessToken]);

  const back = <div><GhostButton onClick={onBack}>Back to events</GhostButton></div>;
  if (state.kind === 'loading') return <p role="status">Loading event…</p>;
  if (state.kind === 'error') {
    return (
      <Notice>
        <p role="alert">{state.message}</p>
        {back}
      </Notice>
    );
  }

  const { event } = state;
  const title = event.name.trim() || 'Untitled event';
  return (
    <Card style={{ gap: '24px' }}>
      <article aria-labelledby="find-events-detail-title" style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
        {back}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
          <h2 id="find-events-detail-title" style={{ margin: 0, fontSize: '32px', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</h2>
          <StateBadge event={event} />
        </div>
        <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.5, color: color.silver, overflowWrap: 'anywhere' }}>
          {event.description?.trim() || 'No description yet.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }}>
          <Fact label="Date and time" value={event.proposedDate ? formatSgt(event.proposedDate) : NOT_ANNOUNCED} />
          <Fact label="Category" value={categoryLabel(event.category)} />
          <Fact label="Hosted by" value={event.organisation ?? NOT_ANNOUNCED} />
          <Fact label="Registration opens" value={event.registrationOpensAt ? formatSgt(event.registrationOpensAt) : NOT_ANNOUNCED} />
          <Fact label="Registration closes" value={event.registrationClosesAt ? formatSgt(event.registrationClosesAt) : NOT_ANNOUNCED} />
        </div>
        <section aria-label="Venue" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 500 }}>Venue</h3>
          {event.venues.length ? (
            <ul style={{ margin: 0, paddingLeft: '20px', color: color.mist, lineHeight: 1.6 }}>
              {event.venues.map((venue) => (
                <li key={`${venue.name}|${venue.location ?? ''}`}>{venue.location ? `${venue.name}, ${venue.location}` : venue.name}</li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: color.silver }}>The venue will be announced.</p>
          )}
        </section>
        <RegisterSection event={event} accessToken={accessToken} />
      </article>
    </Card>
  );
}

/**
 * SG2-59: an attendee finds the confirmed events whose registration is open or
 * opens later, with name, date, time and venue (AC1). The server leaves out
 * every other event (AC2) and returns attendee-facing details only, so opening
 * one shows no internal planning information (AC3). SG2-60: an open event's
 * details let the attendee register.
 */
export default function FindEvents({ accessToken }: { accessToken: string }) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setList({ kind: 'loading' });
    fetchRegistrableEvents(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setList({ kind: 'loaded', events: result.events });
      else if (result.kind === 'unauthorized') setList({ kind: 'error', message: UNAUTHORIZED, retry: false });
      else setList({ kind: 'error', message: UNAVAILABLE, retry: true });
    });
    return () => { cancelled = true; };
  }, [accessToken, attempt]);

  if (selected !== null) {
    return (
      <section aria-label="Event details" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <EventDetails eventId={selected} accessToken={accessToken}
          // SG2-60: back to a fresh list, which shows any place just taken.
          onBack={() => { setSelected(null); setAttempt((count) => count + 1); }} />
      </section>
    );
  }

  return (
    <section aria-label="Find events" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {list.kind === 'loading' ? <p role="status">Loading events…</p> : null}

      {list.kind === 'error' ? (
        <Notice>
          <p role="alert">{list.message}</p>
          {list.retry ? <GhostButton onClick={() => setAttempt((count) => count + 1)}>Retry</GhostButton> : null}
        </Notice>
      ) : null}

      {list.kind === 'loaded' && list.events.length === 0 ? (
        <Card style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No events open for registration</h2>
          <p style={{ margin: 0, color: color.silver }}>Confirmed events appear here when their registration opens or is about to. Check back later.</p>
        </Card>
      ) : null}

      {list.kind === 'loaded' && list.events.length > 0 ? (
        <section aria-label="Events open for registration" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {list.events.map((event) => {
            const title = event.name.trim() || 'Untitled event';
            const titleId = `find-events-${event.eventId}`;
            return (
              <Card key={event.eventId} padding="24px 28px" style={{ gap: '16px' }}>
                <article aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                    <h3 id={titleId} style={{ margin: 0, fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</h3>
                    <StateBadge event={event} />
                    {event.registered ? <Badge bg={color.teal} fg={color.abyss}>Registered</Badge> : null}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }}>
                    <Fact label="Date and time" value={event.proposedDate ? formatSgt(event.proposedDate) : NOT_ANNOUNCED} />
                    <Fact label="Venue" value={venueNames(event)} />
                    <Fact label="Registration" value={registrationState(event, Date.now()).when} />
                  </div>
                  <div>
                    <GhostButton onClick={() => setSelected(event.eventId)}>View details</GhostButton>
                  </div>
                </article>
              </Card>
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

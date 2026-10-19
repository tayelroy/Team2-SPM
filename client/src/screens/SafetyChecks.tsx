import { useEffect, useState } from 'react';
import {
  fetchSafetyChecks,
  SAFETY_DECISION_OUTCOMES,
  type RecordedSafetyDecision,
  type SafetyCheckEvent,
  type SafetyCheckVenue,
} from '../api/safetyChecks';
import SafetyDecisionForm from '../components/SafetyDecisionForm';
import { SafetyDecisionHistory } from '../components/SafetyDecisionSummary';
import { LAYOUT_LABELS, type Layout } from '../venues/layoutsApi';
import { formatSgt } from '../venues/searchApi';
import { color } from '../theme';
import { Card, Eyebrow, Fact, GhostButton, Notice, RecessedCard } from '../ui';

const NOT_RECORDED = 'Not recorded';
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '16px' } as const;

const recorded = (value: string | null) => value?.trim() || NOT_RECORDED;

function layoutLabel(layout: string | null) {
  return layout ? LAYOUT_LABELS[layout as Layout] ?? layout : NOT_RECORDED;
}

/** SG2-91 AC3: capacity beside the attendance it has to hold. */
function capacityLabel(venue: SafetyCheckVenue, attendance: number | null) {
  if (venue.capacity === null) return NOT_RECORDED;
  return attendance !== null && attendance > venue.capacity
    ? `${venue.capacity} (below expected attendance of ${attendance})`
    : String(venue.capacity);
}

function period(venue: SafetyCheckVenue) {
  return venue.startsAt && venue.endsAt ? `${formatSgt(venue.startsAt)} – ${formatSgt(venue.endsAt)}` : NOT_RECORDED;
}

interface EventReviewProps {
  event: SafetyCheckEvent;
  accessToken: string;
  onRecorded: (event: SafetyCheckEvent, recorded: RecordedSafetyDecision) => void;
  onStale: (message: string) => void;
}

function EventReview({ event, accessToken, onRecorded, onStale }: EventReviewProps) {
  const title = event.name.trim() || 'Untitled event';
  const titleId = `safety-check-${event.eventId}`;
  return (
    <Card padding="24px 28px" style={{ gap: '20px' }}>
      <article aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0, overflowWrap: 'anywhere' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Eyebrow>#{event.eventId}{event.awaitingSince ? ` · Awaiting since ${formatSgt(event.awaitingSince)}` : ''}</Eyebrow>
          <h3 id={titleId} style={{ margin: 0, fontSize: '22px', fontWeight: 500 }}>{title}</h3>
        </div>
        <div style={grid}>
          <Fact label="Organisation" value={recorded(event.organisation)} />
          <Fact label="Proposed date and time" value={event.proposedDate ? formatSgt(event.proposedDate) : NOT_RECORDED} />
          <Fact label="Expected attendance" value={event.expectedAttendance === null ? NOT_RECORDED : String(event.expectedAttendance)} />
          <Fact label="Accessibility requirements" value={recorded(event.accessibilityNeeds)} />
          <Fact label="Expected crowd movement" value={recorded(event.expectedCrowdMovement)} />
        </div>

        <section aria-label={`Venues for ${title}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: color.silver }}>Venues</h4>
          {event.venues.map((venue) => (
            <RecessedCard key={venue.requestId} padding="18px 20px" style={{ gap: '14px' }}>
              <strong style={{ fontSize: '18px', fontWeight: 500, color: color.platinum }}>
                {venue.name || 'Venue no longer listed'}{venue.location ? ` · ${venue.location}` : ''}
              </strong>
              <div style={grid}>
                <Fact label="Capacity" value={capacityLabel(venue, event.expectedAttendance)} />
                <Fact label="Layout" value={layoutLabel(venue.layout)} />
                <Fact label="Booked" value={period(venue)} />
                <Fact label="Accessibility features" value={recorded(venue.accessibilityFeatures)} />
                <Fact label="Emergency access" value={recorded(venue.emergencyAccess)} />
                <Fact label="Known restrictions" value={recorded(venue.knownRestrictions)} />
              </div>
            </RecessedCard>
          ))}
        </section>

        <section aria-label={`Equipment for ${title}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: color.silver }}>Equipment and placement</h4>
          {event.equipment.length === 0 ? (
            <p style={{ margin: 0, color: color.mist }}>No equipment requested.</p>
          ) : event.equipment.map((item) => (
            <RecessedCard key={item.requestId} padding="18px 20px" style={{ gap: '14px' }}>
              <strong style={{ fontSize: '18px', fontWeight: 500, color: color.platinum }}>
                {item.quantity} × {item.name || 'Equipment no longer listed'}
              </strong>
              <div style={grid}>
                <Fact label="Placed at" value={item.placementVenue
                  ? `${item.placementVenue}${item.placementPosition ? ` — ${item.placementPosition}` : ''}` : NOT_RECORDED} />
                <Fact label="Arrangement notes" value={recorded(item.arrangementNotes)} />
              </div>
            </RecessedCard>
          ))}
        </section>

        {/* SG2-92: the decision on what is shown above, at the revision it was read. */}
        <section aria-label={`Safety decision for ${title}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: color.silver }}>Earlier decisions</h4>
          <SafetyDecisionHistory eventId={event.eventId} accessToken={accessToken} />
          <SafetyDecisionForm
            eventId={event.eventId}
            expectedRevision={event.revision}
            accessToken={accessToken}
            onRecorded={(recorded) => onRecorded(event, recorded)}
            onStale={onStale}
          />
        </section>
      </article>
    </Card>
  );
}

/**
 * The Safety Officer's list of events awaiting an operational safety check
 * (SG2-91 AC2), oldest wait first, each with what the review needs (AC3)
 * and the SG2-92 decision on it. An event leaves the list as soon as an
 * arrangement falls through or is added, or a decision is recorded, so
 * Refresh shows the list as it stands now.
 */
export default function SafetyChecks({ accessToken, focusEventId }: { accessToken: string; focusEventId?: number }) {
  const [events, setEvents] = useState<SafetyCheckEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // SG2-91 AC2: a Safety desk card opens its event on its own; "Show all"
  // returns to the whole list, which is what the menu and button open.
  const [focus, setFocus] = useState(focusEventId);
  // SG2-92: what the last decision did, or why it was refused as stale.
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSafetyChecks(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setEvents(result.events);
      else setError(result.kind === 'unauthorized'
        ? 'Only Safety Officers can open the safety check list.'
        : 'The safety check list is temporarily unavailable. Please try again.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [accessToken, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const refresh = <GhostButton onClick={() => { setNotice(''); reload(); }} style={{ alignSelf: 'flex-start' }}>Refresh</GhostButton>;
  const flash = notice ? <p role="status" style={{ margin: 0, color: color.mist }}>{notice}</p> : null;
  // A recorded event has moved on, so the list is re-read without it; a stale
  // one is re-read so the Safety Officer reviews what it says now.
  const onRecorded = (event: SafetyCheckEvent, recorded: RecordedSafetyDecision) => {
    setFocus(undefined);
    setNotice(`${SAFETY_DECISION_OUTCOMES[recorded.decision.decision]} for ${event.name.trim() || 'Untitled event'}. `
      + 'The organiser and the coordinator have been notified.');
    reload();
  };
  const onStale = (message: string) => {
    setNotice(message);
    reload();
  };
  const review = (event: SafetyCheckEvent) => (
    <EventReview key={event.eventId} event={event} accessToken={accessToken} onRecorded={onRecorded} onStale={onStale} />
  );

  if (loading) return <p role="status">Loading events awaiting a safety check…</p>;
  if (error) {
    return (
      <Notice>
        <p role="alert">{error}</p>
        <GhostButton onClick={reload}>Retry</GhostButton>
      </Notice>
    );
  }
  if (events.length === 0) {
    return (
      <Card style={{ gap: '12px' }}>
        {flash}
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No events awaiting a safety check</h2>
        <p style={{ margin: 0, color: color.silver }}>
          An event appears here once all of its venue bookings are approved and its equipment is reserved.
        </p>
        {refresh}
      </Card>
    );
  }
  const focused = events.find((event) => event.eventId === focus);
  if (focused) {
    return (
      <section aria-label={`Safety check for ${focused.name.trim() || 'Untitled event'}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
          <GhostButton onClick={() => setFocus(undefined)}>
            Show all {events.length} {events.length === 1 ? 'safety check' : 'safety checks'}
          </GhostButton>
          {refresh}
        </div>
        {flash}
        {review(focused)}
      </section>
    );
  }
  return (
    <section aria-label="Events awaiting a safety check" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {flash}
      {focus !== undefined && (
        <p role="status" style={{ margin: 0, color: color.mist }}>
          That event is no longer awaiting a safety check. These are the events that are.
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: color.silver }}>
          {events.length} {events.length === 1 ? 'event' : 'events'} awaiting a safety check
        </h2>
        {refresh}
      </div>
      {events.map(review)}
    </section>
  );
}

import { useEffect, useState } from 'react';
import {
  fetchSafetyCheckQueue,
  fetchSafetyDecisions,
  SAFETY_DECISION_OUTCOMES,
  type RecordedSafetyDecision,
  type SafetyCheckEvent,
  type SafetyDecision,
} from '../api/safetyChecks';
import { color } from '../theme';
import { Notice } from '../ui';
import { formatSgtTimestamp } from './EventAuditDrawer';
import SafetyDecisionForm from './SafetyDecisionForm';
import { SafetyDecisionDetails } from './SafetyDecisionSummary';

const eventName = (event: SafetyCheckEvent) => event.name?.trim() || 'Untitled event';

/** The event's earlier decisions, newest first (SG2-92 AC6). */
function DecisionHistory({ eventId, accessToken }: { eventId: number; accessToken: string }) {
  const [decisions, setDecisions] = useState<SafetyDecision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSafetyDecisions(eventId, accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setDecisions(result.decisions);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, accessToken]);

  if (error) return <p role="alert" className="organisation-detail-hint">{error}</p>;
  if (!decisions) return <p role="status" className="organisation-detail-hint">Loading earlier decisions…</p>;
  if (decisions.length === 0) return <p className="organisation-detail-hint">No earlier safety decisions on this event.</p>;
  return (
    <ul className="safety-history" aria-label="Earlier safety decisions">
      {decisions.map((decision) => (
        <li key={decision.decision_id}><SafetyDecisionDetails decision={decision} /></li>
      ))}
    </ul>
  );
}

/** What the Safety Officer reviews before deciding (stand-in for SG2-91's review details). */
function ReviewPanel({ event, accessToken, onRecorded }: {
  event: SafetyCheckEvent;
  accessToken: string;
  onRecorded: (recorded: RecordedSafetyDecision) => void;
}) {
  return (
    <section data-testid="safety-review" aria-label={`Safety review of ${eventName(event)}`} className="safety-review">
      <h3>{eventName(event)}</h3>
      <dl className="safety-decision-facts">
        <div><dt>Event date</dt><dd>{event.proposed_date ? formatSgtTimestamp(event.proposed_date) : 'Not set'}</dd></div>
        <div><dt>Expected attendance</dt><dd>{event.expected_attendance ?? 'Not set'}</dd></div>
        <div><dt>Accessibility requirements</dt><dd>{event.accessibility_needs?.trim() || 'None recorded'}</dd></div>
        <div><dt>Coordinator</dt><dd>{event.coordinator_name ?? 'Not assigned'}</dd></div>
      </dl>
      <h4>Venues</h4>
      {event.venues.length === 0 ? <p className="organisation-detail-hint">No confirmed venue booking.</p> : (
        <ul className="safety-list">
          {event.venues.map((venue, index) => (
            <li key={`${venue.name}:${index}`}>
              {venue.name}: capacity {venue.capacity ?? 'unknown'}
              {venue.starts_at && venue.ends_at ? `, ${formatSgtTimestamp(venue.starts_at)} – ${formatSgtTimestamp(venue.ends_at)}` : ''}
            </li>
          ))}
        </ul>
      )}
      <h4>Equipment</h4>
      {event.equipment.length === 0 ? <p className="organisation-detail-hint">No equipment requested.</p> : (
        <ul className="safety-list">
          {event.equipment.map((item, index) => (
            <li key={`${item.name}:${index}`}>
              {item.name} × {item.quantity}{item.placement_position ? `, placed ${item.placement_position}` : ''}
            </li>
          ))}
        </ul>
      )}
      <h4>Earlier decisions</h4>
      <DecisionHistory eventId={event.event_id} accessToken={accessToken} />
      <SafetyDecisionForm eventId={event.event_id} accessToken={accessToken} onRecorded={onRecorded} />
    </section>
  );
}

/**
 * SG2-92: the Safety Officer's desk. The list of events awaiting a check is
 * a STAND-IN for SG2-91 (Lim Dao Jun) until it ships; recording a decision
 * is real (AC1–AC6). A recorded event leaves the list.
 */
export default function SafetyCheckQueue({ accessToken }: { accessToken: string }) {
  const [events, setEvents] = useState<SafetyCheckEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetchSafetyCheckQueue(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEvents(result.queue.events);
        setLoaded(true);
      } else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, attempt]);

  const open = events.find((event) => event.event_id === selected) ?? null;

  const onRecorded = (event: SafetyCheckEvent, result: RecordedSafetyDecision) => {
    setEvents((current) => current.filter((item) => item.event_id !== event.event_id));
    setSelected(null);
    setRecorded(`${SAFETY_DECISION_OUTCOMES[result.decision.decision]} for ${eventName(event)}. The organiser and the coordinator have been notified.`);
  };

  return (
    <section data-testid="safety-check-queue" aria-label="Safety checks" className="safety-queue">
      <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500, color: color.platinum }}>Safety checks</h2>
      <Notice data-testid="safety-check-stand-in-note">
        <p style={{ margin: 0, color: color.silver }}>
          This list is a stand-in for SG2-91 until it ships. Decisions you record here are real.
        </p>
      </Notice>
      {recorded ? <p role="status" className="safety-recorded">{recorded}</p> : null}
      {error ? (
        <div className="safety-row">
          <p role="alert" className="organisation-detail-hint">{error}</p>
          <button type="button" className="organisation-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </div>
      ) : !loaded ? (
        <p role="status" className="organisation-detail-hint">Loading safety checks…</p>
      ) : events.length === 0 ? (
        <p className="organisation-detail-hint">No events are awaiting a safety check.</p>
      ) : (
        <div className="safety-layout">
          <ul className="safety-events" aria-label="Events awaiting a safety check">
            {events.map((event) => (
              <li key={event.event_id}>
                <button
                  type="button"
                  className="organisation-button safety-event"
                  aria-pressed={selected === event.event_id}
                  onClick={() => {
                    setSelected(event.event_id);
                    setRecorded(null);
                  }}
                >
                  <strong>{eventName(event)}</strong>
                  <span>{event.proposed_date ? formatSgtTimestamp(event.proposed_date) : 'Date not set'} · {event.expected_attendance ?? '?'} expected</span>
                </button>
              </li>
            ))}
          </ul>
          {open ? (
            <ReviewPanel key={open.event_id} event={open} accessToken={accessToken} onRecorded={(result) => onRecorded(open, result)} />
          ) : (
            <p className="organisation-detail-hint">Choose an event to review its arrangements and record a decision.</p>
          )}
        </div>
      )}
    </section>
  );
}

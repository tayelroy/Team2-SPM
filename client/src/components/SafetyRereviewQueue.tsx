import { useEffect, useRef, useState } from 'react';
import { confirmSafetyRereview, fetchSafetyRereviews, type SafetyRereviewQueueItem } from '../api/safetyChecks';
import { LAYOUT_LABELS, type Layout } from '../venues/layoutsApi';
import { GhostButton } from '../ui';
import { formatSgtTimestamp } from './EventAuditDrawer';

/**
 * SG2-93 AC2/AC4: the venue bookings (Venue Staff) or equipment requests
 * (Technical Support) a Safety Officer's Request changes sent back, each
 * with the reason given. Confirming one again clears it; once every flagged
 * arrangement is confirmed the event returns to Awaiting Safety Check.
 * Shows nothing while loading or when nothing is waiting.
 */
export default function SafetyRereviewQueue({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<SafetyRereviewQueueItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ role: 'status' | 'alert'; text: string } | null>(null);
  // The disabled buttons stop a second click; this stops a second confirm
  // dispatched before React re-renders them.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void fetchSafetyRereviews(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setItems(result.rereviews);
      else setLoadError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, attempt]);

  const confirm = async (item: SafetyRereviewQueueItem, eventName: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirmingId(item.review_id);
    setOutcome(null);
    const result = await confirmSafetyRereview(item.review_id, accessToken);
    inFlight.current = false;
    setConfirmingId(null);
    if (!result.ok) {
      setOutcome({ role: 'alert', text: result.message });
      return;
    }
    setItems((current) => current!.filter((each) => each.review_id !== item.review_id));
    setOutcome({
      role: 'status',
      text: `Confirmed ${item.label} again for ${eventName}.`
        + (result.confirmed.status === 'awaiting_safety_check' ? ' The event is back with the Safety Officer.' : ''),
    });
  };

  if (loadError === null && (!items || (items.length === 0 && !outcome))) return null;

  return (
    <section className="work-queue-group" aria-label="Safety changes to confirm">
      <h2>Safety changes to confirm</h2>
      {loadError !== null ? (
        <div className="safety-row">
          <p role="alert" className="work-queue-empty">{loadError}</p>
          <button type="button" className="organisation-button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : null}
      {outcome ? <p role={outcome.role} className="work-queue-empty">{outcome.text}</p> : null}
      {items?.map((item) => {
        const eventName = item.event_name ?? 'Untitled event';
        return (
          <article key={item.review_id} aria-label={item.label} className="work-queue-item work-queue-flag">
            <span className="work-queue-item-meta">
              <span className="work-queue-status">Safety check</span>
              <span>{item.label}</span>
            </span>
            <strong>{eventName}</strong>
            {item.reason ? <span>Reason: {item.reason}</span> : null}
            {item.decided_by_name ? <span>Asked by {item.decided_by_name}</span> : null}
            <span>Coordinator: {item.coordinator_name ?? 'Not assigned'}</span>
            <span>Event date: {formatSgtTimestamp(item.proposed_date)}</span>
            {item.arrangement === 'venue' && item.layout ? (
              <span>Layout: {LAYOUT_LABELS[item.layout as Layout] ?? item.layout}</span>
            ) : null}
            {item.arrangement === 'equipment' && item.placement_venue_name ? (
              <span>
                Placed at {item.placement_venue_name}
                {item.placement_position ? ` — ${item.placement_position}` : ''}
              </span>
            ) : null}
            <GhostButton
              onClick={() => void confirm(item, eventName)}
              disabled={confirmingId !== null}
              style={{ padding: '8px 14px', fontSize: '13px', justifySelf: 'start' }}
            >
              Confirm again
            </GhostButton>
          </article>
        );
      })}
    </section>
  );
}

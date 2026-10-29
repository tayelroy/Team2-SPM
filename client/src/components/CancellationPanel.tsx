import { useId, useState } from 'react';
import { cancelEvent, requestCancellation, type EventCancelled } from '../api/eventCancellation';
import { formatSgtTimestamp } from './EventAuditDrawer';

export interface CancellationPanelProps {
  eventId: number;
  accessToken: string;
  /** The creating organiser asks; the assigned coordinator carries it out. */
  mode: 'organiser' | 'coordinator';
  status: string;
  requestedAt: string | null;
  reason: string | null;
  cancelledAt: string | null;
  /** Reloads the event after a request or a cancellation. */
  onChanged: () => void;
  /** Keep the server's final timestamp when the event leaves active work. */
  onCancelled?: (result: EventCancelled) => void;
}

const MAX_REASON = 500;

/**
 * SG2-67: the Event Organiser asks for a cancellation with a reason, and the
 * assigned Event Coordinator carries it out after confirming. The server
 * decides every outcome; this panel only offers the step that fits.
 */
export default function CancellationPanel({
  eventId, accessToken, mode, status, requestedAt, reason, cancelledAt, onChanged, onCancelled
}: CancellationPanelProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusLower = status.toLowerCase();

  // Match the server's closed-state guard before offering either role a step,
  // even if a stale cancellation request remains on the event. Cancelled
  // events still render their final receipt below.
  if (['draft', 'rejected', 'completed'].includes(statusLower)) return null;

  const ask = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed.length > MAX_REASON) {
      setError(`Give a reason for the cancellation, up to ${MAX_REASON} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestCancellation(eventId, trimmed, accessToken);
    setBusy(false);
    if (result.ok) onChanged();
    else setError(result.message);
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    const result = await cancelEvent(eventId, accessToken);
    setBusy(false);
    if (result.ok) {
      onCancelled?.(result.value);
      onChanged();
    }
    else {
      setConfirming(false);
      setError(result.message);
    }
  };

  let body;
  if (statusLower === 'cancelled') {
    // AC4/AC5: the cancellation is final and says why.
    body = <p role="status" className="organisation-detail-description">
      {`This event was cancelled${cancelledAt ? ` on ${formatSgtTimestamp(cancelledAt)}` : ''}.`}
      {reason ? ` Reason: ${reason}` : ''} A similar event needs a new request.
    </p>;
  } else if (requestedAt && reason) {
    body = <>
      <p className="organisation-detail-description">
        {mode === 'organiser' ? 'You asked' : 'The organiser asked'} to cancel this event on {formatSgtTimestamp(requestedAt)}. Reason: {reason}
      </p>
      {mode === 'organiser' ? (
        <p className="organisation-detail-hint">Your coordinator will carry out the cancellation.</p>
      ) : confirming ? (
        <>
          <p className="organisation-detail-hint">
            Cancelling releases the event's venues and equipment and tells its registered attendees. It cannot be undone.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="organisation-button organisation-button-primary" disabled={busy} onClick={() => void cancel()}>
              {busy ? 'Cancelling…' : 'Yes, cancel event'}
            </button>
            <button type="button" className="organisation-button" disabled={busy} onClick={() => setConfirming(false)}>
              Keep event
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="organisation-button" style={{ alignSelf: 'flex-start' }} onClick={() => { setError(null); setConfirming(true); }}>
          Cancel event
        </button>
      )}
    </>;
  } else if (mode === 'organiser') {
    body = <>
      <label htmlFor={fieldId}>Reason for cancelling</label>
      <textarea id={fieldId} rows={3} value={draft} onChange={event => setDraft(event.target.value)} className="organisation-textarea" />
      <button type="button" className="organisation-button" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void ask()}>
        {busy ? 'Sending…' : 'Ask to cancel'}
      </button>
    </>;
  } else {
    // The coordinator has nothing to do until the organiser asks.
    return null;
  }

  return <section className="organisation-detail-intro" aria-label="Cancellation">
    <h3>Cancellation</h3>
    {body}
    {error ? <p role="alert" className="work-queue-empty">{error}</p> : null}
  </section>;
}

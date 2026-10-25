import { useEffect, useState } from 'react';
import {
  fetchSafetyDecisions,
  reworkSafetyRejectedEvent,
  safetyArrangementList,
  SAFETY_DECISION_OUTCOMES,
  type SafetyDecision,
  type SafetyDecisionKind,
  type SafetyRereview,
} from '../api/safetyChecks';
import { color } from '../theme';
import { Badge } from '../ui';
import { formatSgtTimestamp } from './EventAuditDrawer';

/** Approve reads as good news; the other two as something to act on. */
const TONE: Record<SafetyDecisionKind, { bg: string; fg: string }> = {
  approve: { bg: 'rgba(0,130,124,0.35)', fg: color.mist },
  reject: { bg: 'rgba(112,119,119,0.35)', fg: color.silver },
  request_changes: { bg: 'rgba(255, 180, 0, 0.2)', fg: '#fde047' },
};

/** Who confirms each kind of flagged arrangement again (SG2-93 AC2). */
const REREVIEW_STAFF: Record<SafetyRereview['arrangement'], string> = {
  venue: 'Venue Staff',
  equipment: 'Technical Support',
};

/**
 * One recorded safety decision (SG2-92 AC6): what was decided, why, which
 * arrangements must change, and who decided when, in Singapore time.
 */
export function SafetyDecisionDetails({ decision }: { decision: SafetyDecision }) {
  return (
    <div className="safety-decision" data-decision={decision.decision}>
      <Badge bg={TONE[decision.decision].bg} fg={TONE[decision.decision].fg} size={10}>
        {SAFETY_DECISION_OUTCOMES[decision.decision]}
      </Badge>
      <dl className="safety-decision-facts">
        {decision.reason ? <div><dt>Reason</dt><dd>{decision.reason}</dd></div> : null}
        {decision.arrangements.length > 0 ? (
          <div><dt>Arrangements to change</dt><dd>{safetyArrangementList(decision.arrangements)}</dd></div>
        ) : null}
        <div><dt>Recorded by</dt><dd>{decision.decided_by_name ?? 'Safety Officer'}</dd></div>
        <div><dt>Recorded at</dt><dd>{formatSgtTimestamp(decision.decided_at)}</dd></div>
      </dl>
    </div>
  );
}

/**
 * Every decision already recorded on an event awaiting its safety check,
 * newest first (SG2-92 AC6), so the Safety Officer sees what was asked before.
 */
export function SafetyDecisionHistory({ eventId, accessToken }: { eventId: number; accessToken: string }) {
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

export interface SafetyDecisionSummaryProps {
  eventId: number;
  accessToken: string;
  /** The event's current status; a change re-reads the decisions. */
  status: string;
  /** The assigned coordinator may take a Safety Rejected event back to Planning (AC4). */
  canRework: boolean;
  /** Called once the event is back in Planning, so the screen can re-read it. */
  onReworked: () => void;
}

/** Statuses in which the latest Approve decision still stands (SG2-94). */
const APPROVAL_STANDS: Record<string, true> = { preparation: true, confirmed: true, completed: true };

/**
 * SG2-92 AC4–AC6: the latest safety check decision on an event, for its
 * assigned coordinator and its organiser. On a Safety Rejected event the
 * coordinator can rework the arrangements, which returns it to Planning.
 * Shows nothing while there is no decision and nothing to do.
 */
export default function SafetyDecisionSummary({ eventId, accessToken, status, canRework, onReworked }: SafetyDecisionSummaryProps) {
  const [decisions, setDecisions] = useState<SafetyDecision[] | null>(null);
  const [rereviews, setRereviews] = useState<SafetyRereview[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reworking, setReworking] = useState(false);
  const [reworkError, setReworkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDecisions(null);
    setRereviews([]);
    setLoadError(null);
    void fetchSafetyDecisions(eventId, accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDecisions(result.decisions);
        setRereviews(result.rereviews);
      } else setLoadError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, accessToken, status, attempt]);

  const rework = async () => {
    setReworking(true);
    setReworkError(null);
    const result = await reworkSafetyRejectedEvent(eventId, accessToken);
    setReworking(false);
    if (result.ok) onReworked();
    else setReworkError(result.message);
  };

  const showRework = canRework && status === 'safety_rejected';
  const latest = decisions?.[0];
  // SG2-93 AC2/AC5: what the latest Request changes sent back to staff, and where each stands.
  const sentBack = latest?.decision === 'request_changes'
    ? rereviews.filter((rereview) => rereview.decision_id === latest.decision_id)
    : [];
  // SG2-94 AC3: an approval only stands while the event stays past the check;
  // any way back means what was approved changed and must be checked again.
  const withdrawn = latest?.decision === 'approve' && APPROVAL_STANDS[status] !== true;
  if (loadError === null && !latest && !(showRework && decisions)) return null;

  return (
    <section
      data-testid="safety-decision-summary"
      aria-label="Latest safety decision"
      className="organisation-detail-panel safety-panel"
    >
      <h3>Latest safety decision</h3>
      {loadError !== null ? (
        <div className="safety-row">
          <p role="alert" className="organisation-detail-hint">{loadError}</p>
          <button type="button" className="organisation-button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : latest ? (
        <>
          <SafetyDecisionDetails decision={latest} />
          {sentBack.length > 0 ? (
            <ul className="safety-history" aria-label="Sent back to staff">
              {sentBack.map((rereview) => (
                <li key={rereview.review_id}>
                  {rereview.resolution === 'confirmed'
                    ? `${rereview.label}: confirmed again by ${rereview.resolved_by_name ?? REREVIEW_STAFF[rereview.arrangement]}`
                    : rereview.resolution === 'withdrawn'
                      ? `${rereview.label}: withdrawn`
                      : `${rereview.label}: waiting for ${REREVIEW_STAFF[rereview.arrangement]} to confirm it again`}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {withdrawn ? (
        <p className="organisation-detail-hint" data-testid="safety-approval-withdrawn">
          This approval was withdrawn because the event changed after it was approved. It must pass the safety check again.
        </p>
      ) : null}
      {showRework ? (
        <>
          <p className="organisation-detail-hint">
            This event did not pass its safety check. Rework the arrangements, then resubmit them for a new safety check.
          </p>
          {reworkError ? <p role="alert" className="organisation-detail-hint">{reworkError}</p> : null}
          <button
            type="button"
            className="organisation-button organisation-button-primary"
            onClick={() => void rework()}
            disabled={reworking}
            style={{ justifySelf: 'start' }}
          >
            {reworking ? 'Reworking arrangements…' : 'Rework arrangements'}
          </button>
        </>
      ) : null}
    </section>
  );
}

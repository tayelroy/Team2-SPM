import { useEffect, useState } from 'react';
import {
  fetchSafetyDecisions,
  reworkSafetyRejectedEvent,
  safetyArrangementList,
  SAFETY_DECISION_OUTCOMES,
  type SafetyDecision,
  type SafetyDecisionKind,
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

/**
 * SG2-92 AC4–AC6: the latest safety check decision on an event, for its
 * assigned coordinator and its organiser. On a Safety Rejected event the
 * coordinator can rework the arrangements, which returns it to Planning.
 * Shows nothing while there is no decision and nothing to do.
 */
export default function SafetyDecisionSummary({ eventId, accessToken, status, canRework, onReworked }: SafetyDecisionSummaryProps) {
  const [decisions, setDecisions] = useState<SafetyDecision[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reworking, setReworking] = useState(false);
  const [reworkError, setReworkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDecisions(null);
    setLoadError(null);
    void fetchSafetyDecisions(eventId, accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setDecisions(result.decisions);
      else setLoadError(result.message);
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
        <SafetyDecisionDetails decision={latest} />
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

import { useId, useRef, useState, type FormEvent } from 'react';
import {
  MAX_SAFETY_REASON_LENGTH,
  recordSafetyDecision,
  safetyDecisionProblems,
  SAFETY_ARRANGEMENT_LABELS,
  SAFETY_ARRANGEMENTS,
  SAFETY_DECISION_LABELS,
  SAFETY_DECISIONS,
  type RecordedSafetyDecision,
  type SafetyArrangement,
  type SafetyDecisionKind,
} from '../api/safetyChecks';

export interface SafetyDecisionFormProps {
  eventId: number;
  /** The event's safety_check_revision as SG2-91's list showed it. */
  expectedRevision: number;
  accessToken: string;
  /** Called once the server has recorded the decision and moved the event on. */
  onRecorded: (recorded: RecordedSafetyDecision) => void;
  /**
   * Called with the server's words when the event changed after it was
   * opened, so the list can be re-read and the event reviewed again.
   */
  onStale: (message: string) => void;
}

/**
 * SG2-92 AC1–AC2: the Safety Officer records Approve, Reject or Request
 * changes. Reject and Request changes need a reason; Request changes also
 * names the arrangements to change. The same rules are checked here before
 * sending and again by the server, whose refusal is shown as it words it.
 * The decision is refused if the event changed since this review was opened.
 */
export default function SafetyDecisionForm({ eventId, expectedRevision, accessToken, onRecorded, onStale }: SafetyDecisionFormProps) {
  const id = useId();
  const [decision, setDecision] = useState<SafetyDecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const [arrangements, setArrangements] = useState<SafetyArrangement[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The disabled button stops a second click; this stops a second submit
  // dispatched before React re-renders (e.g. Enter pressed twice).
  const inFlight = useRef(false);

  const toggle = (arrangement: SafetyArrangement, checked: boolean) => {
    // Kept in the fixed order, so the decision lists them the same way every time.
    setArrangements((current) =>
      SAFETY_ARRANGEMENTS.filter((item) => (item === arrangement ? checked : current.includes(item))));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (decision === null) {
      setProblems(['Choose Approve, Reject or Request changes.']);
      return;
    }
    const draft = { decision, reason, arrangements };
    const found = safetyDecisionProblems(draft);
    setProblems(found);
    if (found.length > 0) return;
    inFlight.current = true;
    setBusy(true);
    const result = await recordSafetyDecision(eventId, draft, expectedRevision, accessToken);
    inFlight.current = false;
    setBusy(false);
    if (result.ok) onRecorded(result.recorded);
    else if (result.kind === 'stale') onStale(result.message);
    else setProblems([result.message, ...(result.details ?? [])]);
  };

  const reasonRequired = decision === 'reject' || decision === 'request_changes';

  return (
    <form className="safety-form" aria-label="Record a safety decision" noValidate onSubmit={(event) => void submit(event)}>
      <fieldset className="safety-fieldset" disabled={busy}>
        <legend>Decision</legend>
        {SAFETY_DECISIONS.map((value) => (
          <label key={value} className="safety-choice">
            <input
              type="radio"
              name={`${id}-decision`}
              value={value}
              checked={decision === value}
              onChange={() => setDecision(value)}
            />
            {SAFETY_DECISION_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-reason`} className="safety-label">Reason</label>
      <textarea
        id={`${id}-reason`}
        className="organisation-textarea"
        rows={4}
        value={reason}
        disabled={busy}
        aria-required={reasonRequired}
        aria-describedby={`${id}-reason-hint`}
        onChange={(event) => setReason(event.target.value)}
      />
      <p id={`${id}-reason-hint`} className="organisation-detail-hint">
        {reasonRequired ? 'Required.' : 'Required to reject or request changes; optional to approve.'}{' '}
        {Array.from(reason.trim()).length} of {MAX_SAFETY_REASON_LENGTH} characters.
      </p>
      {decision === 'request_changes' ? (
        <fieldset className="safety-fieldset" disabled={busy}>
          <legend>Arrangements to change</legend>
          {SAFETY_ARRANGEMENTS.map((value) => (
            <label key={value} className="safety-choice">
              <input
                type="checkbox"
                checked={arrangements.includes(value)}
                onChange={(event) => toggle(value, event.target.checked)}
              />
              {SAFETY_ARRANGEMENT_LABELS[value]}
            </label>
          ))}
        </fieldset>
      ) : null}
      {problems.length > 0 ? (
        <div role="alert" className="organisation-detail-hint">
          {problems.map((problem) => <p key={problem} style={{ margin: 0 }}>{problem}</p>)}
        </div>
      ) : null}
      <button type="submit" className="organisation-button organisation-button-primary" disabled={busy} style={{ justifySelf: 'start' }}>
        {busy ? 'Recording decision…' : 'Record decision'}
      </button>
    </form>
  );
}

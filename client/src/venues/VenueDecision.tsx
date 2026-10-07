import { useState } from 'react';
import { Notice, NoticeMark } from '../ui';
import { color, radius, rule } from '../theme';
import { decideVenueRequest } from './requestsApi';
import type { BookingReadiness } from './suitabilityApi';

/** Why Approve is not available yet (SG2-47 readiness). */
const NOT_READY: Record<Exclude<BookingReadiness, 'allowed'>, string> = {
  blocked: 'A required facility is missing, so this booking cannot be approved. You can still reject it.',
  needs_capacity_exception: 'Approve a capacity exception above before approving the booking.'
};

const DONE: Record<string, string> = {
  approved: 'Approved. The venue is committed to this event and the coordinator has been notified.',
  rejected: 'Rejected. The coordinator has been notified and can see your reason.'
};

/**
 * SG2-49: Venue Staff decide a pending venue request. Approval commits the
 * venue (AC1); rejection needs a reason the coordinator sees (AC2). The
 * server records who decided and when (AC3). A request created by a
 * tentative hold (SG2-84) is converted or released from Venue holds instead.
 */
export default function VenueDecision({ requestId, accessToken, holdId, readiness, onDecided }: {
  requestId: number;
  accessToken?: string | null;
  holdId: number | null;
  /** Null until the suitability check has loaded. */
  readiness: BookingReadiness | null;
  onDecided: (status: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');
  const [decided, setDecided] = useState<string | null>(null);

  if (holdId !== null) {
    return <section className="organisation-detail-footer" aria-label="Decide this booking request">
      <h3>Decision</h3>
      <Notice style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <NoticeMark />
          <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.silver }}>
            This request belongs to tentative hold #{holdId}. Convert or release it from Venue holds.
          </span>
        </div>
      </Notice>
    </section>;
  }
  if (decided) {
    return <section className="organisation-detail-footer" aria-label="Decide this booking request">
      <h3>Decision</h3>
      <p role="status" className="organisation-detail-hint">{DONE[decided]}</p>
    </section>;
  }

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) {
      setError('Give a reason for rejecting this request. The coordinator will see it.');
      return;
    }
    setError('');
    setPending(decision);
    const result = await decideVenueRequest(accessToken, requestId, decision, reason);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDecided(result.request.status);
    onDecided(result.request.status);
  }

  const hint = readiness === null ? 'Checking whether this booking can be approved…' : readiness === 'allowed' ? null : NOT_READY[readiness];
  return <section className="organisation-detail-footer" aria-label="Decide this booking request">
    <h3>Decision</h3>
    <label htmlFor={`venue-decision-reason-${requestId}`} className="organisation-detail-hint">Decision note (required to reject; shared with the coordinator)</label>
    <textarea id={`venue-decision-reason-${requestId}`} value={reason} rows={3} maxLength={500}
      placeholder="Reason for approval or rejection…" onChange={event => setReason(event.target.value)}
      style={{ width: '100%', boxSizing: 'border-box', background: color.deep, border: rule.raised, borderRadius: radius.sm,
        padding: '12px 14px', color: color.platinum, font: 'inherit', fontSize: '14px', resize: 'vertical' }} />
    {hint && <p className="organisation-detail-hint">{hint}</p>}
    {error && <Notice role="alert" style={{ padding: '14px 18px' }}><span style={{ color: color.platinum }}>{error}</span></Notice>}
    <div className="organisation-detail-actions">
      <button type="button" className="organisation-button organisation-button-primary" disabled={pending !== null || readiness !== 'allowed'}
        onClick={() => decide('approve')}>{pending === 'approve' ? 'Approving…' : 'Approve booking'}</button>
      <button type="button" className="organisation-button" disabled={pending !== null}
        onClick={() => decide('reject')}>{pending === 'reject' ? 'Rejecting…' : 'Reject with reason'}</button>
    </div>
  </section>;
}

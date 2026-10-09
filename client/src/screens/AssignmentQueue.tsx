import { useEffect, useState } from 'react';
import { fetchAssignmentQueue, type CoordinatorOption, type QueueEntry } from '../api/assignmentQueue';
import { assignCoordinator } from '../api/eventRequests';
import { formatSgt } from '../venues/searchApi';
import { color, gradient, radius } from '../theme';
import { Card, Fact, GhostButton, Notice } from '../ui';

const NOT_RECORDED = 'Not recorded';

/**
 * The Event Coordinator Lead's queue of requests that no coordinator holds
 * yet (SG2-87), oldest submission first. From here the Lead assigns each one
 * to a coordinator (SG2-88 AC1); an assigned request leaves the queue.
 * Reassigning an already-assigned event stays on Assign coordinators.
 */
export default function AssignmentQueue({ accessToken }: { accessToken: string }) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [coordinators, setCoordinators] = useState<CoordinatorOption[]>([]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [failure, setFailure] = useState<Record<number, string>>({});
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAssignmentQueue(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) { setEntries(result.entries); setCoordinators(result.coordinators); }
      else setError(result.kind === 'unauthorized'
        ? 'Only the Event Coordinator Lead can see the unassigned queue.'
        : 'The unassigned queue is temporarily unavailable. Please try again.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [accessToken, attempt]);

  async function assign(entry: QueueEntry, title: string, chosen: CoordinatorOption) {
    setSavingId(entry.eventId);
    setFailure((current) => ({ ...current, [entry.eventId]: '' }));
    const outcome = await assignCoordinator(entry.eventId, chosen.userId, accessToken);
    setSavingId(null);
    if (!outcome.ok) {
      setFailure((current) => ({ ...current, [entry.eventId]: outcome.message }));
      return;
    }
    setEntries((current) => current.filter((item) => item.eventId !== entry.eventId));
    setConfirmation(outcome.notified
      ? `Assigned ${title} to ${chosen.name}.`
      : `Assigned ${title} to ${chosen.name}, but the notifications could not be sent.`);
  }

  if (loading) return <p role="status">Loading the unassigned queue…</p>;
  if (error) {
    return (
      <Notice>
        <p role="alert">{error}</p>
        <GhostButton onClick={() => setAttempt((n) => n + 1)}>Retry</GhostButton>
      </Notice>
    );
  }
  if (entries.length === 0) {
    return (
      <Card style={{ gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No requests awaiting a coordinator</h2>
        <p style={{ margin: 0, color: color.silver }}>Newly submitted requests appear here until you assign them.</p>
        {confirmation && <p role="status" style={{ margin: 0, color: color.mist }}>{confirmation}</p>}
      </Card>
    );
  }
  return (
    <section aria-label="Unassigned queue" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: color.silver }}>
        {entries.length} {entries.length === 1 ? 'request' : 'requests'} awaiting a coordinator
      </h2>
      {confirmation && <p role="status" style={{ margin: 0, color: color.mist }}>{confirmation}</p>}
      {entries.map((entry) => {
        const title = entry.name.trim() || 'Untitled request';
        const titleId = `queue-entry-${entry.eventId}`;
        const selectId = `queue-coordinator-${entry.eventId}`;
        const chosen = coordinators.find((option) => option.userId === picked[entry.eventId]);
        const message = failure[entry.eventId];
        return (
          <Card key={entry.eventId} padding="24px 28px" style={{ gap: '16px' }}>
            <article aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
              <h3 id={titleId} style={{ margin: 0, fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '16px' }}>
                <Fact label="Organiser" value={entry.organiserName ?? NOT_RECORDED} />
                <Fact label="Proposed date and time" value={entry.proposedDate ? formatSgt(entry.proposedDate) : NOT_RECORDED} />
                <Fact label="Expected attendance" value={entry.expectedAttendance === null ? NOT_RECORDED : String(entry.expectedAttendance)} />
                <Fact label="Submitted" value={entry.submittedAt ? formatSgt(entry.submittedAt) : NOT_RECORDED} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
                <label htmlFor={selectId} style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 220px', minWidth: 0 }}>
                  <span style={{ fontSize: '13px', color: color.silver }}>Coordinator for {title}</span>
                  <select
                    id={selectId}
                    value={picked[entry.eventId] ?? ''}
                    disabled={coordinators.length === 0}
                    onChange={(event) => setPicked((current) => ({ ...current, [entry.eventId]: event.target.value }))}
                    style={{ minHeight: '44px', maxWidth: '100%' }}
                  >
                    {coordinators.length === 0
                      ? <option value="">No coordinators available</option>
                      : <><option value="">Choose a coordinator</option>
                        {coordinators.map((option) => <option key={option.userId} value={option.userId}>{option.name}</option>)}</>}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={`Assign ${title}`}
                  disabled={!chosen || savingId === entry.eventId}
                  onClick={() => void assign(entry, title, chosen!)}
                  style={{
                    border: 'none', borderRadius: radius.sm, padding: '15px 22px', minHeight: '44px',
                    background: gradient.aurora, color: '#222222', fontSize: '14px', letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    cursor: !chosen || savingId === entry.eventId ? 'not-allowed' : 'pointer',
                    opacity: !chosen || savingId === entry.eventId ? 0.45 : 1,
                  }}
                >
                  {savingId === entry.eventId ? 'Assigning…' : 'Assign'}
                </button>
              </div>
              {message && <p role="alert" style={{ margin: 0, color: color.silver }}>{message}</p>}
            </article>
          </Card>
        );
      })}
    </section>
  );
}

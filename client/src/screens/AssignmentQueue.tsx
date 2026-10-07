import { useEffect, useState } from 'react';
import { fetchAssignmentQueue, type QueueEntry } from '../api/assignmentQueue';
import { formatSgt } from '../venues/searchApi';
import { color } from '../theme';
import { Card, Fact, GhostButton, Notice } from '../ui';

const NOT_RECORDED = 'Not recorded';

/**
 * The Event Coordinator Lead's queue of submitted requests that no
 * coordinator holds yet (SG2-87), oldest submission first. Assigning a
 * coordinator (Assign coordinators) takes a request out of the queue.
 */
export default function AssignmentQueue({ accessToken }: { accessToken: string }) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAssignmentQueue(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setEntries(result.entries);
      else setError(result.kind === 'unauthorized'
        ? 'Only the Event Coordinator Lead can see the unassigned queue.'
        : 'The unassigned queue is temporarily unavailable. Please try again.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [accessToken, attempt]);

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
      </Card>
    );
  }
  return (
    <section aria-label="Unassigned queue" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: color.silver }}>
        {entries.length} {entries.length === 1 ? 'request' : 'requests'} awaiting a coordinator
      </h2>
      {entries.map((entry) => {
        const title = entry.name.trim() || 'Untitled request';
        const titleId = `queue-entry-${entry.eventId}`;
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
            </article>
          </Card>
        );
      })}
    </section>
  );
}

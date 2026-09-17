import { useEffect, useState } from 'react';
import { Badge, Card, Eyebrow, GhostButton, Notice } from '../ui';
import { color, rule } from '../theme';
import { badgeStyle } from '../mock/viewModel';
import { deleteEventRequestDraft, listMyEventRequests, type EventRequestDraft } from '../api/eventRequests';

function formatStatus(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * "My draft requests" — SG2-32's minimal slice of SG2-31: enough to see and
 * delete your own event requests. Not the full "see the state of my
 * requests" feature (no coordinator-facing view, no status history).
 */
export default function DraftRequests({ accessToken = null }: { accessToken?: string | null }) {
  // Remount on identity changes, immediately removing the previous user's data.
  return <MyDraftRequests key={accessToken} token={accessToken} />;
}

function MyDraftRequests({ token }: { token: string | null }) {
  const [requests, setRequests] = useState<EventRequestDraft[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    async function load() {
      const outcome = await listMyEventRequests(token!);
      if (cancelled) return;
      if (!outcome.ok) {
        setError(outcome.message);
        setLoading(false);
        return;
      }
      setRequests(outcome.requests);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  async function confirmDelete(eventId: number) {
    setDeletingId(eventId);
    setDeleteError('');
    const outcome = await deleteEventRequestDraft(String(eventId), token!);
    setDeletingId(null);
    if (!outcome.ok) {
      setDeleteError(outcome.message);
      return;
    }
    setRequests((current) => current.filter((request) => request.event_id !== eventId));
    setConfirmingId(null);
  }

  if (!token) {
    return (
      <Notice>
        <Eyebrow>Sign in required</Eyebrow>
        <span>Sign in with your account to view your requests.</span>
      </Notice>
    );
  }
  if (loading) return <p role="status">Loading your requests…</p>;
  if (error) {
    return (
      <Notice>
        <p role="alert">{error}</p>
        <GhostButton onClick={() => setAttempt((n) => n + 1)}>Retry</GhostButton>
      </Notice>
    );
  }

  if (requests.length === 0) {
    return (
      <Card style={{ gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No event requests yet</h2>
        <p style={{ margin: 0, color: color.silver }}>Drafts you save will appear here.</p>
      </Card>
    );
  }

  return (
    <section aria-label="My draft requests" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {deleteError && (
        <Notice>
          <p role="alert">{deleteError}</p>
        </Notice>
      )}
      {requests.map((request) => {
        const { badgeBg, badgeFg } = badgeStyle(request.status);
        return (
          <Card key={request.event_id} padding="24px 28px" style={{ gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
                borderBottom: rule.edge,
                paddingBottom: '16px'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Eyebrow>{`E-${request.event_id}`}</Eyebrow>
                <h2 style={{ margin: '8px 0 0', fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {request.name?.trim() || 'Untitled request'}
                </h2>
              </div>
              <Badge bg={badgeBg} fg={badgeFg}>
                {formatStatus(request.status)}
              </Badge>
            </div>
            {request.status === 'draft' &&
              (confirmingId === request.event_id ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                  <span role="alert" style={{ color: color.silver, fontSize: '13px' }}>
                    Delete this draft? This can't be undone.
                  </span>
                  <GhostButton onClick={() => confirmDelete(request.event_id)} disabled={deletingId === request.event_id}>
                    {deletingId === request.event_id ? 'Deleting…' : 'Confirm delete'}
                  </GhostButton>
                  <GhostButton onClick={() => setConfirmingId(null)} disabled={deletingId === request.event_id}>
                    Cancel
                  </GhostButton>
                </div>
              ) : (
                <GhostButton
                  onClick={() => {
                    setDeleteError('');
                    setConfirmingId(request.event_id);
                  }}
                >
                  Delete
                </GhostButton>
              ))}
          </Card>
        );
      })}
    </section>
  );
}

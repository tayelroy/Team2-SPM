import { useEffect, useState } from 'react';
import {
  assignCoordinator,
  fetchAssignable,
  type AssignableRequest,
  type CoordinatorOption,
} from '../api/eventRequests';
import { EventAuditDrawer } from '../components/EventAuditDrawer';
import { badgeStyle, statusLabel } from '../mock/viewModel';
import { color, radius, rule, surface } from '../theme';
import { Badge, Card, Eyebrow, GhostButton, GradientButton, Notice } from '../ui';

/**
 * Technical Support Staff assign an Event Coordinator to a request, or hand it
 * to a different one (SG2-33, SG2-34). Both are the same write, so one control
 * serves both; only its label changes once a coordinator is already set.
 * Each change is recorded in the event history (SG2-33/34 AC4), which opens
 * from the same card in SG2-40's history drawer.
 */
export default function CoordinatorAssignment({ accessToken }: { accessToken: string }) {
  const [requests, setRequests] = useState<AssignableRequest[]>([]);
  const [coordinators, setCoordinators] = useState<CoordinatorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [rowMessage, setRowMessage] = useState<Record<number, { text: string; failed: boolean }>>({});
  const [historyFor, setHistoryFor] = useState<{ eventId: number; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAssignable(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRequests(result.requests);
        setCoordinators(result.coordinators);
      } else {
        setError(
          result.kind === 'unauthorized'
            ? 'Only Technical Support Staff can assign coordinators. Sign in again.'
            : 'Requests are temporarily unavailable. Please try again later.',
        );
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, attempt]);

  async function assign(request: AssignableRequest, chosen: CoordinatorOption) {
    setSavingId(request.eventId);
    setRowMessage((current) => ({ ...current, [request.eventId]: { text: '', failed: false } }));
    const outcome = await assignCoordinator(request.eventId, chosen.userId, accessToken);
    setSavingId(null);
    if (!outcome.ok) {
      setRowMessage((current) => ({ ...current, [request.eventId]: { text: outcome.message, failed: true } }));
      return;
    }
    const { userId: coordinatorId, name } = chosen;
    setRequests((current) =>
      current.map((item) =>
        item.eventId === request.eventId ? { ...item, coordinatorId, coordinatorName: name } : item,
      ),
    );
    setRowMessage((current) => ({
      ...current,
      [request.eventId]: { text: `Assigned to ${name}.`, failed: false },
    }));
  }

  if (loading) return <p role="status">Loading requests…</p>;
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
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>Nothing to assign</h2>
        <p style={{ margin: 0, color: color.silver }}>
          Submitted requests appear here as soon as an organiser sends them for review.
        </p>
      </Card>
    );
  }

  return (
    <section aria-label="Requests awaiting a coordinator" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {requests.map((request) => {
        const { badgeBg, badgeFg } = badgeStyle(request.status);
        const selected = picked[request.eventId] ?? request.coordinatorId ?? '';
        const chosen = coordinators.find((option) => option.userId === selected);
        const message = rowMessage[request.eventId];
        const title = request.name.trim() || 'Untitled request';
        const selectId = `coordinator-${request.eventId}`;
        return (
          <Card key={request.eventId} padding="24px 28px" style={{ gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
                borderBottom: rule.edge,
                paddingBottom: '16px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Eyebrow>{`E-${request.eventId} · ${request.organisation || 'No organisation'}`}</Eyebrow>
                <h2 style={{ margin: '8px 0 0', fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {title}
                </h2>
              </div>
              <Badge bg={badgeBg} fg={badgeFg}>
                {statusLabel(request.status)}
              </Badge>
            </div>
            <p style={{ margin: 0, color: color.silver, fontSize: '14px' }}>
              Coordinator: {request.coordinatorName || 'Unassigned'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <label htmlFor={selectId} style={{ position: 'absolute', left: '-9999px' }}>
                {`Coordinator for ${title}`}
              </label>
              <select
                id={selectId}
                value={selected}
                onChange={(event) => setPicked((current) => ({ ...current, [request.eventId]: event.target.value }))}
                style={{
                  background: surface.field,
                  border: rule.control,
                  borderRadius: radius.sm,
                  padding: '13px 14px',
                  color: color.mist,
                  fontSize: '14px',
                }}
              >
                <option value="">Choose a coordinator</option>
                {coordinators.map((option) => (
                  <option key={option.userId} value={option.userId}>
                    {option.name}
                  </option>
                ))}
              </select>
              <GradientButton
                onClick={() => assign(request, chosen!)}
                disabled={savingId === request.eventId || !chosen || chosen.userId === request.coordinatorId}
              >
                {savingId === request.eventId ? 'Saving…' : request.coordinatorId ? 'Reassign' : 'Assign'}
              </GradientButton>
              <button
                type="button"
                className="organisation-button"
                aria-label={`View change history for ${title}`}
                onClick={() => setHistoryFor({ eventId: request.eventId, name: title })}
              >
                View Change History
              </button>
            </div>
            {message?.text && (
              <p role={message.failed ? 'alert' : 'status'} style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
                {message.text}
              </p>
            )}
          </Card>
        );
      })}
      {historyFor && (
        <EventAuditDrawer
          isOpen
          onClose={() => setHistoryFor(null)}
          eventId={historyFor.eventId}
          eventName={historyFor.name}
          accessToken={accessToken}
        />
      )}
    </section>
  );
}

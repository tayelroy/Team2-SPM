import { useEffect, useState } from 'react';
import {
  fetchCoordinatorOverview,
  type CoordinatorWorkload,
  type OverviewFilters,
  type SupervisedEvent,
} from '../api/coordinatorOverview';
import { assignCoordinator } from '../api/eventRequests';
import { EventAuditDrawer } from '../components/EventAuditDrawer';
import { badgeStyle, statusLabel } from '../mock/viewModel';
import { formatSgt } from '../venues/searchApi';
import { color, radius, rule, surface } from '../theme';
import { Badge, Card, Eyebrow, Fact, GhostButton, GradientButton, Notice } from '../ui';

const NO_FILTERS: OverviewFilters = { coordinatorId: '', status: '' };
const fieldStyle = {
  backgroundColor: surface.field, border: rule.control, borderRadius: radius.sm,
  padding: '13px 14px', color: color.mist, fontSize: '14px', minHeight: '44px', maxWidth: '100%',
} as const;

type Loaded = { events: SupervisedEvent[]; coordinators: CoordinatorWorkload[]; statuses: string[] };

/**
 * SG2-89: the Event Coordinator Lead's overview of the active events they
 * supervise (the ones whose coordinator they last assigned) and who holds
 * each one (AC1). Every coordinator is listed with how many of those events
 * they hold, so the Lead can see who is free (AC2), and the list filters by
 * coordinator and status (AC3). An event awaiting the organiser's
 * clarification stays here and can be reassigned without changing its status
 * (AC6).
 */
export default function CoordinatorOverview({ accessToken }: { accessToken: string }) {
  const [filters, setFilters] = useState<OverviewFilters>(NO_FILTERS);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [failure, setFailure] = useState<Record<number, string>>({});
  const [confirmation, setConfirmation] = useState('');
  const [historyFor, setHistoryFor] = useState<{ eventId: number; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchCoordinatorOverview(accessToken, filters).then((result) => {
      if (cancelled) return;
      if (result.ok) setData({ events: result.events, coordinators: result.coordinators, statuses: result.statuses });
      else if (result.kind === 'invalid') setError(result.message);
      else setError(result.kind === 'unauthorized'
        ? 'Only the Event Coordinator Lead can see the coordinator overview.'
        : 'The coordinator overview is temporarily unavailable. Please try again.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [accessToken, filters, attempt]);

  async function reassign(event: SupervisedEvent, title: string, chosen: CoordinatorWorkload) {
    setSavingId(event.eventId);
    setFailure((current) => ({ ...current, [event.eventId]: '' }));
    setConfirmation('');
    const outcome = await assignCoordinator(event.eventId, chosen.userId, accessToken);
    setSavingId(null);
    if (!outcome.ok) {
      setFailure((current) => ({ ...current, [event.eventId]: outcome.message }));
      return;
    }
    // AC6: a reassignment never moves the status, so say which one it kept.
    setConfirmation(`${title} is now with ${chosen.name}. It is still ${statusLabel(outcome.status ?? event.status)}.`);
    setPicked((current) => ({ ...current, [event.eventId]: '' }));
    setAttempt((n) => n + 1);
  }

  if (!data) {
    if (loading) return <p role="status">Loading the coordinator overview…</p>;
    return (
      <Notice>
        <p role="alert">{error}</p>
        <GhostButton onClick={() => setAttempt((n) => n + 1)}>Retry</GhostButton>
      </Notice>
    );
  }

  const filtered = Boolean(filters.coordinatorId || filters.status);
  const assignable = data.coordinators.filter((coordinator) => coordinator.assignable);
  return (
    <section aria-label="Coordinator overview" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <Card padding="24px 28px" style={{ gap: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>Coordinator workload</h2>
        <p style={{ margin: 0, color: color.silver, fontSize: '14px' }}>
          Active events you supervise, by coordinator. Choose one to see their events.
        </p>
        {data.coordinators.length === 0
          ? <p style={{ margin: 0, color: color.silver }}>No Event Coordinators yet.</p>
          : (
            <ul aria-label="Coordinator workload" style={{
              listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
            }}>
              {data.coordinators.map((coordinator) => {
                const selected = filters.coordinatorId === coordinator.userId;
                return (
                  <li key={coordinator.userId}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFilters((current) => ({ ...current, coordinatorId: selected ? '' : coordinator.userId }))}
                      style={{
                        width: '100%', minHeight: '44px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center',
                        background: selected ? surface.notice : surface.sunken, color: color.mist,
                        border: selected ? rule.raised : rule.control, borderRadius: radius.sm, padding: '12px 14px',
                      }}
                    >
                      <span style={{ overflowWrap: 'anywhere' }}>{coordinator.name}</span>
                      <span style={{ color: color.silver, fontSize: '13px', whiteSpace: 'nowrap' }}>
                        {coordinator.activeEvents} active {coordinator.activeEvents === 1 ? 'event' : 'events'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
      </Card>

      <div role="group" aria-label="Filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 220px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', color: color.silver }}>Coordinator</span>
          <select
            value={filters.coordinatorId}
            onChange={(event) => setFilters((current) => ({ ...current, coordinatorId: event.target.value }))}
            style={fieldStyle}
          >
            <option value="">All coordinators</option>
            {data.coordinators.map((coordinator) => <option key={coordinator.userId} value={coordinator.userId}>{coordinator.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 220px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', color: color.silver }}>Status</span>
          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            style={fieldStyle}
          >
            <option value="">All active statuses</option>
            {data.statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
        </label>
        <GhostButton onClick={() => setFilters(NO_FILTERS)} disabled={!filtered}>Clear filters</GhostButton>
      </div>

      {confirmation && <p role="status" style={{ margin: 0, color: color.mist }}>{confirmation}</p>}
      {loading && <p role="status" style={{ margin: 0, color: color.silver }}>Updating the overview…</p>}
      {error && (
        <Notice>
          <p role="alert">{error}</p>
          <GhostButton onClick={() => setAttempt((n) => n + 1)}>Retry</GhostButton>
        </Notice>
      )}

      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: color.silver }}>
        {data.events.length === 1 ? '1 active event' : `${data.events.length} active events`}
        {filtered ? (data.events.length === 1 ? ' matches these filters' : ' match these filters') : ' under your supervision'}
      </h2>
      {data.events.length === 0 && (
        <Card style={{ gap: '8px' }}>
          <p style={{ margin: 0, color: color.silver }}>
            {filtered
              ? 'No active events you supervise match these filters.'
              : 'Events appear here once you assign them a coordinator.'}
          </p>
        </Card>
      )}
      {data.events.map((event) => {
        const title = event.name.trim() || 'Untitled event';
        const { badgeBg, badgeFg } = badgeStyle(event.status);
        const selectId = `overview-coordinator-${event.eventId}`;
        const chosen = assignable.find((option) => option.userId === picked[event.eventId]);
        const saving = savingId === event.eventId;
        return (
          <Card key={event.eventId} padding="24px 28px" style={{ gap: '16px' }}>
            <article aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px 16px',
                flexWrap: 'wrap', borderBottom: rule.edge, paddingBottom: '16px',
              }}>
                <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                  <Eyebrow>{`E-${event.eventId} · ${event.organisation || 'No organisation'}`}</Eyebrow>
                  <h3 style={{ margin: '8px 0 0', fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</h3>
                </div>
                <Badge bg={badgeBg} fg={badgeFg}>{statusLabel(event.status)}</Badge>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '16px' }}>
                <Fact label="Coordinator" value={event.coordinatorName || 'Former coordinator'} />
                <Fact label="Proposed date and time" value={event.proposedDate ? formatSgt(event.proposedDate) : 'Not recorded'} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
                <label htmlFor={selectId} style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 220px', minWidth: 0 }}>
                  <span style={{ fontSize: '13px', color: color.silver }}>Reassign {title} to</span>
                  <select
                    id={selectId}
                    value={picked[event.eventId] ?? ''}
                    onChange={(change) => setPicked((current) => ({ ...current, [event.eventId]: change.target.value }))}
                    style={fieldStyle}
                  >
                    <option value="">Choose a coordinator</option>
                    {assignable.filter((option) => option.userId !== event.coordinatorId).map((option) => (
                      <option key={option.userId} value={option.userId}>{option.name}</option>
                    ))}
                  </select>
                </label>
                <GradientButton onClick={() => void reassign(event, title, chosen!)} disabled={!chosen || saving}>
                  {saving ? 'Saving…' : 'Reassign'}
                </GradientButton>
                <button
                  type="button"
                  className="organisation-button"
                  aria-label={`View change history for ${title}`}
                  onClick={() => setHistoryFor({ eventId: event.eventId, name: title })}
                >
                  View Change History
                </button>
              </div>
              {failure[event.eventId] && <p role="alert" style={{ margin: 0, color: color.silver }}>{failure[event.eventId]}</p>}
            </article>
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

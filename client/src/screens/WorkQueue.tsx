import { useEffect, useState } from 'react';
import { fetchWorkQueue, startEventReview, type QueueResult, type WorkItem, type WorkSelection } from '../api/workQueue';
import type { Role } from '../mock/types';
import EventPlanningDrawer from './EventPlanningDrawer';

const GROUPS = {
  'Event Coordinator': [['review', 'Awaiting review'], ['assigned', 'My assigned events']],
  'Venue Staff': [['venue', 'Booking requests awaiting decision']],
  'Technical Support Staff': [['equipment', 'Equipment requests awaiting decision']],
} as const;
type InternalRole = keyof typeof GROUPS;

const DETAIL_LABELS: Record<string, string> = {
  organisation: 'Client organisation', purpose: 'Purpose', description: 'Description',
  expected_attendance: 'Expected attendance', venue_requirements: 'Venue requirements',
  accessibility_needs: 'Accessibility needs', equipment_requirements: 'Equipment requirements',
  registration_needed: 'Registration needed', location: 'Location', capacity: 'Venue capacity',
  quantity: 'Quantity requested', notes: 'Request notes',
};
const KINDS = { event: 'Event request', venue: 'Venue booking request', equipment: 'Equipment request' };

export function isQueueRole(role: Role): role is InternalRole {
  return role === 'Event Coordinator' || role === 'Venue Staff' || role === 'Technical Support Staff';
}

function dateTime(value: string | null) {
  return value === null ? 'Date not set' : new Date(value).toLocaleString('en-SG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false,
  });
}

/** An event card's title is already the event name, so show its organisation
 * instead of repeating it. Requests are titled by resource, so name the event. */
function context(item: WorkItem) {
  const source = item.kind === 'event' ? item.details.organisation ?? 'Organisation not provided' : item.event_name;
  return `${source} · Event #${item.event_id}`;
}

/** SG2-35: opening a submitted request assigned to this coordinator is itself
 * the act of reviewing it, so the status moves to under_review here rather
 * than behind a separate button — the organiser sees it is being looked at.
 * Requests awaiting assignment are readable but never transition: only
 * Technical Support Staff assign a coordinator (SG2-33). */
function useOpenedForReview(item: WorkItem, accessToken?: string | null) {
  const [status, setStatus] = useState(item.status);
  const [error, setError] = useState('');
  const opensReview = item.kind === 'event' && item.assigned_to_me && item.status === 'submitted';

  useEffect(() => {
    if (!opensReview) return;
    let cancelled = false;
    startEventReview(item.event_id, accessToken).then(result => {
      if (cancelled) return;
      if (result.ok) setStatus(result.status);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [opensReview, item.event_id, accessToken]);

  return { status, error };
}

function ItemDetail({ item, accessToken }: { item: WorkItem; accessToken?: string | null }) {
  const { status, error } = useOpenedForReview(item, accessToken);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentDetails, setCurrentDetails] = useState(item.details);
  const [startsAt, setStartsAt] = useState(item.starts_at);

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  const isTerminal = ['cancelled', 'completed', 'rejected'].includes(currentStatus.toLowerCase());
  const canEditPlanning = item.kind === 'event' && item.assigned_to_me && !isTerminal;

  return (
    <article className="organisation-detail" aria-label={KINDS[item.kind]}>
      <div className="organisation-detail-header">
        <span>{KINDS[item.kind]} #{item.item_id}</span>
        <span className="work-queue-status">{currentStatus.replace(/_/g, ' ')}</span>
      </div>
      {error && <p role="alert" className="work-queue-empty">{error}</p>}
      {item.kind === 'event' && !item.assigned_to_me &&
        <p className="work-queue-empty">Awaiting assignment. Technical Support Staff assign a coordinator before it can be reviewed.</p>}
      <div className="organisation-detail-intro">
        <h2 tabIndex={-1} ref={node => node?.focus()}>{item.title}</h2>
        <p>{context(item)}</p>
        <p>{dateTime(startsAt)}{item.ends_at ? ` – ${dateTime(item.ends_at)}` : ''} (Singapore time)</p>
      </div>
      <dl className="organisation-detail-facts">
        {Object.entries(DETAIL_LABELS).filter(([key]) => key in currentDetails).map(([key, label]) => {
          const value = currentDetails[key];
          return <div key={key}><dt>{label}</dt><dd>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value ?? 'Not provided'}</dd></div>;
        })}
      </dl>
      {canEditPlanning && (
        <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
          <button
            type="button"
            className="organisation-button organisation-button-primary"
            onClick={() => setDrawerOpen(true)}
          >
            Edit Planning Information
          </button>
        </div>
      )}
      {canEditPlanning && (
        <EventPlanningDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          eventId={item.event_id}
          accessToken={accessToken}
          initialValues={{
            proposed_date: startsAt,
            expected_attendance: currentDetails.expected_attendance as number | null | undefined,
            venue_requirements: currentDetails.venue_requirements as string | null | undefined,
            equipment_requirements: currentDetails.equipment_requirements as string | null | undefined,
            accessibility_needs: currentDetails.accessibility_needs as string | null | undefined,
            registration_needed: Boolean(currentDetails.registration_needed),
            registration_capacity: currentDetails.registration_capacity as number | null | undefined,
            registration_opens_at: currentDetails.registration_opens_at as string | null | undefined,
            registration_closes_at: currentDetails.registration_closes_at as string | null | undefined,
            planning_notes: currentDetails.planning_notes as string | null | undefined,
            status: currentStatus,
          }}
          onSuccess={(updatedEvent) => {
            setCurrentStatus(updatedEvent.status);
            setStartsAt(updatedEvent.proposed_date);
            setCurrentDetails((prev) => ({
              ...prev,
              expected_attendance: updatedEvent.expected_attendance,
              venue_requirements: updatedEvent.venue_requirements,
              equipment_requirements: updatedEvent.equipment_requirements,
              accessibility_needs: updatedEvent.accessibility_needs,
              registration_needed: updatedEvent.registration_needed,
              registration_capacity: updatedEvent.registration_capacity,
              registration_opens_at: updatedEvent.registration_opens_at,
              registration_closes_at: updatedEvent.registration_closes_at,
              planning_notes: updatedEvent.planning_notes,
            }));
          }}
        />
      )}
    </article>
  );
}

function QueueContent({ role, accessToken, selection, onSelect }: {
  role: InternalRole;
  accessToken?: string | null;
  selection: WorkSelection | null;
  onSelect: (selection: WorkSelection) => void;
}) {
  const [result, setResult] = useState<QueueResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWorkQueue(accessToken, selection).then(data => {
      if (!cancelled) setResult(data);
    });
    return () => { cancelled = true; };
  }, [accessToken, selection]);

  if (!result) return <p role="status">Loading your work queue…</p>;
  if (!result.ok) return <p role="alert">{result.error}</p>;
  if (selection) return <ItemDetail item={result.items[0]} accessToken={accessToken} />;

  return <>
    <p className="work-queue-summary" role="status">{result.items.length} {result.items.length === 1 ? 'item' : 'items'} in your work queue</p>
    <div className="work-queue-groups">
      {GROUPS[role].map(([category, title]) => {
        const items = result.items.filter(item => item.category === category);
        return <section className="work-queue-group" key={category} aria-label={title}>
          <div className="work-queue-group-heading"><h3>{title}</h3><span>{items.length}</span></div>
          {items.length === 0 ? <p className="work-queue-empty">You’re all caught up. No items here.</p> :
            items.map(item => <button className="work-queue-item" type="button" key={`${item.kind}:${item.item_id}`}
              onClick={() => onSelect({ kind: item.kind, item_id: item.item_id })}>
              <span className="work-queue-item-meta"><span className="work-queue-status">{item.status.replace(/_/g, ' ')}</span><span>{KINDS[item.kind]} #{item.item_id}</span></span>
              <strong>{item.title}</strong>
              <span>{context(item)}</span>
              <span>{dateTime(item.starts_at)} (SGT)</span>
              <span className="work-queue-open">View {KINDS[item.kind].toLowerCase()} <span aria-hidden="true">↗</span></span>
            </button>)}
        </section>;
      })}
    </div>
  </>;
}

/** The parent keys this view by signed-in identity so neither a selection nor
 * an in-flight result can carry over to another account. */
export default function WorkQueue({ role, accessToken }: { role: InternalRole; accessToken?: string | null }) {
  const [selection, setSelection] = useState<WorkSelection | null>(null);
  const [revision, setRevision] = useState(0);
  return <div className="work-queue">
    <div className="work-queue-heading">
      {selection ? <button type="button" className="organisation-button" onClick={() => setSelection(null)}><span aria-hidden="true">← </span>Back to work queue</button> : <h2>Needs your attention</h2>}
      <button type="button" className="organisation-button" onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    <QueueContent key={`${selection?.kind}:${selection?.item_id}:${revision}`} role={role}
      accessToken={accessToken} selection={selection} onSelect={setSelection} />
  </div>;
}

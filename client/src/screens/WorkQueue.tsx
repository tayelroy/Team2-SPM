import { useEffect, useState } from 'react';
import { completeEvent } from '../api/eventRequests';
import { decideEventRequest, fetchWorkQueue, startEventReview, type Decision, type QueueResult, type WorkItem, type WorkSelection } from '../api/workQueue';
import type { Role } from '../mock/types';
import EventPlanningDrawer from './EventPlanningDrawer';
import ClarificationThread from '../components/ClarificationThread';
import EquipmentRequirements from '../components/EquipmentRequirements';
import EventAuditDrawer from '../components/EventAuditDrawer';
import { prefillFromEvent, type VenueSearchPrefill } from '../venues/searchPrefill';
import { BookingRequestFit } from '../venues/VenueFit';
import { BookingRequestConflicts } from '../venues/BookingConflicts';
import VenueDecision from '../venues/VenueDecision';
import type { BookingReadiness } from '../venues/suitabilityApi';
import { LAYOUT_LABELS, type Layout } from '../venues/layoutsApi';

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
  // SG2-48 AC2: what Venue Staff need to decide on a venue request.
  layout: 'Required layout', requested_by: 'Requested by',
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
 * the Event Coordinator Lead assigns a coordinator (SG2-97). */
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

  return { status, error, setStatus };
}

/** SG2-37: the coordinator reviewing a request decides its outcome. A
 * rejection must say why, so the organiser knows what to change before
 * resubmitting; approval may add a note but does not need one. */
function DecisionPanel({ eventId, accessToken, onDecided }: {
  eventId: number;
  accessToken?: string | null;
  onDecided: (status: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState('');

  async function decide(decision: Decision) {
    setError('');
    setPending(decision);
    const result = await decideEventRequest(eventId, decision, reason, accessToken);
    setPending(null);
    if (result.ok) onDecided(result.status);
    else setError(result.error);
  }

  return <section className="work-queue-decision" aria-label="Decide this request">
    <label htmlFor={`decision-reason-${eventId}`}>Reason (required to reject)</label>
    <textarea id={`decision-reason-${eventId}`} value={reason} rows={3}
      onChange={event => setReason(event.target.value)} />
    {error && <p role="alert" className="work-queue-empty">{error}</p>}
    <div className="work-queue-decision-actions">
      <button type="button" className="organisation-button" disabled={pending !== null}
        onClick={() => decide('approved')}>{pending === 'approved' ? 'Approving…' : 'Approve'}</button>
      <button type="button" className="organisation-button" disabled={pending !== null}
        onClick={() => decide('rejected')}>{pending === 'rejected' ? 'Rejecting…' : 'Reject'}</button>
    </div>
  </section>;
}

/** SG2-100 AC4: the assigned coordinator closes out an event once it has been
 * held. The button's disabled state is what makes a double-click send one
 * request; the server re-checks ownership, status and the end time itself. */
function CompletePanel({ eventId, endsAt, accessToken, onCompleted }: {
  eventId: number;
  endsAt: string | null;
  accessToken: string;
  onCompleted: (status: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function complete() {
    setError('');
    setPending(true);
    const result = await completeEvent(eventId, accessToken);
    setPending(false);
    if (result.ok) onCompleted('completed');
    else setError(result.message);
  }

  return <footer className="organisation-detail-footer" aria-label="Close out this event">
    <h3>Next step</h3>
    <p className="organisation-detail-hint">This event ended on {dateTime(endsAt)} (Singapore time). Mark it completed to close it out; it then leaves your active work queue and can no longer be changed.</p>
    {error && <p role="alert" className="organisation-detail-notice">{error}</p>}
    <button type="button" className="organisation-button organisation-button-primary" style={{ alignSelf: 'flex-start' }}
      disabled={pending} onClick={complete}>{pending ? 'Marking as Completed…' : 'Mark as Completed'}</button>
  </footer>;
}

export type FindVenues = (prefill: VenueSearchPrefill) => void;

function ItemDetail({ item, accessToken, onFindVenues }: { item: WorkItem; accessToken?: string | null; onFindVenues?: FindVenues }) {
  const { status, error, setStatus } = useOpenedForReview(item, accessToken);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentDetails, setCurrentDetails] = useState(item.details);
  const [startsAt, setStartsAt] = useState(item.starts_at);
  // SG2-49: whether the venue request may be approved, from its suitability check.
  const [readiness, setReadiness] = useState<BookingReadiness | null>(null);

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  const isTerminal = ['cancelled', 'completed', 'rejected'].includes(currentStatus.toLowerCase());
  const canEditPlanning = item.kind === 'event' && item.assigned_to_me && !isTerminal;
  const canDecide = item.kind === 'event' && item.assigned_to_me && currentStatus === 'under_review';
  // SG2-36: while reviewing, the coordinator can ask instead of deciding; once
  // returned, they can add follow-ups until the organiser resubmits.
  const canClarify = item.kind === 'event' && item.assigned_to_me
    && (currentStatus === 'under_review' || currentStatus === 'needs_clarification');
  // SG2-100 AC4: `ends_at` is the latest of the event's confirmed venue
  // bookings (internal_work_items); null means nothing says when it ends,
  // which reads as "not finished", never as finished. This only decides
  // whether to offer the action — the server re-checks all of it.
  const canComplete = item.kind === 'event' && item.assigned_to_me
    && (currentStatus === 'confirmed' || currentStatus === 'preparation')
    && item.ends_at !== null && Date.parse(item.ends_at) <= Date.now();

  return (
    <article className="organisation-detail" aria-label={KINDS[item.kind]}>
      <div className="organisation-detail-header">
        <span>{KINDS[item.kind]} #{item.item_id}</span>
        <span className="work-queue-status">{currentStatus.replace(/_/g, ' ')}</span>
      </div>
      {error && <p role="alert" className="work-queue-empty">{error}</p>}
      {item.kind === 'event' && !item.assigned_to_me &&
        <p className="work-queue-empty">Awaiting assignment. The Event Coordinator Lead assigns a coordinator before it can be reviewed.</p>}
      <div className="organisation-detail-intro">
        <h2 tabIndex={-1} ref={node => node?.focus()}>{item.title}</h2>
        <p>{context(item)}</p>
        {/* An event's start is its proposed date but its end is its latest
            confirmed booking (SG2-100), so the two are not shown as one range. */}
        <p>{dateTime(startsAt)}{item.kind !== 'event' && item.ends_at ? ` – ${dateTime(item.ends_at)}` : ''} (Singapore time)</p>
      </div>
      <dl className="organisation-detail-facts">
        {Object.entries(DETAIL_LABELS).filter(([key]) => key in currentDetails).map(([key, label]) => {
          const value = key === 'layout' && typeof currentDetails.layout === 'string'
            ? LAYOUT_LABELS[currentDetails.layout as Layout] : currentDetails[key];
          return <div key={key}><dt>{label}</dt><dd>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value ?? 'Not provided'}</dd></div>;
        })}
      </dl>
      {/* SG2-100: the safety-check and preparation stages sit between
          planning and confirmed, so the requirements stay visible through
          them; the RPC decides what is still editable. */}
      {(item.kind === 'equipment' || (item.kind === 'event' && item.assigned_to_me
        && ['approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'].includes(currentStatus))) && (
        <EquipmentRequirements eventId={item.event_id} accessToken={accessToken} />
      )}
      {canDecide && <DecisionPanel eventId={item.event_id} accessToken={accessToken} onDecided={setStatus} />}
      {canClarify && accessToken && <ClarificationThread
        eventId={item.event_id}
        accessToken={accessToken}
        canPost
        prompt={currentStatus === 'under_review' ? 'Ask the organiser a question' : 'Add a follow-up question'}
        onPosted={setStatus}
      />}
      {item.kind === 'event' && (
        <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
          {canEditPlanning && (
            <button
              type="button"
              className="organisation-button organisation-button-primary"
              onClick={() => setDrawerOpen(true)}
            >
              Edit Planning Information
            </button>
          )}
          <button
            type="button"
            className="organisation-button"
            onClick={() => setHistoryDrawerOpen(true)}
          >
            View Change History
          </button>
        </div>
      )}
      {item.kind === 'event' && item.assigned_to_me && currentStatus === 'approved' && onFindVenues && (
        <footer className="organisation-detail-footer">
          <h3>Next step</h3>
          <p className="organisation-detail-hint">Find venues that fit this event and are free on its date.</p>
          <button type="button" className="organisation-button organisation-button-primary" style={{ alignSelf: 'flex-start' }}
            onClick={() => onFindVenues(prefillFromEvent({ ...item, starts_at: startsAt, details: currentDetails }))}>Find venues for this event</button>
        </footer>
      )}
      {canComplete && accessToken && <CompletePanel eventId={item.event_id} endsAt={item.ends_at} accessToken={accessToken} onCompleted={setStatus} />}
      {item.kind === 'event' && currentStatus === 'completed' && <footer className="organisation-detail-footer">
        <p role="status" className="organisation-detail-notice">Marked as completed. This event has left your active work queue.</p>
      </footer>}
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
      {item.kind === 'venue' && <BookingRequestFit accessToken={accessToken} requestId={item.item_id} onReadiness={setReadiness} />}
      {/* SG2-50 AC1: anything else committing the venue over the requested period. */}
      {item.kind === 'venue' && <BookingRequestConflicts accessToken={accessToken} requestId={item.item_id} />}
      {item.kind === 'venue' && <VenueDecision requestId={item.item_id} accessToken={accessToken}
        holdId={typeof currentDetails.hold_id === 'number' ? currentDetails.hold_id : null} readiness={readiness} onDecided={setStatus} />}
      {item.kind === 'event' && (
        <EventAuditDrawer
          isOpen={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
          eventId={item.event_id}
          eventName={item.title}
          accessToken={accessToken}
        />
      )}
    </article>
  );
}

function QueueContent({ role, accessToken, selection, onSelect, onFindVenues }: {
  role: InternalRole;
  accessToken?: string | null;
  selection: WorkSelection | null;
  onSelect: (selection: WorkSelection) => void;
  onFindVenues?: FindVenues;
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
  if (selection) return <ItemDetail item={result.items[0]} accessToken={accessToken} onFindVenues={onFindVenues} />;

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
export default function WorkQueue({ role, accessToken, onFindVenues }: { role: InternalRole; accessToken?: string | null; onFindVenues?: FindVenues }) {
  const [selection, setSelection] = useState<WorkSelection | null>(null);
  const [revision, setRevision] = useState(0);
  return <div className="work-queue">
    <div className="work-queue-heading">
      {selection ? <button type="button" className="organisation-button" onClick={() => setSelection(null)}><span aria-hidden="true">← </span>Back to work queue</button> : <h2>Needs your attention</h2>}
      <button type="button" className="organisation-button" onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    <QueueContent key={`${selection?.kind}:${selection?.item_id}:${revision}`} role={role}
      accessToken={accessToken} selection={selection} onSelect={setSelection} onFindVenues={onFindVenues} />
  </div>;
}

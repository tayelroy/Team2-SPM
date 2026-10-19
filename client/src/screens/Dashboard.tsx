import { useEffect, useState } from 'react';
import { ATTENDEE_ACTIONS, ATTENDEE_STATS } from '../mock/data';
import type { EventCard, Role, Screen } from '../mock/types';
import { eventCards } from '../mock/viewModel';
import { color, radius, rule, surface } from '../theme';
import {
  Badge,
  Card,
  Dot,
  GhostButton,
  IconButton,
  RecessedCard,
  StatFigure,
} from '../ui';
import { fetchOwnEventRequests, type EventRequestSummary } from '../api/eventRequests';
import { fetchAssignmentQueue } from '../api/assignmentQueue';
import { fetchSafetyChecks } from '../api/safetyChecks';
import { badgeStyle, eventActionLabel, statusLabel } from '../mock/viewModel';
import { formatProposedDate } from './EventsTable';
import WorkQueue, { isQueueRole, type FindVenues } from './WorkQueue';

/** One event summary in the left-hand list — the whole tile is the trigger. */
function EventTile({ event, onOpen }: { event: EventCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        textAlign: 'left',
        background: surface.sunken,
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: radius.card,
        padding: '20px 22px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <Badge bg={event.badgeBg} fg={event.badgeFg}>
          {statusLabel(event.status)}
        </Badge>
        <span
          style={{
            fontSize: '10px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: color.slate,
          }}
        >
          {event.ref}
        </span>
      </div>
      <span
        style={{
          fontSize: '20px',
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: color.platinum,
        }}
      >
        {event.name}
      </span>
      <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.silver }}>
        {event.meta}
      </span>
      <span style={{ fontSize: '13px', lineHeight: 1.4, color: color.mist }}>
        {event.next}
      </span>
    </button>
  );
}

/**
 * Role-scoped landing view inside the app: headline figures, the events that
 * need attention, an action queue, and — for operational roles — the pipeline.
 */
interface DashboardProps {
  role: Role;
  accessToken?: string | null;
  onNavigate: (screen: Screen, eventId?: number) => void;
  /** SG2-46: open venue search pre-filled from an approved event. */
  onFindVenues?: FindVenues;
}

function OrganisationDashboard({ accessToken, onNavigate }: DashboardProps) {
  const [requests, setRequests] = useState<EventRequestSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!accessToken) {
      setState('error');
      return;
    }
    let cancelled = false;
    setState('loading');
    fetchOwnEventRequests(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRequests(result.requests);
        setState('ready');
      } else {
        setState('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  const waiting = requests.filter((event) => event.waitingOnMe);
  const figures = [
    { label: 'Organisation events', value: requests.length },
    // Counts what My drafts lists: drafts plus requests returned with a question (SG2-36).
    { label: 'My drafts', value: requests.filter((event) => event.canManage && ['draft', 'needs_clarification'].includes(event.status)).length },
    { label: 'Waiting on me', value: waiting.length },
  ];
  return <div className="organisation-dashboard">
    <div className="organisation-summary">
      {figures.map((stat) => (
        <div className="organisation-summary-stat" key={stat.label}>
          <strong>{state === 'ready' ? String(stat.value) : '—'}</strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </div>
    <Card padding="28px" style={{ gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '24px', color: color.platinum }}>Your organisation’s events</h2>
        <IconButton label="See all events" onClick={() => onNavigate('events')}>↗</IconButton>
      </div>
      {state === 'loading' ? (
        <p role="status">Loading event requests…</p>
      ) : state === 'error' ? (
        <p role="alert">Event requests are unavailable. Open My events to try again.</p>
      ) : requests.length === 0 ? (
        <p role="status">No event requests found.</p>
      ) : requests.slice(0, 4).map((event) => {
        const badge = badgeStyle(event.status);
        return <button
          key={event.eventId}
          className="organisation-dashboard-event"
          type="button"
          onClick={() => onNavigate('detail', event.eventId)}
          style={{
            display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left',
            padding: '20px', background: surface.sunken, border: rule.faint,
            borderRadius: radius.card, color: color.platinum, cursor: 'pointer',
          }}
        >
          <span><Badge bg={badge.badgeBg} fg={badge.badgeFg}>{statusLabel(event.status)}</Badge> <span style={{ color: color.silver }}>#{event.eventId}</span></span>
          <strong style={{ fontSize: '20px', overflowWrap: 'anywhere' }}>{event.name || 'Untitled event'}</strong>
          <span style={{ color: color.silver }}>{formatProposedDate(event.proposedDate)} · {event.coordinatorName || 'Unassigned'}</span>
          <span style={{ color: color.mist }}>{eventActionLabel(event)}</span>
        </button>;
      })}
    </Card>
  </div>;
}

/**
 * The Event Coordinator Lead's desk (SG2-86 AC2): a live count of the
 * unassigned queue (SG2-87, `GET /api/assignment-queue`) and the way into
 * it. Assigning is the page's primary action (SG2-97). Nothing here comes
 * from prototype data, and nothing opens a screen the Lead cannot use.
 */
function LeadDashboard({ accessToken, onNavigate }: DashboardProps) {
  const [waiting, setWaiting] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'unauthorized' | 'unavailable'>('loading');
  useEffect(() => {
    if (!accessToken) {
      setState('unauthorized');
      return;
    }
    let cancelled = false;
    fetchAssignmentQueue(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setWaiting(result.entries.length);
        setState('ready');
      } else {
        setState(result.kind);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  return (
    <Card padding="28px" style={{ gap: '16px' }}>
      <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500, color: color.platinum }}>Unassigned queue</h2>
      {state === 'loading' ? (
        <p role="status" style={{ margin: 0 }}>Loading the unassigned queue…</p>
      ) : state === 'ready' ? (
        <p style={{ margin: 0, fontSize: '18px', color: color.mist }}>
          {waiting} {waiting === 1 ? 'request is' : 'requests are'} awaiting a coordinator.
        </p>
      ) : (
        <p role="alert" style={{ margin: 0 }}>
          {state === 'unauthorized'
            ? 'Only the Event Coordinator Lead can see the unassigned queue.'
            : 'The unassigned queue is temporarily unavailable. Open it to try again.'}
        </p>
      )}
      <GhostButton onClick={() => onNavigate('queue')} style={{ alignSelf: 'flex-start' }}>
        Open unassigned queue
      </GhostButton>
    </Card>
  );
}

/**
 * The Safety Officer's desk (SG2-86 AC2): a live count of the events awaiting
 * an operational safety check (SG2-91 AC2, `GET /api/safety-checks`) and the
 * way into the list.
 */
function SafetyDashboard({ accessToken, onNavigate }: DashboardProps) {
  const [waiting, setWaiting] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'unauthorized' | 'unavailable'>('loading');
  useEffect(() => {
    if (!accessToken) {
      setState('unauthorized');
      return;
    }
    let cancelled = false;
    fetchSafetyChecks(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setWaiting(result.events.length);
        setState('ready');
      } else {
        setState(result.kind);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  return (
    <Card padding="28px" style={{ gap: '16px' }}>
      <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500, color: color.platinum }}>Safety checks</h2>
      {state === 'loading' ? (
        <p role="status" style={{ margin: 0 }}>Loading events awaiting a safety check…</p>
      ) : state === 'ready' ? (
        <p style={{ margin: 0, fontSize: '18px', color: color.mist }}>
          {waiting} {waiting === 1 ? 'event is' : 'events are'} awaiting a safety check.
        </p>
      ) : (
        <p role="alert" style={{ margin: 0 }}>
          {state === 'unauthorized'
            ? 'Only Safety Officers can open the safety check list.'
            : 'The safety check list is temporarily unavailable. Open it to try again.'}
        </p>
      )}
      <GhostButton onClick={() => onNavigate('safetyChecks')} style={{ alignSelf: 'flex-start' }}>
        Open safety checks
      </GhostButton>
    </Card>
  );
}

export default function Dashboard(props: DashboardProps) {
  const { role } = props;
  if (role === 'Event Organiser') return <OrganisationDashboard key={props.accessToken} {...props} />;
  if (isQueueRole(role)) return <WorkQueue key={`${role}:${props.accessToken}`} role={role} accessToken={props.accessToken} onFindVenues={props.onFindVenues} />;
  if (role === 'Event Coordinator Lead') return <LeadDashboard key={props.accessToken} {...props} />;
  if (role === 'Safety Officer') return <SafetyDashboard key={props.accessToken} {...props} />;
  return <AttendeeDashboard onNavigate={props.onNavigate} />;
}

/** The Attendee's dashboard: still the clickable prototype, by design. */
function AttendeeDashboard({ onNavigate }: Pick<DashboardProps, 'onNavigate'>) {
  const cards = eventCards('Attendee').slice(0, 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: '20px',
        }}
      >
        {ATTENDEE_STATS.map((stat) => (
          <Card key={stat.label} padding="28px 30px" style={{ gap: '10px' }}>
            <StatFigure value={stat.value} label={stat.label} />
          </Card>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        <Card style={{ gap: '24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 500,
                lineHeight: 1.3,
                letterSpacing: '-0.02em',
                color: color.platinum,
              }}
            >
              Events I can register for
            </h2>
            <IconButton label="See all events" onClick={() => onNavigate('events')}>
              ↗
            </IconButton>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {cards.map((event) => (
              <EventTile
                key={event.ref}
                event={event}
                onOpen={() => onNavigate('attendee')}
              />
            ))}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <RecessedCard style={{ gap: '20px' }}>
            <h2
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 500,
                lineHeight: 1.3,
                letterSpacing: '-0.02em',
                color: color.platinum,
              }}
            >
              Needs your attention
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {ATTENDEE_ACTIONS.map((action) => (
                <div
                  key={action.title}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    paddingBottom: '14px',
                    borderBottom: rule.faint,
                  }}
                >
                  <Dot tone={action.dot} style={{ marginTop: '7px' }} />
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: '15px', color: color.platinum }}>
                      {action.title}
                    </span>
                    <span
                      style={{ fontSize: '13px', lineHeight: 1.4, color: color.silver }}
                    >
                      {action.body}
                    </span>
                  </div>
                  <IconButton
                    label={`Open: ${action.title}`}
                    onClick={() => onNavigate(action.screen)}
                  >
                    ↗
                  </IconButton>
                </div>
              ))}
            </div>
          </RecessedCard>

        </div>
      </div>
    </div>
  );
}

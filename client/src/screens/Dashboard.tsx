import { useEffect, useState } from 'react';
import { PIPELINE, STATS } from '../mock/data';
import type { EventCard, Role, Screen } from '../mock/types';
import {
  actionsFor,
  dashboardListTitle,
  eventCards,
  showsPipeline,
} from '../mock/viewModel';
import { color, radius, rule, surface } from '../theme';
import {
  Badge,
  Card,
  Dot,
  Eyebrow,
  IconButton,
  ProgressBar,
  RecessedCard,
  StatFigure,
} from '../ui';
import { fetchOwnEventRequests, type EventRequestSummary } from '../api/eventRequests';
import { badgeStyle } from '../mock/viewModel';
import { formatProposedDate } from './EventsTable';

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
          {event.status}
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
    { label: 'My drafts', value: requests.filter((event) => event.canManage && event.status === 'draft').length },
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
          <span><Badge bg={badge.badgeBg} fg={badge.badgeFg}>{event.status}</Badge> <span style={{ color: color.silver }}>#{event.eventId}</span></span>
          <strong style={{ fontSize: '20px', overflowWrap: 'anywhere' }}>{event.name || 'Untitled event'}</strong>
          <span style={{ color: color.silver }}>{formatProposedDate(event.proposedDate)} · {event.coordinatorName || 'Unassigned'}</span>
          <span style={{ color: color.mist }}>{!event.canManage ? 'View only' : event.waitingOnMe ? 'Waiting on you' : 'With coordinator'}</span>
        </button>;
      })}
    </Card>
  </div>;
}

export default function Dashboard(props: DashboardProps) {
  if (props.role === 'Event Organiser') return <OrganisationDashboard key={props.accessToken} {...props} />;
  const { role, onNavigate } = props;
  const cards = eventCards(role).slice(0, 4);
  const openEvent = role === 'Attendee' ? 'attendee' : 'detail';
  // Expand the operational summary to the full event table.
  const expandTo = 'events';

  const stats = STATS[role];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: '20px',
        }}
      >
        {stats.map((stat) => (
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
              {dashboardListTitle(role)}
            </h2>
            <IconButton label="See all events" onClick={() => onNavigate(expandTo)}>
              ↗
            </IconButton>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {cards.map((event) => (
              <EventTile
                key={event.ref}
                event={event}
                onOpen={() => onNavigate(openEvent)}
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
              {actionsFor(role).map((action) => (
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

          {showsPipeline(role) ? (
            <Card style={{ gap: '14px' }}>
              <Eyebrow>Where things stand</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {PIPELINE.map((stage) => (
                  <div
                    key={stage.label}
                    style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span
                        style={{
                          fontSize: '13px',
                          letterSpacing: '0.055em',
                          textTransform: 'uppercase',
                          color: color.mist,
                        }}
                      >
                        {stage.label}
                      </span>
                      <span style={{ fontSize: '13px', color: color.silver }}>
                        {stage.count}
                      </span>
                    </div>
                    <ProgressBar pct={stage.pct} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

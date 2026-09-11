import { canOpen, usePageAccess } from '../auth/pages';
import { PIPELINE, STATS } from '../mock/data';
import type { EventCard, Role, ProtectedScreen } from '../mock/types';
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
export default function Dashboard({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate: (screen: ProtectedScreen) => void;
}) {
  const { access } = usePageAccess();
  const cards = eventCards(role).slice(0, 4);
  const openEvent = role === 'Attendee' ? 'attendee' : 'detail';
  // An organiser has no list view to expand into, so the arrow goes to detail.
  const expandTo = role === 'Event Organiser' ? 'detail' : 'events';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: '20px',
        }}
      >
        {STATS[role].map((stat) => (
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
            {canOpen(access, expandTo) ? <IconButton label="See all events" onClick={() => onNavigate(expandTo)}>
              ↗
            </IconButton> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {cards.filter(() => canOpen(access, openEvent)).map((event) => (
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
              {actionsFor(role).filter(action => canOpen(access, action.screen)).map((action) => (
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

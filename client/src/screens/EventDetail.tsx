import { ACTIVITY, ARRANGEMENTS, STATUS_TRAIL } from '../mock/data';
import type { Role, Screen } from '../mock/types';
import { currentEvent, detailActions, statusTrailStyle } from '../mock/viewModel';
import { color, radius, rule, surface } from '../theme';
import {
  Badge,
  Card,
  Dot,
  Eyebrow,
  Fact,
  Notice,
  NoticeMark,
  RecessedCard,
} from '../ui';

/**
 * The full request: facts, status trail, activity log, and the action panel —
 * which is where the role split is sharpest. Coordinators get decision
 * actions; organisers get amendment actions.
 */
export default function EventDetail({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate: (screen: Screen) => void;
}) {
  const event = currentEvent(role);
  const isCoordinator = role === 'Event Coordinator';
  const facts = [
    { label: 'Client', value: event.client },
    { label: 'Date & time', value: `${event.date} · 10:00–17:00` },
    { label: 'Expected attendance', value: String(event.attendance) },
    { label: 'Venue', value: event.venue },
    { label: 'Coordinator', value: event.coordinator },
    { label: 'Accessibility', value: 'Step-free, hearing loop' },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
        gap: '20px',
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Card style={{ gap: '24px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              alignItems: 'center',
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
          <h2
            style={{
              margin: 0,
              fontSize: '36px',
              fontWeight: 500,
              lineHeight: 1,
              color: color.platinum,
            }}
          >
            {event.name}
          </h2>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.4, color: color.silver }}>
            {event.purpose}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
              gap: '20px',
            }}
          >
            {facts.map((f) => (
              <Fact key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {STATUS_TRAIL.map((stage, i) => {
              const style = statusTrailStyle(i);
              return (
                <Badge key={stage} bg={style.bg} fg={style.fg}>
                  {stage}
                </Badge>
              );
            })}
          </div>
        </Card>

        {/* Attendees never see the internal suitability check. */}
        {role !== 'Attendee' ? (
          <Notice style={{ flexDirection: 'row', gap: '16px', alignItems: 'flex-start' }}>
            <NoticeMark size={26} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '16px', color: color.platinum }}>
                Capacity check: expected 180 guests, Kelp Room holds 120
              </span>
              <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.silver }}>
                Pick a larger venue or lower expected attendance before requesting the
                booking. Atrium Hall (320) and Deepwater Auditorium (500) are free on
                this date.
              </span>
            </div>
          </Notice>
        ) : null}

        <RecessedCard style={{ gap: '24px' }}>
          <h3
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: color.platinum,
            }}
          >
            Activity
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {ACTIVITY.map((entry) => (
              <div key={entry.when} style={{ display: 'flex', gap: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    flex: 'none',
                  }}
                >
                  <Dot tone={entry.dot} />
                  <div
                    style={{ flex: 1, width: '1px', background: 'rgba(255,255,255,0.12)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: color.slate,
                    }}
                  >
                    {entry.when} · {entry.who}
                  </span>
                  <span style={{ fontSize: '15px', lineHeight: 1.4, color: color.mist }}>
                    {entry.text}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <input
              placeholder="Add a comment or clarification…"
              aria-label="Add a comment or clarification"
              style={{
                flex: '1 1 220px',
                background: surface.fieldOnAbyss,
                border: rule.control,
                borderRadius: radius.sm,
                padding: '13px 14px',
                color: color.mist,
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <button
              type="button"
              style={{
                background: color.kelp,
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: radius.sm,
                padding: '13px 20px',
                color: color.platinum,
                fontSize: '14px',
                letterSpacing: '0.06em',
                cursor: 'pointer',
              }}
            >
              Post
            </button>
          </div>
        </RecessedCard>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Card style={{ gap: '18px' }}>
          <Eyebrow>{isCoordinator ? 'Review actions' : 'Your options'}</Eyebrow>
          {detailActions(role).map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onNavigate(action.screen)}
              style={{
                textAlign: 'left',
                background: action.bg,
                border: `1px solid ${action.bd}`,
                borderRadius: radius.sm,
                padding: '14px 18px',
                color: action.fg,
                fontSize: '14px',
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          ))}
          <span style={{ fontSize: '13px', lineHeight: 1.4, color: color.silver }}>
            {isCoordinator
              ? 'Approving moves the event into planning and unlocks venue and equipment booking.'
              : 'Changes after submission go to your coordinator for review.'}
          </span>
        </Card>

        <RecessedCard style={{ gap: '18px' }}>
          <Eyebrow>Confirmed arrangements</Eyebrow>
          {ARRANGEMENTS.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '14px',
                paddingBottom: '12px',
                borderBottom: rule.faint,
              }}
            >
              <span style={{ fontSize: '15px', color: color.platinum }}>{row.label}</span>
              <span
                style={{
                  fontSize: '13px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: row.fg,
                }}
              >
                {row.state}
              </span>
            </div>
          ))}
        </RecessedCard>
      </div>
    </div>
  );
}

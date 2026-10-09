import type { CSSProperties } from 'react';
import type {
  EventArrangementsResult,
  ArrangementState
} from '../api/eventRequests';
import { color, radius, rule } from '../theme';
import { Badge, Eyebrow } from '../ui';

export interface EventArrangementsPanelProps {
  arrangements: EventArrangementsResult;
  style?: CSSProperties;
}

const STATE_BADGE: Record<ArrangementState, { label: string; bg: string; fg: string }> = {
  ready: { label: 'Ready', bg: 'rgba(0, 130, 124, 0.35)', fg: color.accent },
  outstanding: { label: 'Outstanding', bg: 'rgba(255, 180, 0, 0.16)', fg: '#fde047' },
  not_required: { label: 'Not required', bg: 'rgba(255, 255, 255, 0.06)', fg: color.slate }
};

/**
 * Shows which of an event's arrangements are in place and whether it is ready
 * for confirmation (SG2-57). Each arrangement is labelled Ready, Outstanding or
 * Not required, with a one-line detail; the header states overall readiness.
 */
export default function EventArrangementsPanel({ arrangements, style }: EventArrangementsPanelProps) {
  const ready = arrangements.ready_for_confirmation;

  return (
    <section
      aria-label="Event arrangement readiness"
      data-testid="arrangements-panel"
      style={{
        background: color.kelp,
        borderRadius: radius.card,
        border: rule.edge,
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        ...style
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <Eyebrow>ARRANGEMENTS</Eyebrow>
        <span data-testid="readiness-badge">
          <Badge
            bg={ready ? 'rgba(0, 130, 124, 0.35)' : 'rgba(255, 180, 0, 0.16)'}
            fg={ready ? color.accent : '#fde047'}
            size={11}
          >
            {ready ? 'Ready for confirmation' : 'Arrangements outstanding'}
          </Badge>
        </span>
      </div>

      <ul
        role="list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        {arrangements.arrangements.map((arrangement) => {
          const badge = STATE_BADGE[arrangement.state];
          return (
            <li
              key={arrangement.key}
              data-testid={`arrangement-${arrangement.key}`}
              style={{
                background: color.deep,
                borderRadius: radius.card,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                <span style={{ fontSize: '15px', fontWeight: 600, color: color.platinum }}>
                  {arrangement.label}
                </span>
                <span style={{ fontSize: '13px', color: color.silver, lineHeight: 1.4 }}>
                  {arrangement.detail}
                </span>
              </div>
              <span data-testid={`arrangement-${arrangement.key}-state`}>
                <Badge bg={badge.bg} fg={badge.fg} size={11}>
                  {badge.label}
                </Badge>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

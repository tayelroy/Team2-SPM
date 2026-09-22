import type { CSSProperties } from 'react';
import type { EventStageResult } from '../api/eventRequests';
import { color, gradient, radius, rule } from '../theme';
import { Badge, Eyebrow } from '../ui';

export interface EventStageTrackerProps {
  stage: EventStageResult;
  style?: CSSProperties;
}

/**
 * Visual Lifecycle Stage Tracker Component (SG2-38).
 *
 * Displays:
 * 1. Current stage badge in plain language and descriptive sub-label.
 * 2. 5-step visual pipeline stepper (Draft → Submitted → Under Review → Approved — In Planning → Confirmed).
 * 3. Prominent "Waiting On" responsibility card showing the active persona and next required action.
 */
export default function EventStageTracker({ stage, style }: EventStageTrackerProps) {
  const steps = stage.stepper_steps || [];
  const waitingOn = stage.waiting_on;

  return (
    <section
      aria-label="Event stage progress"
      style={{
        background: color.kelp,
        borderRadius: radius.card,
        border: rule.edge,
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        ...style,
      }}
    >
      {/* Top row: Stage Header & Plain-Language Stage Badge */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Eyebrow>CURRENT STAGE</Eyebrow>
          <div
            data-testid="stage-badge"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}
          >
            <Badge bg="rgba(0, 130, 124, 0.35)" fg={color.accent} size={12}>
              {stage.stage}
            </Badge>
          </div>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '14px',
              lineHeight: 1.45,
              color: color.silver,
              maxWidth: '680px',
            }}
          >
            {stage.description}
          </p>
        </div>

        {stage.arrangements_recheck_needed && (
          <Badge bg="rgba(255, 180, 0, 0.16)" fg="#fde047" size={11}>
            Arrangements Recheck Needed
          </Badge>
        )}
      </div>

      {/* Stepper Pipeline */}
      <div
        role="list"
        aria-label="Lifecycle steps"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          position: 'relative',
          padding: '12px 0 6px',
          overflowX: 'auto',
          gap: '8px',
        }}
      >
        {steps.map((step, idx) => {
          const isCompleted = step.status === 'completed';
          const isCurrent = step.status === 'current';

          const circleBg = isCompleted
            ? 'rgba(0, 130, 124, 0.35)'
            : isCurrent
              ? 'rgba(203, 255, 252, 0.18)'
              : 'rgba(1, 29, 28, 0.6)';

          const circleBorder = isCompleted
            ? `1px solid ${color.accent}`
            : isCurrent
              ? `2px solid ${color.accent}`
              : '1px solid rgba(255, 255, 255, 0.12)';

          const circleColor = isCompleted
            ? color.accent
            : isCurrent
              ? color.platinum
              : color.slate;

          const labelColor = isCurrent
            ? color.platinum
            : isCompleted
              ? color.mist
              : color.slate;

          return (
            <div
              key={step.key}
              role="listitem"
              aria-current={isCurrent ? 'step' : undefined}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                position: 'relative',
                minWidth: '95px',
              }}
            >
              {/* Connector line behind circle */}
              {idx < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: '16px',
                    left: '50%',
                    width: '100%',
                    height: '2px',
                    background: isCompleted ? gradient.biolum : 'rgba(255, 255, 255, 0.08)',
                    zIndex: 1,
                  }}
                />
              )}

              {/* Step circle indicator */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: circleBg,
                  border: circleBorder,
                  color: circleColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: 600,
                  zIndex: 2,
                  boxShadow: isCurrent ? '0 0 10px rgba(203, 255, 252, 0.25)' : 'none',
                }}
              >
                {isCompleted ? '✓' : idx + 1}
              </div>

              {/* Step label */}
              <span
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  fontWeight: isCurrent ? 600 : 400,
                  color: labelColor,
                  lineHeight: 1.3,
                  maxWidth: '120px',
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Prominent "Waiting On" Card (SG2-38 AC 2) */}
      <div
        data-testid="waiting-on-card"
        style={{
          background: color.deep,
          borderRadius: radius.card,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '18px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <Eyebrow style={{ color: color.accent }}>WAITING ON</Eyebrow>
          {waitingOn?.persona ? (
            <span
              data-testid="waiting-on-persona"
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: color.platinum,
              }}
            >
              {waitingOn.persona}
            </span>
          ) : (
            <span
              data-testid="waiting-on-persona"
              style={{ fontSize: '14px', color: color.slate }}
            >
              None (Planning completed)
            </span>
          )}
        </div>

        {waitingOn?.action ? (
          <div
            data-testid="waiting-on-action"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px',
              color: color.mist,
              lineHeight: 1.4,
            }}
          >
            <span style={{ color: color.silver }}>Next step: </span>
            <span>{waitingOn.action}</span>
          </div>
        ) : (
          <div
            data-testid="waiting-on-action"
            style={{ fontSize: '13px', color: color.silver }}
          >
            No further actions pending. All lifecycle requirements are satisfied.
          </div>
        )}
      </div>
    </section>
  );
}

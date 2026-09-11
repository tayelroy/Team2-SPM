import { can } from '../auth/access';
import { usePageAccess } from '../auth/pages';
import { useState } from 'react';
import { CHANGE_CHIPS, IMPACTS } from '../mock/data';
import { chipStyle } from '../mock/viewModel';
import { color, radius, rule } from '../theme';
import {
  Card,
  Chip,
  Dot,
  Eyebrow,
  Field,
  GradientButton,
  Notice,
  RecessedCard,
  TextField,
} from '../ui';

/**
 * Post-submission amendment. The impact panel is the reason this screen
 * exists: the coordinator sees the knock-on effect of the change — capacity,
 * venue availability, equipment — before deciding.
 */
export default function ChangeRequest() {
  const [changes, setChanges] = useState<string[]>(['Expected attendance']);

  const toggle = (name: string) =>
    setChanges((current) =>
      current.includes(name)
        ? current.filter((x) => x !== name)
        : current.concat(name),
    );

  const { access } = usePageAccess();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
        gap: '20px',
        alignItems: 'start',
      }}
    >
      <fieldset disabled={!can(access, 'event_request.change')} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Card style={{ gap: '26px' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: color.platinum,
          }}
        >
          Request a change — E-198 Quarterly Partner Dinner
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Eyebrow>What needs to change</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {CHANGE_CHIPS.map((name) => {
              const on = changes.includes(name);
              return (
                <Chip
                  key={name}
                  {...chipStyle(on)}
                  pressed={on}
                  onClick={() => toggle(name)}
                >
                  {name}
                </Chip>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
            gap: '20px',
          }}
        >
          <Field label="New expected attendance" defaultValue="140" />
          <Field label="Currently confirmed" defaultValue="90 · The Kelp Room" muted />
        </div>

        <TextField
          label="Why"
          defaultValue="Two extra partner firms confirmed attendance this week."
        />

        {can(access, 'event_request.change') ? <GradientButton style={{ alignSelf: 'flex-start' }}>
          Send change request
        </GradientButton> : null}
      </Card>
      </fieldset>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Notice>
          <Eyebrow style={{ color: color.mist }}>Impact of this change</Eyebrow>
          {IMPACTS.map((impact) => (
            <div key={impact.text} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <Dot tone={impact.dot} style={{ marginTop: '7px' }} />
              <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.mist }}>
                {impact.text}
              </span>
            </div>
          ))}
        </Notice>

        <RecessedCard style={{ gap: '16px' }}>
          <Eyebrow>Coordinator decision</Eyebrow>
          <span style={{ fontSize: '15px', lineHeight: 1.4, color: color.silver }}>
            Approving re-opens venue and equipment checks; the organiser and registered
            attendees are notified automatically.
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button
              type="button"
              style={{
                background: color.kelp,
                border: rule.raised,
                borderRadius: radius.sm,
                padding: '13px 18px',
                color: color.platinum,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Approve change
            </button>
            <button
              type="button"
              style={{
                background: 'none',
                border: rule.raised,
                borderRadius: radius.sm,
                padding: '13px 18px',
                color: color.mist,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
          </div>
        </RecessedCard>
      </div>
    </div>
  );
}

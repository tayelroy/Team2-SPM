import { useState } from 'react';
import { FORM_FIELDS, NEXT_STEPS, REQUIREMENT_CHIPS } from '../mock/data';
import { chipStyle } from '../mock/viewModel';
import { color } from '../theme';
import {
  Card,
  Chip,
  Eyebrow,
  Field,
  GhostButton,
  GradientButton,
  Notice,
  NoticeMark,
  RecessedCard,
  TextField,
} from '../ui';

const INITIAL_REQUIREMENTS = [
  'Step-free access',
  'Hearing loop',
  'Stage + lectern',
  'Catering',
];

/**
 * New / edit event request. Requirements are live toggles, and the capacity
 * warning is the prototype's stand-in for server-side suitability checking.
 */
export default function RequestForm({
  onSubmit,
  showConflicts = true,
}: {
  onSubmit: () => void;
  /** Mirrors the mockup's `flagConflicts` prop — hides the suitability warning. */
  showConflicts?: boolean;
}) {
  const [requirements, setRequirements] = useState<string[]>(INITIAL_REQUIREMENTS);
  const [drafted, setDrafted] = useState(false);

  const toggle = (name: string) =>
    setRequirements((current) =>
      current.includes(name)
        ? current.filter((x) => x !== name)
        : current.concat(name),
    );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
        gap: '20px',
        alignItems: 'start',
      }}
    >
      <Card style={{ gap: '28px', gridColumn: 'span 2', minWidth: 0 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: '20px',
          }}
        >
          {FORM_FIELDS.map((f) => (
            <Field
              key={f.label}
              label={f.label}
              defaultValue={f.value}
              hint={f.hint || undefined}
            />
          ))}
        </div>

        <TextField
          label="Description"
          rows={4}
          defaultValue="A half-day forum for institutional partners: two keynote sessions, a panel, and a standing reception. Needs a stage, step-free access, and a hearing loop."
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Eyebrow>Requirements</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {REQUIREMENT_CHIPS.map((name) => {
              const on = requirements.includes(name);
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

        {showConflicts ? (
          <Notice
            style={{
              flexDirection: 'row',
              gap: '14px',
              alignItems: 'flex-start',
              padding: '20px 24px',
            }}
          >
            <NoticeMark />
            <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.mist }}>
              180 expected attendance rules out 3 of 6 venues. Atrium Hall and
              Deepwater Auditorium remain suitable on 12 October.
            </span>
          </Notice>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <GhostButton onClick={() => setDrafted(true)}>Save draft</GhostButton>
          <GradientButton onClick={onSubmit}>Submit request</GradientButton>
          <span style={{ fontSize: '13px', color: color.silver }}>
            {drafted
              ? 'Draft saved — you can come back to it any time.'
              : 'You can save and finish this later.'}
          </span>
        </div>
      </Card>

      <RecessedCard style={{ gap: '16px' }}>
        <Eyebrow>What happens next</Eyebrow>
        {NEXT_STEPS.map((step) => (
          <div key={step.n} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <span
              style={{
                fontSize: '13px',
                color: color.phosphor,
                flex: 'none',
                width: '18px',
              }}
            >
              {step.n}
            </span>
            <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.silver }}>
              {step.text}
            </span>
          </div>
        ))}
      </RecessedCard>
    </div>
  );
}

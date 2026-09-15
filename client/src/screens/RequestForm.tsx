import { useState } from 'react';
import { NEXT_STEPS, REQUIREMENT_CHIPS } from '../mock/data';
import { chipStyle } from '../mock/viewModel';
import { color } from '../theme';
import { createEventRequestDraft } from '../api/eventRequests';
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

/** Labels for the fields the server reports as still outstanding. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
  proposed_date: 'Date & time',
  expected_attendance: 'Expected attendance',
  venue_requirements: 'Venue requirements',
};

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; reference: number; missing: string[] }
  | { kind: 'error'; message: string; details?: string[] };

/**
 * New event request (SG2-28). "Save draft" creates a real draft through
 * POST /api/event-requests; the draft is filed against the signed-in
 * organiser and their client organisation server-side.
 *
 * Incomplete drafts are accepted on purpose — the server replies with the
 * fields still outstanding for submission, which are shown back to the user
 * rather than used to block the save.
 *
 * "Submit request" remains the prototype's existing hand-off (SG2-30).
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
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [description, setDescription] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [attendance, setAttendance] = useState('');
  const [accessibility, setAccessibility] = useState('');
  const [equipment, setEquipment] = useState('');
  const [registrationNeeded, setRegistrationNeeded] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  const toggle = (name: string) =>
    setRequirements((current) =>
      current.includes(name)
        ? current.filter((x) => x !== name)
        : current.concat(name),
    );

  /** Blank fields are omitted so the server stores null, not an empty string. */
  async function saveDraft() {
    setSave({ kind: 'saving' });
    const attendanceValue = Number(attendance);
    const outcome = await createEventRequestDraft({
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(proposedDate ? { proposed_date: proposedDate } : {}),
      ...(attendance.trim() && Number.isFinite(attendanceValue)
        ? { expected_attendance: attendanceValue }
        : {}),
      ...(requirements.length ? { venue_requirements: requirements.join(', ') } : {}),
      ...(accessibility.trim() ? { accessibility_needs: accessibility.trim() } : {}),
      ...(equipment.trim() ? { equipment_requirements: equipment.trim() } : {}),
      registration_needed: registrationNeeded,
    });

    setSave(
      outcome.ok
        ? {
            kind: 'saved',
            reference: outcome.request.event_id,
            missing: outcome.missingForSubmission,
          }
        : { kind: 'error', message: outcome.message, details: outcome.details },
    );
  }

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
          <Field
            label="Event name"
            value={name}
            onChange={setName}
            hint="Shown to attendees once confirmed"
          />
          <Field label="Purpose" value={purpose} onChange={setPurpose} />
          <Field
            label="Date & time"
            type="datetime-local"
            value={proposedDate}
            onChange={setProposedDate}
          />
          <Field
            label="Expected attendance"
            type="number"
            value={attendance}
            onChange={setAttendance}
            hint="Drives venue suitability checks"
          />
        </div>

        <TextField
          label="Description"
          rows={4}
          value={description}
          onChange={setDescription}
          placeholder="What is the event, who is it for, and how should the space be used?"
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Eyebrow>Venue requirements</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {REQUIREMENT_CHIPS.map((chip) => {
              const on = requirements.includes(chip);
              return (
                <Chip
                  key={chip}
                  {...chipStyle(on)}
                  pressed={on}
                  onClick={() => toggle(chip)}
                >
                  {chip}
                </Chip>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: '20px',
          }}
        >
          <TextField
            label="Accessibility needs (optional)"
            rows={2}
            value={accessibility}
            onChange={setAccessibility}
          />
          <TextField
            label="Equipment requirements"
            rows={2}
            value={equipment}
            onChange={setEquipment}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Eyebrow>Attendee registration</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <Chip
              {...chipStyle(registrationNeeded)}
              pressed={registrationNeeded}
              onClick={() => setRegistrationNeeded((on) => !on)}
            >
              Registration needed
            </Chip>
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

        {save.kind === 'error' ? (
          <div role="alert">
            <Notice style={{ padding: '16px 20px' }}>
              <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.mist }}>
                {save.message}
              </span>
              {save.details?.length ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
                  {save.details.map((detail) => (
                    <li key={detail} style={{ fontSize: '13px', color: color.silver }}>
                      {detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <GhostButton onClick={saveDraft} disabled={save.kind === 'saving'}>
            {save.kind === 'saving' ? 'Saving…' : 'Save draft'}
          </GhostButton>
          <GradientButton onClick={onSubmit}>Submit request</GradientButton>
          <span style={{ fontSize: '13px', color: color.silver }}>
            {save.kind === 'saved'
              ? save.missing.length === 0
                ? `Draft ${save.reference} saved — ready to submit.`
                : `Draft ${save.reference} saved. Still needed to submit: ${save.missing
                    .map((field) => FIELD_LABELS[field] ?? field)
                    .join(', ')}.`
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

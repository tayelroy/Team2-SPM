import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { submitEventRequest } from '../api/eventRequests';
import { NEXT_STEPS, REQUIREMENT_CHIPS } from '../mock/data';
import { chipStyle } from '../mock/viewModel';
import { color, radius, rule, surface, label as labelToken } from '../theme';
import {
  Card,
  Chip,
  Eyebrow,
  GhostButton,
  GradientButton,
  Notice,
  NoticeMark,
  RecessedCard,
} from '../ui';

/**
 * Mandatory fields that must all be non-empty before the request can be
 * submitted (AC2). Mirrors `SUBMISSION_REQUIRED_FIELDS` on the server
 * (`server/src/events/fields.ts`).
 */
const REQUIRED_FIELDS = [
  'name',
  'purpose',
  'description',
  'proposed_date',
  'expected_attendance',
  'venue_requirements',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** Human-readable labels for inline validation errors. */
const FIELD_LABELS: Record<RequiredField, string> = {
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
  proposed_date: 'Date',
  expected_attendance: 'Expected attendance',
  venue_requirements: 'Venue requirements',
};

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

type FormValues = Record<RequiredField, string>;

const INITIAL_FORM: FormValues = {
  name: '',
  purpose: '',
  description: '',
  proposed_date: '',
  expected_attendance: '',
  venue_requirements: '',
};

const INITIAL_REQUIREMENTS = [
  'Step-free access',
  'Hearing loop',
  'Stage + lectern',
  'Catering',
];

/**
 * Styled like Login's ControlledField — a controlled text input that follows
 * the ui.tsx Field visual contract without the `defaultValue`-only restriction.
 */
function FormField({
  label,
  fieldKey,
  value,
  onChange,
  hint,
  hasError,
}: {
  label: string;
  fieldKey: RequiredField;
  value: string;
  onChange: (key: RequiredField, value: string) => void;
  hint?: string;
  hasError: boolean;
}) {
  const id = `rf-${fieldKey}`;
  const errorId = `${id}-error`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label htmlFor={id} style={labelToken}>
        {label} <span style={{ color: color.accent }}>*</span>
      </label>
      {hint && (
        <span style={{ fontSize: '12px', color: color.silver, marginTop: '-2px' }}>{hint}</span>
      )}
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(fieldKey, e.target.value)}
        aria-required="true"
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        style={{
          background: surface.fieldOnAbyss,
          border: hasError ? `1px solid #ff8a80` : rule.control,
          borderRadius: radius.sm,
          padding: '13px 14px',
          color: color.mist,
          fontSize: '14px',
          outline: 'none',
        }}
      />
      {hasError && (
        <span
          id={errorId}
          role="alert"
          style={{ fontSize: '12px', color: '#ff8a80' }}
        >
          {FIELD_LABELS[fieldKey]} is required
        </span>
      )}
    </div>
  );
}

/**
 * New / edit event request (SG2-30 — Phase 4 frontend).
 *
 * AC1: When `eventId` and `accessToken` are provided, submitting calls
 *      `PATCH /api/event-requests/:eventId/submit` and fires `onSuccess`
 *      (or the legacy `onSubmit` alias) on success.
 *      When those props are absent (mockup / prototype usage), the button
 *      immediately fires `onSuccess`/`onSubmit` so existing integration tests
 *      and the App.tsx mockup path continue to work.
 * AC2: The "Submit request" button is disabled while any mandatory field is
 *      empty. After a failed attempt, inline errors appear on each blank field.
 *      Server errors (400/409/503) surface as a visible alert banner.
 * AC3: Not in scope for RequestForm itself — see EventDetail for immutability.
 *
 * "Save draft" is handled by SG2-28 / PR #18 — deliberately left untouched
 * aside from firing the `onSaveDraft` callback when provided.
 */
export default function RequestForm({
  eventId,
  accessToken,
  onSuccess,
  /** @deprecated Use `onSuccess` instead. Kept for backward compatibility. */
  onSubmit,
  onSaveDraft,
  showConflicts = true,
}: {
  /** The event request UUID this form is editing. Optional: when absent,
   *  submission bypasses the API (prototype / mockup mode). */
  eventId?: string;
  /** Bearer token for the signed-in organiser. Required alongside `eventId`. */
  accessToken?: string;
  /** Called after a successful submission (or immediately in mockup mode). */
  onSuccess?: () => void;
  /**
   * Legacy alias for `onSuccess` — retained so existing callers that pass
   * `onSubmit` (App.tsx and App.test.tsx) continue to work unchanged.
   * @deprecated Prefer `onSuccess`.
   */
  onSubmit?: () => void;
  /**
   * Called when "Save draft" is clicked. Left to the SG2-28 implementation;
   * this component only fires the callback when provided.
   */
  onSaveDraft?: () => void;
  /** Mirrors the mockup's `flagConflicts` prop — hides the suitability warning. */
  showConflicts?: boolean;
}) {
  // Resolve whichever success callback was provided (onSuccess takes priority).
  const successCallback = onSuccess ?? onSubmit;

  const [values, setValues] = useState<FormValues>(INITIAL_FORM);
  const [requirements, setRequirements] = useState<string[]>(INITIAL_REQUIREMENTS);
  const [touched, setTouched] = useState<Set<RequiredField>>(new Set());
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Local draft confirmation — keeps the original prototype feedback when
  // no external onSaveDraft handler is wired up (SG2-28 handles real saves).
  const [drafted, setDrafted] = useState(false);

  const emptyFields = REQUIRED_FIELDS.filter((k) => !values[k].trim());

  // When no real required-field data exists yet (fresh form), the submit
  // button is disabled. During an in-flight request it is also disabled.
  const isSubmitDisabled = emptyFields.length > 0 || submitStatus === 'submitting';

  function setField(key: RequiredField, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => new Set(prev).add(key));
  }

  const toggle = (name: string) =>
    setRequirements((current) =>
      current.includes(name)
        ? current.filter((x) => x !== name)
        : current.concat(name),
    );

  function handleSaveDraft() {
    if (onSaveDraft) {
      onSaveDraft();
    } else {
      // Prototype fallback: show inline confirmation without an external handler.
      setDrafted(true);
    }
  }

  async function handleSubmit() {
    // Mockup / prototype mode: no real API call needed.
    if (!eventId || !accessToken) {
      successCallback?.();
      return;
    }

    setSubmitStatus('submitting');
    setErrorMessage('');

    const result = await submitEventRequest(eventId, accessToken);

    if (result.ok) {
      setSubmitStatus('success');
      successCallback?.();
      return;
    }

    setSubmitStatus('error');

    if (result.kind === 'missing') {
      const labels = result.missing
        .map((f) => FIELD_LABELS[f as RequiredField] ?? f)
        .join(', ');
      setErrorMessage(
        `Please complete the following required fields before submitting: ${labels}.`,
      );
      // Mark those fields so inline errors appear.
      setTouched(new Set(result.missing as RequiredField[]));
    } else if (result.kind === 'conflict') {
      setErrorMessage(
        'This request has already been submitted and cannot be submitted again.',
      );
    } else if (result.kind === 'unavailable') {
      setErrorMessage(
        'Could not reach the server. Check your connection and try again.',
      );
    } else {
      setErrorMessage(result.message);
    }
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
        {/* Server-error alert banner (AC2) */}
        {submitStatus === 'error' && errorMessage && (
          <Notice
            style={{
              flexDirection: 'row',
              gap: '14px',
              alignItems: 'flex-start',
              padding: '20px 24px',
              borderColor: 'rgba(255,138,128,0.5)',
              background: 'rgba(255,138,128,0.08)',
            }}
          >
            <NoticeMark />
            <span
              role="alert"
              style={{ fontSize: '14px', lineHeight: 1.43, color: '#ff8a80' }}
            >
              {errorMessage}
            </span>
          </Notice>
        )}

        {/* Mandatory fields grid (AC2) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: '20px',
          }}
        >
          <FormField
            label="Event name"
            fieldKey="name"
            value={values.name}
            onChange={setField}
            hint="Shown to attendees once confirmed"
            hasError={touched.has('name') && !values.name.trim()}
          />
          <FormField
            label="Purpose"
            fieldKey="purpose"
            value={values.purpose}
            onChange={setField}
            hasError={touched.has('purpose') && !values.purpose.trim()}
          />
          <FormField
            label="Date"
            fieldKey="proposed_date"
            value={values.proposed_date}
            onChange={setField}
            hasError={touched.has('proposed_date') && !values.proposed_date.trim()}
          />
          <FormField
            label="Expected attendance"
            fieldKey="expected_attendance"
            value={values.expected_attendance}
            onChange={setField}
            hint="Drives venue suitability checks"
            hasError={
              touched.has('expected_attendance') && !values.expected_attendance.trim()
            }
          />
          <FormField
            label="Venue requirements"
            fieldKey="venue_requirements"
            value={values.venue_requirements}
            onChange={setField}
            hasError={
              touched.has('venue_requirements') && !values.venue_requirements.trim()
            }
          />
        </div>

        {/* Description — full-width textarea (AC2) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label htmlFor="rf-description" style={labelToken}>
            Description <span style={{ color: color.accent }}>*</span>
          </label>
          <textarea
            id="rf-description"
            rows={4}
            value={values.description}
            onChange={(e) => {
              setValues((prev) => ({ ...prev, description: e.target.value }));
              setTouched((prev) => new Set(prev).add('description'));
            }}
            aria-required="true"
            aria-invalid={touched.has('description') && !values.description.trim()}
            aria-describedby={
              touched.has('description') && !values.description.trim()
                ? 'rf-description-error'
                : undefined
            }
            placeholder="Describe the event, expected sessions, and any special requirements."
            style={{
              background: surface.fieldOnAbyss,
              border:
                touched.has('description') && !values.description.trim()
                  ? '1px solid #ff8a80'
                  : rule.control,
              borderRadius: radius.sm,
              padding: '13px 14px',
              color: color.mist,
              fontSize: '14px',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          {touched.has('description') && !values.description.trim() && (
            <span
              id="rf-description-error"
              role="alert"
              style={{ fontSize: '12px', color: '#ff8a80' }}
            >
              Description is required
            </span>
          )}
        </div>

        {/* Venue requirement chips */}
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

        {/* Suitability warning (prototype) */}
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

        {/* Actions row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          {/* Save draft — scope of SG2-28 / PR #18. Fires onSaveDraft when
              provided; otherwise falls back to the prototype inline feedback. */}
          <GhostButton onClick={handleSaveDraft}>Save draft</GhostButton>

          {/* Submit (AC2): disabled until all required fields are filled */}
          <GradientButton
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            {submitStatus === 'submitting' ? 'Submitting…' : 'Submit request'}
          </GradientButton>

          <span style={{ fontSize: '13px', color: color.silver }}>
            {drafted
              ? 'Draft saved — you can come back to it any time.'
              : touched.size > 0 && emptyFields.length > 0
                ? `${emptyFields.length} required field${emptyFields.length === 1 ? '' : 's'} still empty.`
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

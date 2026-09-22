import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { loadSession } from '../auth/session';
import { createEventRequestDraft, submitEventRequest, updateEventRequestDraft } from '../api/eventRequests';
import type { EventRequestDraftInput } from '../api/eventRequests';
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

/** Human-readable labels for inline validation errors and outstanding-field summaries. */
const FIELD_LABELS: Record<RequiredField, string> = {
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
  proposed_date: 'Date',
  expected_attendance: 'Expected attendance',
  venue_requirements: 'Venue requirements',
};

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; reference: number; missing: string[] }
  | { kind: 'error'; message: string; details?: string[] };

type FormValues = Record<RequiredField, string>;

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
 * A non-mandatory multi-line field for the two optional details a draft can
 * carry (SG2-28): accessibility needs and equipment requirements. Unlike
 * FormField, blank is a valid, final answer — no `*`, no required styling.
 */
function OptionalTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label htmlFor={id} style={labelToken}>
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: surface.fieldOnAbyss,
          border: rule.control,
          borderRadius: radius.sm,
          padding: '13px 14px',
          color: color.mist,
          fontSize: '14px',
          lineHeight: 1.43,
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

/**
 * New / edit event request.
 *
 * "Save draft" (SG2-28): posts the current field values to
 * `POST /api/event-requests` and shows the server's outstanding-field list
 * back to the user rather than blocking the save on completeness. The id it
 * returns is kept locally so a same-session "Submit request" targets the
 * draft that was just created, even though `eventId` was never passed in as
 * a prop. `onSaveDraft`, when provided, overrides this and takes over the
 * click entirely.
 *
 * Editing an existing draft (SG2-29): when `eventId` and `initialValues` are
 * both supplied from the start (as the "My drafts" → Edit entry point does),
 * the form seeds its fields from `initialValues` and "Save draft" calls
 * `PATCH /api/event-requests/:eventId` instead of creating a new row.
 *
 * "Submit request" (SG2-30): saves the current form first, creating a draft
 * if necessary, then submits its persisted id. Only a successful server
 * submission fires `onSuccess` with that id. Failed submissions retain the saved id for retry.
 * AC2 — the submit button is disabled while any mandatory field is empty;
 * inline errors appear on a blank field once touched; server errors
 * (400/409/503) surface as a visible alert banner.
 * AC3 — not in scope for RequestForm itself; see EventDetail for immutability.
 */
export default function RequestForm({
  eventId,
  initialValues,
  accessToken,
  onSuccess,
  /** @deprecated Use `onSuccess` instead. Kept for backward compatibility. */
  onSubmit,
  onSaveDraft,
  showConflicts = true,
}: {
  /** The event request id this form is editing. Optional: when absent, a
   *  successful "Save draft" supplies one instead (see above). */
  eventId?: string;
  /**
   * An existing draft's saved field values, to seed the form when editing.
   * Only meaningful alongside `eventId` — a fresh "New request" has none.
   */
  initialValues?: EventRequestDraftInput;
  /** Bearer token for the signed-in organiser. Required alongside a resolved event id. */
  accessToken?: string;
  /** Receives the persisted event id only after the server confirms submission. */
  onSuccess?: (eventId: number) => void;
  /**
   * Legacy alias for `onSuccess` — retained so existing callers that pass
   * `onSubmit` continue to work; callbacks may ignore the supplied event id.
   * @deprecated Prefer `onSuccess`.
   */
  onSubmit?: (eventId: number) => void;
  /**
   * Overrides "Save draft" entirely when provided, instead of the built-in
   * create/update call.
   */
  onSaveDraft?: () => void;
  /** Mirrors the mockup's `flagConflicts` prop — hides the suitability warning. */
  showConflicts?: boolean;
}) {
  // Resolve whichever success callback was provided (onSuccess takes priority).
  const successCallback = onSuccess ?? onSubmit;

  const [values, setValues] = useState<FormValues>(() => ({
    name: initialValues?.name ?? '',
    purpose: initialValues?.purpose ?? '',
    description: initialValues?.description ?? '',
    proposed_date: initialValues?.proposed_date ?? '',
    expected_attendance:
      initialValues?.expected_attendance != null ? String(initialValues.expected_attendance) : '',
    venue_requirements: initialValues?.venue_requirements ?? '',
  }));
  const [requirements, setRequirements] = useState<string[]>(INITIAL_REQUIREMENTS);
  const [accessibility, setAccessibility] = useState(initialValues?.accessibility_needs ?? '');
  const [equipment, setEquipment] = useState(initialValues?.equipment_requirements ?? '');
  const [registrationNeeded, setRegistrationNeeded] = useState(initialValues?.registration_needed ?? false);
  const [touched, setTouched] = useState<Set<RequiredField>>(new Set());
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  // Set once "Save draft" creates a real row, so "Submit request" in the same
  // sitting targets it even though no eventId prop was ever passed in.
  const [createdEventId, setCreatedEventId] = useState<number | null>(null);

  const emptyFields = REQUIRED_FIELDS.filter((k) => !values[k].trim());
  const effectiveEventId = eventId ?? (createdEventId !== null ? String(createdEventId) : undefined);

  // When no real required-field data exists yet (fresh form), the submit
  // button is disabled. During an in-flight request it is also disabled.
  const isBusy = submitStatus === 'submitting' || saveState.kind === 'saving';
  const isSubmitDisabled = emptyFields.length > 0 || isBusy;

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

  // Both create and update replace the entire draft: omitted blank fields
  // become null on the server, so clearing a previously saved value persists.
  async function persistDraft() {
    const attendanceValue = Number(values.expected_attendance);
    const payload = {
      ...(values.name.trim() ? { name: values.name.trim() } : {}),
      ...(values.purpose.trim() ? { purpose: values.purpose.trim() } : {}),
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
      ...(values.proposed_date.trim() ? { proposed_date: values.proposed_date.trim() } : {}),
      ...(values.expected_attendance.trim() && Number.isFinite(attendanceValue)
        ? { expected_attendance: attendanceValue }
        : {}),
      ...(values.venue_requirements.trim() ? { venue_requirements: values.venue_requirements.trim() } : {}),
      ...(accessibility.trim() ? { accessibility_needs: accessibility.trim() } : {}),
      ...(equipment.trim() ? { equipment_requirements: equipment.trim() } : {}),
      registration_needed: registrationNeeded,
    };

    const token = accessToken ?? loadSession()?.accessToken;
    if (!token) {
      return { ok: false as const, message: 'You are signed out. Sign in again to save this draft.' };
    }
    const outcome = effectiveEventId
      ? await updateEventRequestDraft(effectiveEventId, payload, token)
      : await createEventRequestDraft(payload);
    if (outcome.ok && !effectiveEventId) setCreatedEventId(outcome.request.event_id);
    return outcome;
  }

  async function handleSaveDraft() {
    if (onSaveDraft) {
      onSaveDraft();
      return;
    }
    setSaveState({ kind: 'saving' });
    const outcome = await persistDraft();
    if (!outcome.ok) {
      setSaveState({ kind: 'error', message: outcome.message, details: outcome.details });
      return;
    }
    setSaveState({ kind: 'saved', reference: outcome.request.event_id, missing: outcome.missingForSubmission });
  }

  async function handleSubmit() {
    setSubmitStatus('submitting');
    setErrorMessage('');
    const token = accessToken ?? loadSession()?.accessToken;
    if (!token) {
      setSubmitStatus('error');
      setErrorMessage('You are signed out. Sign in again to submit this request.');
      return;
    }
    const saved = await persistDraft();
    if (!saved.ok) {
      setSubmitStatus('error');
      setErrorMessage(saved.message);
      return;
    }
    const submittedEventId = effectiveEventId ?? saved.request.event_id;
    const result = await submitEventRequest(submittedEventId, token);

    if (result.ok) {
      setSubmitStatus('success');
      successCallback?.(Number(submittedEventId));
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

        {saveState.kind === 'error' ? (
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
            <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '14px', lineHeight: 1.43, color: '#ff8a80' }}>
                {saveState.message}
              </span>
              {saveState.details?.length ? (
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {saveState.details.map((detail) => (
                    <li key={detail} style={{ fontSize: '13px', color: color.silver }}>
                      {detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Notice>
        ) : null}

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

        {/* Optional details (SG2-28) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: '20px',
          }}
        >
          <OptionalTextField
            label="Accessibility needs (optional)"
            value={accessibility}
            onChange={setAccessibility}
          />
          <OptionalTextField
            label="Equipment requirements"
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
          <GhostButton onClick={handleSaveDraft} disabled={isBusy}>
            {saveState.kind === 'saving' ? 'Saving…' : 'Save draft'}
          </GhostButton>

          {/* Submit (AC2): disabled until all required fields are filled */}
          <GradientButton
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            {submitStatus === 'submitting' ? 'Submitting…' : 'Submit request'}
          </GradientButton>

          <span style={{ fontSize: '13px', color: color.silver }}>
            {saveState.kind === 'saved'
              ? saveState.missing.length === 0
                ? `Draft ${saveState.reference} saved — ready to submit.`
                : `Draft ${saveState.reference} saved. Still needed to submit: ${saveState.missing
                    .map((field) => FIELD_LABELS[field as RequiredField] ?? field)
                    .join(', ')}.`
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

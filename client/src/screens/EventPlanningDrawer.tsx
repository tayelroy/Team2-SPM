import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import {
  updateEventPlanning,
  type PlanningEventRecord,
  type PlanningUpdatePayload,
} from '../api/eventRequests';
import { loadSession } from '../auth/session';
import { formatSgtTimestamp } from '../components/EventAuditDrawer';
import { color, radius, rule, surface, label as labelToken } from '../theme';
import {
  Badge,
  Chip,
  GhostButton,
  GradientButton,
  IconButton,
  Notice,
  NoticeMark,
} from '../ui';

export interface EventPlanningInitialValues {
  proposed_date?: string | null;
  expected_attendance?: number | null;
  venue_requirements?: string | null;
  equipment_requirements?: string | null;
  accessibility_needs?: string | null;
  registration_needed?: boolean | null;
  registration_capacity?: number | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  planning_notes?: string | null;
  expected_crowd_movement?: string | null;
  status?: string | null;
}

export interface EventPlanningDrawerProps {
  isOpen?: boolean;
  onClose: () => void;
  eventId: number;
  initialValues?: EventPlanningInitialValues;
  accessToken?: string | null;
  onSuccess?: (event: PlanningEventRecord) => void;
}

interface ImpactConfirmationState {
  affected_arrangements: string[];
  impact_notes: string[];
}

const ARRANGEMENT_LABELS: Record<string, string> = {
  venue_recheck: 'Venue Suitability Recheck',
  equipment_recheck: 'Equipment Recheck',
  registration_recheck: 'Registration Capacity Recheck',
};

/** Details a Confirmed or Preparation event no longer takes directly (SG2-66 AC6). */
const LOCKED_DETAIL_FIELDS = [
  'proposed_date',
  'expected_attendance',
  'venue_requirements',
  'equipment_requirements',
  'accessibility_needs',
] as const;

/** Formats an ISO datetime string for an HTML datetime-local input (YYYY-MM-DDTHH:mm). */
export function formatForDateTimeInput(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
}

/** Parses input value to ISO string or null. */
export function toIsoOrNull(val: string): string | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Validates coordinator planning drawer input before dispatching (AC 4). Mirrors
 * the server's date rules: a newly chosen proposed date must be in the future
 * (an unchanged one is not re-judged), and must still come after the
 * organiser's registration opening and closing times (SG2-63).
 */
export function validatePlanningForm({
  proposedDate,
  initialProposedDate,
  now,
  expectedAttendance,
  registrationNeeded,
  registrationOpensAt,
  registrationClosesAt,
  venueRequirements,
  equipmentRequirements,
  accessibilityNeeds,
  planningNotes,
  expectedCrowdMovement = '',
}: {
  proposedDate: string;
  /** The proposed date the drawer opened with, in the same input format. */
  initialProposedDate: string;
  /** Current time in epoch milliseconds. */
  now: number;
  expectedAttendance: string;
  registrationNeeded: boolean;
  /** The organiser's stored registration times (SG2-63), as datetime-local values. */
  registrationOpensAt: string;
  registrationClosesAt: string;
  venueRequirements: string;
  equipmentRequirements: string;
  accessibilityNeeds: string;
  planningNotes: string;
  /** SG2-91 AC3. */
  expectedCrowdMovement?: string;
}): string[] {
  const errors: string[] = [];
  let startTime: number | null = null;

  if (proposedDate.trim()) {
    const d = new Date(proposedDate.trim());
    if (isNaN(d.getTime())) {
      errors.push('Proposed date must be a valid date and time.');
    } else {
      startTime = d.getTime();
      if (proposedDate.trim() !== initialProposedDate && startTime <= now) {
        errors.push('Proposed date must be in the future.');
      }
    }
  }

  if (expectedAttendance.trim() !== '') {
    const num = Number(expectedAttendance.trim());
    if (!Number.isInteger(num) || num < 1) {
      errors.push('Expected attendance must be a positive whole number.');
    } else if (num > 2_147_483_647) {
      errors.push('Expected attendance must be at most 2147483647.');
    }
  }

  const textFields = [
    { label: 'Venue requirements', value: venueRequirements },
    { label: 'Equipment requirements', value: equipmentRequirements },
    { label: 'Accessibility needs', value: accessibilityNeeds },
    { label: 'Planning notes', value: planningNotes },
    { label: 'Expected crowd movement', value: expectedCrowdMovement },
  ];

  for (const tf of textFields) {
    if (tf.value.trim().length > 5000) {
      errors.push(`${tf.label} must be 5000 characters or fewer.`);
    }
  }

  if (registrationNeeded && startTime !== null) {
    const opens = registrationOpensAt.trim() ? new Date(registrationOpensAt.trim()).getTime() : null;
    const closes = registrationClosesAt.trim() ? new Date(registrationClosesAt.trim()).getTime() : null;
    if (opens !== null && opens >= startTime) {
      errors.push('The event must start after registration opens. Ask the organiser to change the registration times first.');
    }
    if (closes !== null && closes >= startTime) {
      errors.push('The event must start after registration closes. Ask the organiser to change the registration times first.');
    }
  }

  return errors;
}

/**
 * Slide-out planning drawer for event coordinators (SG2-39).
 * Allows viewing and editing planning details, registration parameters,
 * and handles arrangement impact confirmation. The form is mounted only while
 * the drawer is open, so every opening starts from the event's saved values and
 * closing without saving discards unsaved edits.
 */
export default function EventPlanningDrawer({ isOpen = true, ...props }: EventPlanningDrawerProps) {
  if (!isOpen) return null;
  return <PlanningDrawerPanel {...props} />;
}

type FeedbackTarget = 'client' | 'server' | 'impact';

function PlanningDrawerPanel({
  onClose,
  eventId,
  initialValues,
  accessToken,
  onSuccess,
}: Omit<EventPlanningDrawerProps, 'isOpen'>) {
  const [proposedDate, setProposedDate] = useState(() =>
    formatForDateTimeInput(initialValues?.proposed_date),
  );
  const [expectedAttendance, setExpectedAttendance] = useState(() =>
    initialValues?.expected_attendance != null ? String(initialValues.expected_attendance) : '',
  );
  const [venueRequirements, setVenueRequirements] = useState(
    () => initialValues?.venue_requirements ?? '',
  );
  const [equipmentRequirements, setEquipmentRequirements] = useState(
    () => initialValues?.equipment_requirements ?? '',
  );
  const [accessibilityNeeds, setAccessibilityNeeds] = useState(
    () => initialValues?.accessibility_needs ?? '',
  );
  const [planningNotes, setPlanningNotes] = useState(
    () => initialValues?.planning_notes ?? '',
  );
  // SG2-91 AC3: what the Safety Officer reviews about how people move.
  const [expectedCrowdMovement, setExpectedCrowdMovement] = useState(
    () => initialValues?.expected_crowd_movement ?? '',
  );
  const [registrationNeeded, setRegistrationNeeded] = useState(
    () => Boolean(initialValues?.registration_needed),
  );
  // SG2-63 AC8: the organiser's settings, shown here but not changed here.
  const registrationCapacity = initialValues?.registration_capacity ?? null;
  const registrationOpensAt = formatForDateTimeInput(initialValues?.registration_opens_at);
  const registrationClosesAt = formatForDateTimeInput(initialValues?.registration_closes_at);

  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDetails, setServerDetails] = useState<string[] | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [impactConfirmation, setImpactConfirmation] =
    useState<ImpactConfirmationState | null>(null);

  // The Save button sits at the bottom of a scrolling drawer while messages
  // render at the top, so each new message is scrolled into view and focused;
  // `seq` makes a repeated identical message move there again.
  const feedbackRefs: Record<FeedbackTarget, RefObject<HTMLDivElement>> = {
    client: useRef<HTMLDivElement>(null),
    server: useRef<HTMLDivElement>(null),
    impact: useRef<HTMLDivElement>(null),
  };
  const [feedback, setFeedback] = useState<{ target: FeedbackTarget; seq: number } | null>(null);
  const reveal = (target: FeedbackTarget) =>
    setFeedback((previous) => ({ target, seq: (previous?.seq ?? 0) + 1 }));

  useEffect(() => {
    if (!feedback) return;
    const message = feedbackRefs[feedback.target].current!;
    message.scrollIntoView({ block: 'nearest' });
    message.focus({ preventScroll: true });
    // The refs are stable; only a new message should move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  const statusLower = initialValues?.status?.toLowerCase() ?? '';
  const isTerminal = ['cancelled', 'completed', 'rejected'].includes(statusLower);
  // SG2-66 AC6: once Confirmed or in Preparation, only whether registration is
  // needed and planning notes are edited here; everything else needs a change
  // request.
  const lockedStage = statusLower === 'confirmed' ? 'Confirmed'
    : statusLower === 'preparation' ? 'in Preparation' : null;
  const detailsDisabled = isTerminal || isSaving || lockedStage !== null;

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSave = async (confirmImpact = false) => {
    setServerError(null);
    setServerDetails(undefined);

    const validationErrors = validatePlanningForm({
      proposedDate,
      initialProposedDate: formatForDateTimeInput(initialValues?.proposed_date),
      now: Date.now(),
      expectedAttendance,
      registrationNeeded,
      registrationOpensAt,
      registrationClosesAt,
      venueRequirements,
      equipmentRequirements,
      accessibilityNeeds,
      planningNotes,
      expectedCrowdMovement,
    });

    if (validationErrors.length > 0) {
      setClientErrors(validationErrors);
      reveal('client');
      return;
    }
    setClientErrors([]);

    const token = accessToken ?? loadSession()?.accessToken;
    if (!token) {
      setServerError('You are signed out. Sign in again to update planning details.');
      reveal('server');
      return;
    }

    const payload: PlanningUpdatePayload = {
      proposed_date: toIsoOrNull(proposedDate),
      expected_attendance: expectedAttendance.trim() ? Number(expectedAttendance.trim()) : null,
      venue_requirements: venueRequirements.trim() || null,
      equipment_requirements: equipmentRequirements.trim() || null,
      accessibility_needs: accessibilityNeeds.trim() || null,
      planning_notes: planningNotes.trim() || null,
      expected_crowd_movement: expectedCrowdMovement.trim() || null,
      registration_needed: registrationNeeded,
      confirm_impact: confirmImpact,
    };

    // A missing field is not a stored empty value. Older queue responses may
    // omit planning fields: saving another edit must not clear unseen data.
    // Keep explicit nulls for fields that were loaded, so users can clear them.
    for (const field of Object.keys(payload) as (keyof PlanningUpdatePayload)[]) {
      if (field !== 'confirm_impact' && initialValues?.[field] === undefined
        && (payload[field] === null || payload[field] === false)) {
        delete payload[field];
      }
    }
    if (lockedStage) {
      // The server refuses a change to these; leave them out so a re-sent value
      // (rounded to the minute by the date input) can never look like one.
      for (const field of LOCKED_DETAIL_FIELDS) delete payload[field];
    }

    setIsSaving(true);
    try {
      const outcome = await updateEventPlanning(eventId, payload, token);

      if (outcome.ok) {
        setImpactConfirmation(null);
        onSuccess?.(outcome.event);
        onClose();
      } else if (outcome.kind === 'confirmation_required') {
        setImpactConfirmation({
          affected_arrangements: outcome.affected_arrangements,
          impact_notes: outcome.impact_notes,
        });
        reveal('impact');
      } else {
        setServerError(outcome.message);
        setServerDetails(outcome.kind === 'validation' ? outcome.details : undefined);
        reveal('server');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        data-testid="drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(1,20,19,0.65)',
          backdropFilter: 'blur(2px)',
          zIndex: 50,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Event Planning Details"
        onKeyDown={handleKeyDown}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(580px, 94vw)',
          zIndex: 51,
          background: color.deep,
          borderLeft: rule.edge,
          padding: '32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          overflowY: 'auto',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.5)',
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            borderBottom: rule.faint,
            paddingBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ ...labelToken, color: color.accent }}>Event Coordinator</span>
            <h3
              style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: color.platinum,
              }}
            >
              Planning Details — #{eventId}
            </h3>
          </div>
          <IconButton label="Close planning drawer" onClick={onClose}>
            ✕
          </IconButton>
        </div>

        {/* AC 5: Terminal status notification */}
        {isTerminal && (
          <Notice
            data-testid="terminal-status-notice"
            style={{
              borderColor: 'rgba(255,138,128,0.5)',
              background: 'rgba(255,138,128,0.08)',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <NoticeMark size={20} />
              <span role="alert" style={{ fontSize: '14px', color: '#ff8a80' }}>
                Cannot update planning details for a {initialValues?.status} event.
              </span>
            </div>
          </Notice>
        )}

        {lockedStage && (
          <Notice data-testid="change-request-lock-notice">
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <NoticeMark size={20} />
              <span style={{ fontSize: '14px', color: color.mist, lineHeight: 1.45 }}>
                This event is {lockedStage}, so its date, attendance and requirements can no longer be
                edited here. Ask for those changes through a change request; whether registration is
                needed and planning notes can still be updated.
              </span>
            </div>
          </Notice>
        )}

        {/* AC 2: Arrangement Impact Confirmation Modal / Banner */}
        {impactConfirmation && (
          <Notice
            data-testid="impact-confirmation-banner"
            style={{
              borderColor: 'rgba(255, 180, 0, 0.5)',
              background: 'rgba(255, 180, 0, 0.08)',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <NoticeMark size={20} />
              <div
                ref={feedbackRefs.impact}
                role="alert"
                tabIndex={-1}
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                <strong style={{ color: '#fde047', fontSize: '15px' }}>
                  Arrangements Require Rechecking
                </strong>
                <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.45, color: color.mist }}>
                  The changes you made affect existing event arrangements. These arrangements will
                  be marked outstanding until rechecked by the coordinator.
                </p>
              </div>
            </div>

            {impactConfirmation.affected_arrangements.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {impactConfirmation.affected_arrangements.map((arr) => (
                  <Badge key={arr} bg="rgba(255, 180, 0, 0.2)" fg="#fde047" size={10}>
                    {ARRANGEMENT_LABELS[arr] ?? arr}
                  </Badge>
                ))}
              </div>
            )}

            {impactConfirmation.impact_notes.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '20px', color: color.silver, fontSize: '13px' }}>
                {impactConfirmation.impact_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <GradientButton
                disabled={isSaving}
                onClick={() => handleSave(true)}
                style={{ padding: '10px 16px', fontSize: '13px' }}
              >
                {isSaving ? 'Confirming…' : 'Confirm & Save Changes'}
              </GradientButton>
              <GhostButton
                disabled={isSaving}
                onClick={() => setImpactConfirmation(null)}
                style={{ padding: '10px 16px', fontSize: '13px' }}
              >
                Back to Editing
              </GhostButton>
            </div>
          </Notice>
        )}

        {/* Validation Errors Alert */}
        {clientErrors.length > 0 && (
          <Notice
            data-testid="client-validation-errors"
            style={{
              borderColor: 'rgba(255,138,128,0.5)',
              background: 'rgba(255,138,128,0.08)',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <NoticeMark size={20} />
              <div
                ref={feedbackRefs.client}
                role="alert"
                tabIndex={-1}
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                <strong style={{ color: '#ff8a80', fontSize: '14px' }}>
                  Please fix the following validation errors:
                </strong>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '18px',
                    fontSize: '13px',
                    color: '#ff8a80',
                  }}
                >
                  {clientErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Notice>
        )}

        {/* Server Error Alert */}
        {serverError && (
          <Notice
            data-testid="server-error-notice"
            style={{
              borderColor: 'rgba(255,138,128,0.5)',
              background: 'rgba(255,138,128,0.08)',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <NoticeMark size={20} />
              <div
                ref={feedbackRefs.server}
                role="alert"
                tabIndex={-1}
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                <span style={{ fontSize: '14px', color: '#ff8a80' }}>{serverError}</span>
                {serverDetails && serverDetails.length > 0 && (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '18px',
                      fontSize: '13px',
                      color: color.silver,
                    }}
                  >
                    {serverDetails.map((det) => (
                      <li key={det}>{det}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Notice>
        )}

        {/* Form Body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Proposed Date & Expected Attendance */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="epd-proposed-date" style={labelToken}>
                Proposed Date & Time
              </label>
              <input
                id="epd-proposed-date"
                type="datetime-local"
                disabled={detailsDisabled}
                value={proposedDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setProposedDate(e.target.value)}
                style={{
                  background: surface.fieldOnAbyss,
                  border: rule.control,
                  borderRadius: radius.sm,
                  padding: '12px 14px',
                  color: color.mist,
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="epd-expected-attendance" style={labelToken}>
                Expected Attendance
              </label>
              <input
                id="epd-expected-attendance"
                type="number"
                min="1"
                disabled={detailsDisabled}
                value={expectedAttendance}
                placeholder="e.g. 150"
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setExpectedAttendance(e.target.value)
                }
                style={{
                  background: surface.fieldOnAbyss,
                  border: rule.control,
                  borderRadius: radius.sm,
                  padding: '12px 14px',
                  color: color.mist,
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Venue & Equipment Requirements */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="epd-venue-requirements" style={labelToken}>
              Venue Requirements
            </label>
            <textarea
              id="epd-venue-requirements"
              rows={3}
              disabled={detailsDisabled}
              value={venueRequirements}
              placeholder="e.g. Step-free access, banquet setup, breakout rooms"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setVenueRequirements(e.target.value)
              }
              style={{
                background: surface.fieldOnAbyss,
                border: rule.control,
                borderRadius: radius.sm,
                padding: '12px 14px',
                color: color.mist,
                fontSize: '14px',
                lineHeight: 1.4,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="epd-equipment-requirements" style={labelToken}>
              Equipment Requirements
            </label>
            <textarea
              id="epd-equipment-requirements"
              rows={3}
              disabled={detailsDisabled}
              value={equipmentRequirements}
              placeholder="e.g. 2 Wireless mics, dual HDMI projectors, audio recording"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setEquipmentRequirements(e.target.value)
              }
              style={{
                background: surface.fieldOnAbyss,
                border: rule.control,
                borderRadius: radius.sm,
                padding: '12px 14px',
                color: color.mist,
                fontSize: '14px',
                lineHeight: 1.4,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Accessibility Needs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="epd-accessibility-needs" style={labelToken}>
              Accessibility Needs
            </label>
            <textarea
              id="epd-accessibility-needs"
              rows={2}
              disabled={detailsDisabled}
              value={accessibilityNeeds}
              placeholder="e.g. Hearing loop required, ramp access to main stage"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setAccessibilityNeeds(e.target.value)
              }
              style={{
                background: surface.fieldOnAbyss,
                border: rule.control,
                borderRadius: radius.sm,
                padding: '12px 14px',
                color: color.mist,
                fontSize: '14px',
                lineHeight: 1.4,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* SG2-91 AC3: reviewed by the Safety Officer in the safety check */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="epd-expected-crowd-movement" style={labelToken}>
              Expected Crowd Movement
            </label>
            <textarea
              id="epd-expected-crowd-movement"
              rows={2}
              disabled={isTerminal || isSaving}
              value={expectedCrowdMovement}
              placeholder="e.g. Arrive through the east doors, queue in the foyer, leave by the west exits"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setExpectedCrowdMovement(e.target.value)
              }
              style={{
                background: surface.fieldOnAbyss,
                border: rule.control,
                borderRadius: radius.sm,
                padding: '12px 14px',
                color: color.mist,
                fontSize: '14px',
                lineHeight: 1.4,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* AC 4: Attendee Registration Section */}
          <div
            style={{
              padding: '18px 20px',
              borderRadius: radius.sm,
              background: 'rgba(1, 38, 36, 0.4)',
              border: rule.faint,
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    color: color.platinum,
                    display: 'block',
                  }}
                >
                  Attendee Registration
                </span>
                <span style={{ fontSize: '12px', color: color.silver }}>
                  Whether attendees register. The organiser sets the capacity and times.
                </span>
              </div>
              <Chip
                bg={registrationNeeded ? color.accent : color.deep}
                bd={registrationNeeded ? color.accent : 'rgba(255,255,255,0.12)'}
                fg={registrationNeeded ? color.abyss : color.silver}
                pressed={registrationNeeded}
                onClick={() => {
                  if (!isTerminal && !isSaving) {
                    setRegistrationNeeded(!registrationNeeded);
                  }
                }}
              >
                {registrationNeeded ? 'Registration Enabled' : 'Registration Disabled'}
              </Chip>
            </div>

            {/* SG2-63 AC8 (replaces SG2-39 AC4): set by the organiser, read here. */}
            {registrationNeeded && (
              <dl
                data-testid="epd-registration-settings"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '14px',
                  margin: 0,
                  paddingTop: '8px',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {[
                  ['Registration Capacity', registrationCapacity === null ? 'Not set' : String(registrationCapacity)],
                  ['Opens At', initialValues?.registration_opens_at ? formatSgtTimestamp(initialValues.registration_opens_at) : 'Not set'],
                  ['Closes At', initialValues?.registration_closes_at ? formatSgtTimestamp(initialValues.registration_closes_at) : 'Not set'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    <dt style={labelToken}>{label}</dt>
                    <dd style={{ margin: 0, color: color.mist, fontSize: '14px', overflowWrap: 'anywhere' }}>{value}</dd>
                  </div>
                ))}
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '12px', color: color.silver }}>
                  Set by the event organiser. Ask them to change the capacity or times.
                </p>
              </dl>
            )}
          </div>

          {/* Internal Planning Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="epd-planning-notes" style={labelToken}>
              Planning Notes (Internal Coordinator Log)
            </label>
            <textarea
              id="epd-planning-notes"
              rows={3}
              disabled={isTerminal || isSaving}
              value={planningNotes}
              placeholder="Notes on coordination progress, caterer confirmations, etc."
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPlanningNotes(e.target.value)}
              style={{
                background: surface.fieldOnAbyss,
                border: rule.control,
                borderRadius: radius.sm,
                padding: '12px 14px',
                color: color.mist,
                fontSize: '14px',
                lineHeight: 1.4,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              paddingTop: '12px',
              borderTop: rule.faint,
            }}
          >
            <GradientButton
              disabled={isTerminal || isSaving}
              onClick={() => handleSave(false)}
              style={{ flex: 1 }}
            >
              {isSaving ? 'Saving…' : 'Save Planning Details'}
            </GradientButton>
            <GhostButton
              disabled={isSaving}
              onClick={onClose}
            >
              Cancel
            </GhostButton>
          </div>
        </div>
      </aside>
    </>
  );
}

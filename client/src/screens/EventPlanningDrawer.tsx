import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  updateEventPlanning,
  type PlanningEventRecord,
  type PlanningUpdatePayload,
} from '../api/eventRequests';
import { loadSession } from '../auth/session';
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
  status?: string | null;
}

export interface EventPlanningDrawerProps {
  isOpen?: boolean;
  onClose: () => void;
  eventId: number;
  initialValues?: EventPlanningInitialValues;
  accessToken?: string;
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
 * Validates coordinator planning drawer input before dispatching (AC 4).
 */
export function validatePlanningForm({
  proposedDate,
  expectedAttendance,
  registrationNeeded,
  registrationCapacity,
  registrationOpensAt,
  registrationClosesAt,
  venueRequirements,
  equipmentRequirements,
  accessibilityNeeds,
  planningNotes,
}: {
  proposedDate: string;
  expectedAttendance: string;
  registrationNeeded: boolean;
  registrationCapacity: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  venueRequirements: string;
  equipmentRequirements: string;
  accessibilityNeeds: string;
  planningNotes: string;
}): string[] {
  const errors: string[] = [];

  if (proposedDate.trim()) {
    const d = new Date(proposedDate.trim());
    if (isNaN(d.getTime())) {
      errors.push('Proposed date must be a valid date and time.');
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
  ];

  for (const tf of textFields) {
    if (tf.value.trim().length > 5000) {
      errors.push(`${tf.label} must be 5000 characters or fewer.`);
    }
  }

  if (registrationNeeded) {
    if (registrationCapacity.trim() !== '') {
      const cap = Number(registrationCapacity.trim());
      if (!Number.isInteger(cap) || cap < 1) {
        errors.push('Registration capacity must be a positive whole number.');
      } else if (cap > 2_147_483_647) {
        errors.push('Registration capacity must be at most 2147483647.');
      }
    }

    let openTime: number | null = null;
    let closeTime: number | null = null;

    if (registrationOpensAt.trim()) {
      const d = new Date(registrationOpensAt.trim());
      if (isNaN(d.getTime())) {
        errors.push('Registration opening time must be a valid date and time.');
      } else {
        openTime = d.getTime();
      }
    }

    if (registrationClosesAt.trim()) {
      const d = new Date(registrationClosesAt.trim());
      if (isNaN(d.getTime())) {
        errors.push('Registration closing time must be a valid date and time.');
      } else {
        closeTime = d.getTime();
      }
    }

    if (openTime !== null && closeTime !== null && closeTime <= openTime) {
      errors.push('Registration closing time must be after opening time.');
    }
  }

  return errors;
}

/**
 * Slide-out planning drawer for event coordinators (SG2-39).
 * Allows viewing and editing planning details, registration parameters,
 * and handles arrangement impact confirmation.
 */
export default function EventPlanningDrawer({
  isOpen = true,
  onClose,
  eventId,
  initialValues,
  accessToken,
  onSuccess,
}: EventPlanningDrawerProps) {
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
  const [registrationNeeded, setRegistrationNeeded] = useState(
    () => Boolean(initialValues?.registration_needed),
  );
  const [registrationCapacity, setRegistrationCapacity] = useState(() =>
    initialValues?.registration_capacity != null ? String(initialValues.registration_capacity) : '',
  );
  const [registrationOpensAt, setRegistrationOpensAt] = useState(() =>
    formatForDateTimeInput(initialValues?.registration_opens_at),
  );
  const [registrationClosesAt, setRegistrationClosesAt] = useState(() =>
    formatForDateTimeInput(initialValues?.registration_closes_at),
  );

  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDetails, setServerDetails] = useState<string[] | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [impactConfirmation, setImpactConfirmation] =
    useState<ImpactConfirmationState | null>(null);

  if (!isOpen) return null;

  const statusLower = initialValues?.status?.toLowerCase() ?? '';
  const isTerminal = ['cancelled', 'completed', 'rejected'].includes(statusLower);

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
      expectedAttendance,
      registrationNeeded,
      registrationCapacity,
      registrationOpensAt,
      registrationClosesAt,
      venueRequirements,
      equipmentRequirements,
      accessibilityNeeds,
      planningNotes,
    });

    if (validationErrors.length > 0) {
      setClientErrors(validationErrors);
      return;
    }
    setClientErrors([]);

    const token = accessToken ?? loadSession()?.accessToken;
    if (!token) {
      setServerError('You are signed out. Sign in again to update planning details.');
      return;
    }

    const payload: PlanningUpdatePayload = {
      proposed_date: toIsoOrNull(proposedDate),
      expected_attendance: expectedAttendance.trim() ? Number(expectedAttendance.trim()) : null,
      venue_requirements: venueRequirements.trim() || null,
      equipment_requirements: equipmentRequirements.trim() || null,
      accessibility_needs: accessibilityNeeds.trim() || null,
      planning_notes: planningNotes.trim() || null,
      registration_needed: registrationNeeded,
      registration_capacity:
        registrationNeeded && registrationCapacity.trim()
          ? Number(registrationCapacity.trim())
          : null,
      registration_opens_at: registrationNeeded ? toIsoOrNull(registrationOpensAt) : null,
      registration_closes_at: registrationNeeded ? toIsoOrNull(registrationClosesAt) : null,
      confirm_impact: confirmImpact,
    };

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
      } else if (outcome.kind === 'validation') {
        setServerError(outcome.message);
        setServerDetails(outcome.details);
      } else {
        setServerError(outcome.message);
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                role="alert"
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
                role="alert"
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
                disabled={isTerminal || isSaving}
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
                disabled={isTerminal || isSaving}
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
              disabled={isTerminal || isSaving}
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
              disabled={isTerminal || isSaving}
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
              disabled={isTerminal || isSaving}
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
                  Configure capacity caps and registration availability windows
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

            {registrationNeeded && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '14px',
                  paddingTop: '8px',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="epd-registration-capacity" style={labelToken}>
                    Registration Capacity
                  </label>
                  <input
                    id="epd-registration-capacity"
                    type="number"
                    min="1"
                    disabled={isTerminal || isSaving}
                    value={registrationCapacity}
                    placeholder="e.g. 200"
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setRegistrationCapacity(e.target.value)
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="epd-registration-opens-at" style={labelToken}>
                    Opens At
                  </label>
                  <input
                    id="epd-registration-opens-at"
                    type="datetime-local"
                    disabled={isTerminal || isSaving}
                    value={registrationOpensAt}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setRegistrationOpensAt(e.target.value)
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="epd-registration-closes-at" style={labelToken}>
                    Closes At
                  </label>
                  <input
                    id="epd-registration-closes-at"
                    type="datetime-local"
                    disabled={isTerminal || isSaving}
                    value={registrationClosesAt}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setRegistrationClosesAt(e.target.value)
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

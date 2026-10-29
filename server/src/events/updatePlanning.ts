import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchEventPlanningRecord,
  updateEventPlanningFields,
  type EventPlanningRecord,
  type FetchEventPlanningResult,
  type UpdateEventPlanningResult,
  type UpdatePlanningFieldsInput
} from '../db/eventPlanning';
import {
  insertAuditLogs,
  statusChange,
  type InsertAuditLogInput,
  type InsertAuditLogsResult
} from '../db/auditLogs';
import {
  fetchEventArrangementFacts,
  type EventArrangementFacts,
  type FetchEventArrangementFactsResult
} from '../db/eventArrangements';
import { eventLabel, eventNoticeMessages, notifyEvent } from '../db/eventNotifications';
import { isLive } from './arrangementReadiness';
import { RETURNS_TO_PLANNING } from './changeImpact';
import { isRegistrationSettingField } from './registrationSettings';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';
const MAX_ATTENDANCE = 2_147_483_647;
const MAX_TEXT_LENGTH = 5000;

export interface PlanningUpdateValues {
  expected_attendance?: number | null;
  proposed_date?: string | null;
  venue_requirements?: string | null;
  equipment_requirements?: string | null;
  accessibility_needs?: string | null;
  registration_needed?: boolean | null;
  planning_notes?: string | null;
  /** SG2-91 AC3: how attendees arrive, move through and leave the venue. */
  expected_crowd_movement?: string | null;
}

export type PlanningValidationResult =
  | { valid: true; values: PlanningUpdateValues; confirm_impact: boolean }
  | { valid: false; errors: string[] };

export interface ArrangementImpact {
  has_impact: boolean;
  affected_arrangements: string[];
  impact_notes: string[];
}

export interface UpdateEventPlanningDependencies {
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchPlanningRecord?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventPlanningResult>;
  updatePlanningFields?: (
    admin: SupabaseClient,
    eventId: number,
    fields: UpdatePlanningFieldsInput,
    coordinatorId: string
  ) => Promise<UpdateEventPlanningResult>;
  insertAudit?: (
    admin: SupabaseClient,
    entries: InsertAuditLogInput[]
  ) => Promise<InsertAuditLogsResult>;
  /** SG2-57's arrangement facts: which venue and equipment requests exist. */
  fetchArrangementFacts?: (
    admin: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventArrangementFactsResult>;
  /** Current time in epoch milliseconds; a new proposed date must be after it. */
  now?: () => number;
  /** SG2-66 AC7: tells the organiser and coordinator the event is back in Planning. */
  notify?: typeof notifyEvent;
}

const TEXT_FIELDS = [
  'venue_requirements',
  'equipment_requirements',
  'accessibility_needs',
  'planning_notes',
  'expected_crowd_movement'
] as const;

export const AUDITED_PLANNING_FIELDS = [
  'expected_attendance',
  'proposed_date',
  'venue_requirements',
  'accessibility_needs',
  'equipment_requirements',
  'registration_needed',
  'planning_notes',
  'expected_crowd_movement'
] as const;

/**
 * Fields a coordinator may still edit directly once an event is Confirmed or in
 * Preparation (SG2-66 AC6): whether registration is needed and the
 * coordinator's own planning notes, which are an internal log rather than
 * event details. Everything else needs a change request (SG2-64). Registration
 * capacity and times are the organiser's (SG2-63 AC8).
 */
const LOCKED_STATUS_EDITABLE_FIELDS: Record<string, true> = {
  registration_needed: true,
  planning_notes: true
};

/** SG2-63 AC8: refused before anything else is checked. */
export const REGISTRATION_SETTINGS_MESSAGE =
  'Registration capacity and opening and closing times are set by the Event Organiser.';

const LOCKED_STATUS_LABELS: Record<'confirmed' | 'preparation', string> = {
  confirmed: 'Confirmed',
  preparation: 'in Preparation'
};

/** The message a refused direct edit shows, pointing to a change request (SG2-66 AC6). */
export function changeRequestRequiredMessage(status: 'confirmed' | 'preparation'): string {
  return `This event is ${LOCKED_STATUS_LABELS[status]}, so its details can no longer be edited directly. ` +
    'Ask for the change through a change request instead; only whether registration is needed and planning notes can still be edited here.';
}

/**
 * Validates coordinator planning update input (AC 4).
 */
export function validatePlanningUpdateInput(body: unknown): PlanningValidationResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  const input = body as Record<string, unknown>;
  const errors: string[] = [];
  const values: PlanningUpdateValues = {};

  if (input.expected_attendance !== undefined) {
    if (input.expected_attendance === null) {
      values.expected_attendance = null;
    } else if (typeof input.expected_attendance !== 'number' || !Number.isInteger(input.expected_attendance)) {
      errors.push('expected_attendance must be a whole number.');
    } else if (input.expected_attendance < 1) {
      errors.push('expected_attendance must be at least 1.');
    } else if (input.expected_attendance > MAX_ATTENDANCE) {
      errors.push(`expected_attendance must be at most ${MAX_ATTENDANCE}.`);
    } else {
      values.expected_attendance = input.expected_attendance;
    }
  }

  if (input.proposed_date !== undefined) {
    if (input.proposed_date === null) {
      values.proposed_date = null;
    } else if (typeof input.proposed_date !== 'string' || input.proposed_date.trim().length === 0) {
      errors.push('proposed_date must be an ISO 8601 date-time string.');
    } else {
      const parsed = new Date(input.proposed_date);
      if (Number.isNaN(parsed.getTime())) {
        errors.push('proposed_date must be a valid date and time.');
      } else {
        values.proposed_date = parsed.toISOString();
      }
    }
  }

  for (const field of TEXT_FIELDS) {
    if (input[field] !== undefined) {
      if (input[field] === null) {
        values[field] = null;
      } else if (typeof input[field] !== 'string') {
        errors.push(`${field} must be text.`);
      } else {
        const trimmed = input[field].trim();
        if (trimmed.length > MAX_TEXT_LENGTH) {
          errors.push(`${field} must be ${MAX_TEXT_LENGTH} characters or fewer.`);
        } else {
          values[field] = trimmed.length > 0 ? trimmed : null;
        }
      }
    }
  }

  if (input.registration_needed !== undefined) {
    if (input.registration_needed === null) {
      values.registration_needed = null;
    } else if (typeof input.registration_needed !== 'boolean') {
      errors.push('registration_needed must be true or false.');
    } else {
      values.registration_needed = input.registration_needed;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    values,
    confirm_impact: Boolean(input.confirm_impact)
  };
}

/**
 * Checks the event's dates against each other and the clock (AC 4). Uses the
 * value being saved for each field when the request changes it, otherwise the
 * stored one, so a request cannot leave the event in an inconsistent state:
 * - a newly chosen proposed date must be in the future (an unchanged past date
 *   is left alone, since the drawer resends every field);
 * - the organiser's registration times (SG2-63) must still open and close
 *   before the event starts.
 */
export function validatePlanningSchedule(
  current: EventPlanningRecord,
  update: PlanningUpdateValues,
  now: number
): string[] {
  const errors: string[] = [];
  const timeOf = (value: string | null | undefined) => (value ? new Date(value).getTime() : null);

  const start = timeOf(update.proposed_date !== undefined ? update.proposed_date : current.proposed_date);
  // The organiser's registration times (SG2-63) still have to fit a new date.
  const opens = timeOf(current.registration_opens_at);
  const closes = timeOf(current.registration_closes_at);

  if (update.proposed_date) {
    const chosen = new Date(update.proposed_date).getTime();
    if (chosen !== timeOf(current.proposed_date) && chosen <= now) {
      errors.push('proposed_date must be in the future.');
    }
  }

  if (start !== null) {
    if (opens !== null && opens >= start) {
      errors.push('registration_opens_at must be before the event starts (proposed_date).');
    }
    if (closes !== null && closes >= start) {
      errors.push('registration_closes_at must be before the event starts (proposed_date).');
    }
  }

  return errors;
}

/**
 * Detects which existing arrangements an edit affects (AC 2): a date shift or
 * attendance increase affects the venue booking and equipment requests.
 * Registration capacity is the organiser's (SG2-63). A category is only
 * flagged when the event actually has that arrangement, by SG2-57's live
 * request rule: a live venue booking request (pending, held or approved), a
 * live equipment request or reservation, or registration being needed. An
 * edit to an event with nothing arranged yet — including equipment the
 * organiser asked for that nobody has requested — has no impact and needs no
 * confirmation.
 */
export function detectArrangementImpact(
  current: EventPlanningRecord,
  update: PlanningUpdateValues,
  facts: EventArrangementFacts
): ArrangementImpact {
  const venueArranged = facts.venue_requests.some(isLive);
  const equipmentRequested = facts.equipment_requests.some(isLive);
  const equipmentArranged = equipmentRequested || facts.equipment_reserved === true;

  const affected = new Set<string>();
  const notes: string[] = [];

  const recheckVenueAndEquipment = (change: string) => {
    const subjects: string[] = [];
    if (venueArranged) {
      affected.add('venue_recheck');
      subjects.push('venue booking');
    }
    if (equipmentArranged) {
      affected.add('equipment_recheck');
      subjects.push(equipmentRequested ? 'equipment requests' : 'equipment reservations');
    }
    if (subjects.length > 0) {
      notes.push(`${change} Existing ${subjects.join(' and ')} must be rechecked.`);
    }
  };

  // 1. Date shift: proposed_date != old
  if (
    update.proposed_date !== undefined &&
    update.proposed_date !== null &&
    current.proposed_date !== null &&
    new Date(current.proposed_date).getTime() !== new Date(update.proposed_date).getTime()
  ) {
    recheckVenueAndEquipment(
      `Proposed date changed from ${current.proposed_date} to ${update.proposed_date}.`
    );
  }

  // 2. Attendance increase: expected_attendance > old
  if (
    update.expected_attendance !== undefined &&
    update.expected_attendance !== null &&
    current.expected_attendance !== null &&
    update.expected_attendance > current.expected_attendance
  ) {
    recheckVenueAndEquipment(
      `Expected attendance increased from ${current.expected_attendance} to ${update.expected_attendance}.`
    );
  }

  return {
    has_impact: affected.size > 0,
    affected_arrangements: Array.from(affected),
    impact_notes: notes
  };
}

export function formatAuditValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

/**
 * Calculates field-level diffs for audit persistence (AC 1).
 */
export function computePlanningDiffs(
  eventId: number,
  actorId: string,
  current: EventPlanningRecord,
  update: PlanningUpdateValues
): InsertAuditLogInput[] {
  const diffs: InsertAuditLogInput[] = [];

  for (const field of AUDITED_PLANNING_FIELDS) {
    if (!(field in update) || update[field] === undefined) {
      continue;
    }

    const oldVal = current[field];
    const newVal = update[field];

    let changed = false;
    if (oldVal === null || oldVal === undefined) {
      changed = newVal !== null && newVal !== undefined;
    } else if (newVal === null || newVal === undefined) {
      changed = true;
    } else if (field === 'proposed_date') {
      changed = new Date(String(oldVal)).getTime() !== new Date(String(newVal)).getTime();
    } else {
      changed = oldVal !== newVal;
    }

    if (changed) {
      diffs.push({
        event_id: eventId,
        actor_id: actorId,
        field_name: field,
        old_value: formatAuditValue(oldVal),
        new_value: formatAuditValue(newVal)
      });
    }
  }

  return diffs;
}

/**
 * PATCH /api/event-requests/:eventId/planning — updates event planning information (SG2-39).
 */
export function createUpdateEventPlanningHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchPlanningRecord = fetchEventPlanningRecord,
  updatePlanningFields = updateEventPlanningFields,
  insertAudit = insertAuditLogs,
  fetchArrangementFacts = fetchEventArrangementFacts,
  now = Date.now,
  notify = notifyEvent
}: UpdateEventPlanningDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (principal.role !== 'event_coordinator') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId < 1) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }

    // SG2-63 AC8 (replaces SG2-39 AC4): the coordinator can see the
    // registration settings but not change them.
    const body: unknown = req.body ?? {};
    const settings = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? Object.keys(body).filter(isRegistrationSettingField) : [];
    if (settings.length > 0) {
      res.status(403).json({ error: REGISTRATION_SETTINGS_MESSAGE, fields: settings });
      return;
    }

    const validated = validatePlanningUpdateInput(body);
    if (!validated.valid) {
      res.status(400).json({ error: 'Invalid planning details', details: validated.errors });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const existing = await fetchPlanningRecord(admin, eventId);
    if (!existing.ok) {
      if (existing.reason === 'not_found') {
        res.status(404).json({ error: 'Event request not found.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const currentEvent = existing.event;

    // Enforce coordinator ownership
    if (currentEvent.coordinator_id !== principal.userId) {
      res.status(403).json({ error: 'Only the assigned event coordinator can update planning details.' });
      return;
    }

    // Terminal status guard (AC 5): reject cancelled and completed events
    if (currentEvent.status === 'cancelled' || currentEvent.status === 'completed' || currentEvent.status === 'rejected') {
      res.status(409).json({ error: `Cannot update planning information for a ${currentEvent.status} event.` });
      return;
    }

    // SG2-66 AC6: a Confirmed or Preparation event's details change only through
    // a change request. Unchanged values the drawer re-sends are not edits.
    if (currentEvent.status === 'confirmed' || currentEvent.status === 'preparation') {
      const lockedFields = computePlanningDiffs(eventId, principal.userId, currentEvent, validated.values)
        .map(diff => diff.field_name)
        .filter(field => LOCKED_STATUS_EDITABLE_FIELDS[field] !== true);
      if (lockedFields.length > 0) {
        res.status(409).json({
          error: changeRequestRequiredMessage(currentEvent.status),
          code: 'change_request_required',
          fields: lockedFields
        });
        return;
      }
    }

    // Dates against each other, the stored values and the clock (AC 4)
    const scheduleErrors = validatePlanningSchedule(currentEvent, validated.values, now());
    if (scheduleErrors.length > 0) {
      res.status(400).json({ error: 'Invalid planning details', details: scheduleErrors });
      return;
    }

    // Arrangement impact detection (AC 2), against the arrangements that exist
    const facts = await fetchArrangementFacts(admin, eventId);
    if (!facts.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const impact = detectArrangementImpact(currentEvent, validated.values, facts.facts);
    if (impact.has_impact && !validated.confirm_impact) {
      res.status(409).json({
        error: 'Arrangements require rechecking.',
        requires_confirmation: true,
        affected_arrangements: impact.affected_arrangements,
        impact_notes: impact.impact_notes
      });
      return;
    }

    // Build fields to update and state transition (AC 3)
    const fieldsToUpdate: UpdatePlanningFieldsInput = { ...validated.values };

    if (impact.has_impact) {
      fieldsToUpdate.arrangements_recheck_needed = true;
      fieldsToUpdate.outstanding_arrangements = Array.from(
        new Set([...currentEvent.outstanding_arrangements, ...impact.affected_arrangements])
      );
      // Only an Awaiting Safety Check event can come back this way: a Confirmed
      // or Preparation event's date and attendance are locked (SG2-66 AC6) and
      // its registration capacity is the organiser's (SG2-63 AC8), so no
      // confirmation is left to clear.
      fieldsToUpdate.status = 'planning';
    } else if (currentEvent.status === 'approved') {
      fieldsToUpdate.status = 'planning';
    }

    const auditEntries = computePlanningDiffs(
      eventId,
      principal.userId,
      currentEvent,
      validated.values
    );
    // SG2-40: moving the event into planning is a status change like any other.
    if (fieldsToUpdate.status && fieldsToUpdate.status !== currentEvent.status) {
      auditEntries.push(statusChange(eventId, principal.userId, currentEvent.status, fieldsToUpdate.status));
    }

    const updateResult = await updatePlanningFields(admin, eventId, fieldsToUpdate, principal.userId);
    if (!updateResult.ok) {
      if (updateResult.reason === 'not_found') {
        // The event was read as this coordinator's moments ago, so a write that
        // matches no row means it was reassigned in between (SG2-90).
        res.status(409).json({ error: 'This event is no longer assigned to you. Refresh and try again.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    if (auditEntries.length > 0) {
      const auditResult = await insertAudit(admin, auditEntries);
      if (!auditResult.ok) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
    }

    // SG2-66 AC7: back in Planning from a later stage. Both the organiser and the
    // assigned coordinator are told, even though the coordinator made the edit:
    // AC7 names them both, a deliberate exception to "nobody is told about
    // their own action".
    const returnedToPlanning = fieldsToUpdate.status === 'planning'
      && (RETURNS_TO_PLANNING as readonly string[]).includes(currentEvent.status);
    if (returnedToPlanning) {
      const label = eventLabel(currentEvent.name);
      const notified = await notify(admin, [
        { recipient_id: currentEvent.organiser_id, event_id: eventId, kind: 'event_returned_to_planning' as const,
          message: eventNoticeMessages.returnedToPlanningOrganiser(label) },
        { recipient_id: principal.userId, event_id: eventId, kind: 'event_returned_to_planning' as const,
          message: eventNoticeMessages.returnedToPlanningCoordinator(label) }
      ]);
      if (!notified.ok) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
    }

    res.status(200).json({
      event: updateResult.event,
      arrangements_recheck_needed: updateResult.event.arrangements_recheck_needed,
      outstanding_arrangements: updateResult.event.outstanding_arrangements
    });
  };
}

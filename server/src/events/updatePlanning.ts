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
  type InsertAuditLogInput,
  type InsertAuditLogsResult
} from '../db/auditLogs';
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
  registration_capacity?: number | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  planning_notes?: string | null;
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
    fields: UpdatePlanningFieldsInput
  ) => Promise<UpdateEventPlanningResult>;
  insertAudit?: (
    admin: SupabaseClient,
    entries: InsertAuditLogInput[]
  ) => Promise<InsertAuditLogsResult>;
}

const TEXT_FIELDS = [
  'venue_requirements',
  'equipment_requirements',
  'accessibility_needs',
  'planning_notes'
] as const;

export const AUDITED_PLANNING_FIELDS = [
  'expected_attendance',
  'proposed_date',
  'venue_requirements',
  'accessibility_needs',
  'equipment_requirements',
  'registration_needed',
  'registration_capacity',
  'registration_opens_at',
  'registration_closes_at',
  'planning_notes'
] as const;

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

  if (input.registration_capacity !== undefined) {
    if (input.registration_capacity === null) {
      values.registration_capacity = null;
    } else if (typeof input.registration_capacity !== 'number' || !Number.isInteger(input.registration_capacity)) {
      errors.push('registration_capacity must be a whole number.');
    } else if (input.registration_capacity < 1) {
      errors.push('registration_capacity must be a positive integer.');
    } else if (input.registration_capacity > MAX_ATTENDANCE) {
      errors.push(`registration_capacity must be at most ${MAX_ATTENDANCE}.`);
    } else {
      values.registration_capacity = input.registration_capacity;
    }
  }

  if (input.registration_opens_at !== undefined) {
    if (input.registration_opens_at === null) {
      values.registration_opens_at = null;
    } else if (typeof input.registration_opens_at !== 'string' || input.registration_opens_at.trim().length === 0) {
      errors.push('registration_opens_at must be an ISO 8601 date-time string.');
    } else {
      const parsed = new Date(input.registration_opens_at);
      if (Number.isNaN(parsed.getTime())) {
        errors.push('registration_opens_at must be a valid date and time.');
      } else {
        values.registration_opens_at = parsed.toISOString();
      }
    }
  }

  if (input.registration_closes_at !== undefined) {
    if (input.registration_closes_at === null) {
      values.registration_closes_at = null;
    } else if (typeof input.registration_closes_at !== 'string' || input.registration_closes_at.trim().length === 0) {
      errors.push('registration_closes_at must be an ISO 8601 date-time string.');
    } else {
      const parsed = new Date(input.registration_closes_at);
      if (Number.isNaN(parsed.getTime())) {
        errors.push('registration_closes_at must be a valid date and time.');
      } else {
        values.registration_closes_at = parsed.toISOString();
      }
    }
  }

  if (values.registration_opens_at && values.registration_closes_at) {
    if (new Date(values.registration_closes_at).getTime() <= new Date(values.registration_opens_at).getTime()) {
      errors.push('registration_closes_at must be after registration_opens_at.');
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
 * Detects arrangement impacts caused by date shifts, attendance increases,
 * or registration capacity increases (AC 2).
 */
export function detectArrangementImpact(
  current: EventPlanningRecord,
  update: PlanningUpdateValues
): ArrangementImpact {
  const affected = new Set<string>();
  const notes: string[] = [];

  // 1. Date shift: proposed_date != old
  if (
    update.proposed_date !== undefined &&
    update.proposed_date !== null &&
    current.proposed_date !== null
  ) {
    const oldTime = new Date(current.proposed_date).getTime();
    const newTime = new Date(update.proposed_date).getTime();
    if (oldTime !== newTime) {
      affected.add('venue_recheck');
      affected.add('equipment_recheck');
      notes.push(
        `Proposed date changed from ${current.proposed_date} to ${update.proposed_date}. Existing venue suitability and equipment requirements must be rechecked.`
      );
    }
  }

  // 2. Attendance increase: expected_attendance > old
  if (
    update.expected_attendance !== undefined &&
    update.expected_attendance !== null &&
    current.expected_attendance !== null
  ) {
    if (update.expected_attendance > current.expected_attendance) {
      affected.add('venue_recheck');
      affected.add('equipment_recheck');
      notes.push(
        `Expected attendance increased from ${current.expected_attendance} to ${update.expected_attendance}. Existing venue suitability and equipment requirements must be rechecked.`
      );
    }
  }

  // 3. Registration capacity increase: registration_capacity > old
  if (
    update.registration_capacity !== undefined &&
    update.registration_capacity !== null &&
    current.registration_capacity !== null
  ) {
    if (update.registration_capacity > current.registration_capacity) {
      affected.add('registration_recheck');
      notes.push(
        `Registration capacity increased from ${current.registration_capacity} to ${update.registration_capacity}. Existing registration arrangements must be rechecked.`
      );
    }
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
    } else if (
      field === 'proposed_date' ||
      field === 'registration_opens_at' ||
      field === 'registration_closes_at'
    ) {
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
  insertAudit = insertAuditLogs
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

    const validated = validatePlanningUpdateInput(req.body ?? {});
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

    // Registration window cross-validation with existing event values
    const effectiveOpens =
      validated.values.registration_opens_at !== undefined
        ? validated.values.registration_opens_at
        : currentEvent.registration_opens_at;
    const effectiveCloses =
      validated.values.registration_closes_at !== undefined
        ? validated.values.registration_closes_at
        : currentEvent.registration_closes_at;

    if (
      effectiveOpens &&
      effectiveCloses &&
      new Date(effectiveCloses).getTime() <= new Date(effectiveOpens).getTime()
    ) {
      res.status(400).json({
        error: 'Invalid planning details',
        details: ['registration_closes_at must be after registration_opens_at.']
      });
      return;
    }

    // Arrangement impact detection (AC 2)
    const impact = detectArrangementImpact(currentEvent, validated.values);
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

    const updateResult = await updatePlanningFields(admin, eventId, fieldsToUpdate);
    if (!updateResult.ok) {
      if (updateResult.reason === 'not_found') {
        res.status(404).json({ error: 'Event request not found.' });
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

    res.status(200).json({
      event: updateResult.event,
      arrangements_recheck_needed: updateResult.event.arrangements_recheck_needed,
      outstanding_arrangements: updateResult.event.outstanding_arrangements
    });
  };
}

import type { Request, RequestHandler, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import type { Principal } from '../auth/policy';
import {
  applyAcceptedEventChange,
  fetchChangeImpactEvent,
  fetchChangeImpactFacts,
  settleArrangementRecheck,
  type ApplyAcceptedEventChangeInput,
  type ApplyAcceptedEventChangeResult,
  type ChangeImpactEventRecord,
  type FetchChangeImpactEventResult,
  type FetchChangeImpactFactsResult,
  type SettleArrangementRecheckResult
} from '../db/changeImpact';
import type { ChangeRequestSource } from '../changeRequests/mockChangeRequests';
import {
  createDatabaseChangeRequestSource,
  raiseEventChangeRequest,
  type RaiseChangeRequestInput,
  type RaiseChangeRequestResult
} from '../db/changeRequests';
import {
  CHANGEABLE_FIELDS,
  RECHECK_KEYS,
  assessChangeImpact,
  isChangeableStatus,
  isRecheckKey,
  isSignificantField,
  recheckBlockers,
  type ChangeableField,
  type RecheckKey
} from './changeImpact';
import { validateDraftInput } from './fields';
import { validatePlanningSchedule, type PlanningUpdateValues } from './updatePlanning';

const UNAVAILABLE_MESSAGE = 'Change request service is temporarily unavailable. Please try again later.';
const EVENT_NOT_FOUND_MESSAGE = 'Event not found.';
const CHANGE_NOT_FOUND_MESSAGE = 'Change request not found.';
const NOT_CHANGEABLE_MESSAGE = 'A change can only be accepted while the event is Approved, in Planning, '
  + 'Awaiting Safety Check, in Preparation or Confirmed.';
const STALE_MESSAGE = 'This event changed while you were deciding. Refresh and try again.';
const NOT_WAITING_MESSAGE = 'That arrangement is not waiting for a recheck.';
const BLOCKED_MESSAGE = 'This arrangement still needs attention before it can be marked rechecked.';
const MAX_REASON_LENGTH = 1000;
const CLOSED_MESSAGE = 'A change cannot be requested on a draft, cancelled, rejected or completed event.';
const UNCHANGED_MESSAGE = 'The event already has that value.';

export interface ChangeRequestDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  /** Where change requests come from: public.event_change_requests (SG2-64)
   * unless a test or the e2e loopback passes the in-memory stand-in. */
  source?: ChangeRequestSource;
  raise?: (admin: SupabaseClient, input: RaiseChangeRequestInput) => Promise<RaiseChangeRequestResult>;
  fetchEvent?: (admin: SupabaseClient, eventId: number) => Promise<FetchChangeImpactEventResult>;
  fetchFacts?: (admin: SupabaseClient, eventId: number) => Promise<FetchChangeImpactFactsResult>;
  applyChange?: (admin: SupabaseClient, input: ApplyAcceptedEventChangeInput) => Promise<ApplyAcceptedEventChangeResult>;
  settleRecheck?: (
    admin: SupabaseClient, eventId: number, actorId: string, key: RecheckKey
  ) => Promise<SettleArrangementRecheckResult>;
  now?: () => number;
}

interface AssignedEvent {
  principal: Principal;
  admin: SupabaseClient;
  event: ChangeImpactEventRecord;
}

/**
 * The checks every change-request route starts with: a signed-in Event
 * Coordinator, a valid event id, and an event assigned to them. An event
 * assigned to someone else gets the same 404 as one that does not exist, so
 * assignments cannot be probed. Returns null once a response has been sent.
 */
async function loadAssignedEvent(
  req: Request,
  res: Response,
  deps: Required<Pick<ChangeRequestDependencies, 'getPrincipal' | 'getAdminClient' | 'fetchEvent'>>
): Promise<AssignedEvent | null> {
  const principal = deps.getPrincipal(req);
  if (!principal) {
    // Defensive: these handlers are only mounted behind requireAuth.
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  if (principal.role !== 'event_coordinator') {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  const raw = req.params.eventId;
  const eventId = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
    res.status(400).json({ error: 'eventId must be a positive integer.' });
    return null;
  }
  if (req.params.key !== undefined && !isRecheckKey(req.params.key)) {
    res.status(400).json({ error: `key must be one of ${RECHECK_KEYS.join(', ')}.` });
    return null;
  }
  const admin = deps.getAdminClient();
  if (!admin) {
    res.status(503).json({ error: UNAVAILABLE_MESSAGE });
    return null;
  }
  const fetched = await deps.fetchEvent(admin, eventId);
  if (!fetched.ok && fetched.reason === 'unavailable') {
    res.status(503).json({ error: UNAVAILABLE_MESSAGE });
    return null;
  }
  if (!fetched.ok || fetched.event.coordinator_id !== principal.userId) {
    res.status(404).json({ error: EVENT_NOT_FOUND_MESSAGE });
    return null;
  }
  return { principal, admin, event: fetched.event };
}

/** The event id, or null once a 400 has been sent. */
function eventIdFrom(req: Request, res: Response): number | null {
  const raw = req.params.eventId;
  const eventId = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
    res.status(400).json({ error: 'eventId must be a positive integer.' });
    return null;
  }
  return eventId;
}

/** SG2-64 AC1: what, to what and why; or the errors to send back. */
function validateRaiseInput(body: unknown):
  { ok: true; field: ChangeableField; to: string | number; reason: string } | { ok: false; errors: string[] } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Request body must be a JSON object.'] };
  }
  const input = body as Record<string, unknown>;
  const field = input.field;
  if (typeof field !== 'string' || !(CHANGEABLE_FIELDS as readonly string[]).includes(field)) {
    return { ok: false, errors: [`field must be one of: ${CHANGEABLE_FIELDS.join(', ')}.`] };
  }
  const errors: string[] = [];
  // The same value rules as the request form (SG2-28), for the one field.
  const checked = validateDraftInput({ [field]: input.to });
  const to = checked.valid ? checked.values[field as ChangeableField] : null;
  if (!checked.valid) errors.push(...checked.errors);
  else if (to === null) errors.push('Give the new value.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    errors.push(`Give a reason for the change, up to ${MAX_REASON_LENGTH} characters.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, field: field as ChangeableField, to: to as string | number, reason };
}

/**
 * The SG2-64 route for the organiser who owns the event:
 * - POST /api/event-requests/:eventId/change-requests { field, to, reason }
 *   raises a change request (AC1), notifies the assigned coordinator (AC2) and
 *   is refused on a draft, cancelled, rejected or completed event (AC4);
 * - GET on the same path lists their outstanding requests (AC3).
 * The owner, the status and the current value are checked by
 * raise_event_change_request under the event's row lock. An event the caller
 * does not own gets the same 404 as one that does not exist.
 *
 * The SG2-66 routes for the event's assigned coordinator:
 * - GET  /api/event-requests/:eventId/change-requests — each pending change
 *   request with what it would break (AC1–AC3);
 * - POST /api/event-requests/:eventId/change-requests/:changeRequestId/accept
 *   — applies it; with affected arrangements they become outstanding and the
 *   event returns to Planning, telling the organiser and coordinator (AC4/AC7);
 * - POST /api/event-requests/:eventId/rechecks/:key/settle — marks one
 *   outstanding recheck settled once its arrangements pass again (AC4).
 * The impact is always recomputed from fresh facts; the client is never trusted.
 */
export function createChangeRequestHandlers({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  source = createDatabaseChangeRequestSource(getAdminClient),
  raise = raiseEventChangeRequest,
  fetchEvent = fetchChangeImpactEvent,
  fetchFacts = fetchChangeImpactFacts,
  applyChange = applyAcceptedEventChange,
  settleRecheck = settleArrangementRecheck,
  now = Date.now
}: ChangeRequestDependencies): {
  raise: RequestHandler; list: RequestHandler; accept: RequestHandler; settle: RequestHandler;
} {
  const prelude = { getPrincipal, getAdminClient, fetchEvent };

  const raiseHandler: RequestHandler = async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: these handlers are only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (principal.role !== 'event_organiser') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const eventId = eventIdFrom(req, res);
    if (eventId === null) return;
    const input = validateRaiseInput(req.body);
    if (!input.ok) {
      res.status(400).json({ error: 'Invalid change request', details: input.errors });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const result = await raise(admin, {
      eventId, actorId: principal.userId, field: input.field, to: input.to, reason: input.reason
    });
    switch (result.outcome) {
      case 'ok':
        res.status(201).json({ change_request: result.request, coordinator_notified: result.coordinator_notified });
        return;
      case 'not_found':
        res.status(404).json({ error: EVENT_NOT_FOUND_MESSAGE });
        return;
      case 'closed':
        res.status(409).json({ error: CLOSED_MESSAGE, status: result.status });
        return;
      case 'unchanged':
        res.status(409).json({ error: UNCHANGED_MESSAGE });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  };

  /** SG2-64 AC3: the owning organiser sees their outstanding requests. */
  const listOwn = async (req: Request, res: Response, principal: Principal) => {
    const eventId = eventIdFrom(req, res);
    if (eventId === null) return;
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const fetched = await fetchEvent(admin, eventId);
    if (!fetched.ok && fetched.reason === 'unavailable') {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (!fetched.ok || fetched.event.organiser_id !== principal.userId) {
      res.status(404).json({ error: EVENT_NOT_FOUND_MESSAGE });
      return;
    }
    let requests;
    try {
      requests = await source.list(fetched.event);
    } catch {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.status(200).json({
      event: { event_id: fetched.event.event_id, status: fetched.event.status },
      change_requests: requests
    });
  };

  const list: RequestHandler = async (req, res) => {
    const principal = getPrincipal(req);
    if (principal?.role === 'event_organiser') {
      await listOwn(req, res, principal);
      return;
    }
    const loaded = await loadAssignedEvent(req, res, prelude);
    if (!loaded) return;
    const { admin, event } = loaded;
    const facts = await fetchFacts(admin, event.event_id);
    if (!facts.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    let requests;
    try {
      requests = await source.list(event);
    } catch {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.status(200).json({
      event: { event_id: event.event_id, status: event.status },
      can_accept: isChangeableStatus(event.status),
      change_requests: requests.map(request => ({
        ...request,
        significant: request.changes.some(change => isSignificantField(change.field)),
        impact: assessChangeImpact(event, request.changes, facts.facts)
      }))
    });
  };

  const accept: RequestHandler = async (req, res) => {
    const loaded = await loadAssignedEvent(req, res, prelude);
    if (!loaded) return;
    const { principal, admin, event } = loaded;
    let request;
    try {
      request = await source.get(event, req.params.changeRequestId);
    } catch {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (!request) {
      res.status(404).json({ error: CHANGE_NOT_FOUND_MESSAGE });
      return;
    }
    if (!isChangeableStatus(event.status)) {
      res.status(409).json({ error: NOT_CHANGEABLE_MESSAGE });
      return;
    }
    const changes = Object.fromEntries(request.changes.map(change => [change.field, change.to]));
    const scheduleErrors = validatePlanningSchedule(event, changes as PlanningUpdateValues, now());
    if (scheduleErrors.length > 0) {
      res.status(400).json({ error: 'Invalid change', details: scheduleErrors });
      return;
    }
    const facts = await fetchFacts(admin, event.event_id);
    if (!facts.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const impact = assessChangeImpact(event, request.changes, facts.facts);
    const result = await applyChange(admin, {
      eventId: event.event_id,
      actorId: principal.userId,
      expectedStatus: event.status,
      changeReference: `change request ${request.id}`,
      changes,
      outstanding: impact.outstanding_arrangements
    });
    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (result.outcome === 'stale') {
      res.status(409).json({ error: STALE_MESSAGE });
      return;
    }
    try {
      await source.markAccepted(event, request.id);
    } catch {
      // The change is applied; only the stand-in's bookkeeping failed.
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.status(200).json({
      event_id: event.event_id,
      previous_status: result.previous_status,
      status: result.status,
      returned_to_planning: result.returned_to_planning,
      arrangements_recheck_needed: result.arrangements_recheck_needed,
      outstanding_arrangements: result.outstanding_arrangements
    });
  };

  const settle: RequestHandler = async (req, res) => {
    const loaded = await loadAssignedEvent(req, res, prelude);
    if (!loaded) return;
    const { principal, admin, event } = loaded;
    const key = req.params.key as RecheckKey;
    if (!event.outstanding_arrangements.includes(key)) {
      res.status(409).json({ error: NOT_WAITING_MESSAGE });
      return;
    }
    const facts = await fetchFacts(admin, event.event_id);
    if (!facts.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const blockers = recheckBlockers(key, event, facts.facts);
    if (blockers.length > 0) {
      res.status(409).json({ error: BLOCKED_MESSAGE, blockers });
      return;
    }
    const result = await settleRecheck(admin, event.event_id, principal.userId, key);
    switch (result.outcome) {
      case 'ok':
        res.status(200).json({
          event_id: event.event_id,
          arrangements_recheck_needed: result.arrangements_recheck_needed,
          outstanding_arrangements: result.outstanding_arrangements
        });
        return;
      case 'flagged':
        // SG2-93 AC4: the requests the Safety Officer flagged are still with the staff.
        res.status(409).json({
          error: BLOCKED_MESSAGE,
          blockers: result.waiting.map(item => `${item.label} is waiting for `
            + `${item.arrangement === 'venue' ? 'Venue Staff' : 'Technical Support'} to confirm it again.`)
        });
        return;
      case 'not_outstanding':
        res.status(409).json({ error: NOT_WAITING_MESSAGE });
        return;
      case 'stale':
        res.status(409).json({ error: STALE_MESSAGE });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  };

  return { raise: raiseHandler, list, accept, settle };
}

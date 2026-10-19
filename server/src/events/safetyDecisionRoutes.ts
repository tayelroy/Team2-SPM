import type { Request, RequestHandler, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import type { Principal } from '../auth/policy';
import {
  fetchSafetyDecisionEvent,
  listSafetyDecisions,
  recordSafetyDecision,
  reworkSafetyRejectedEvent,
  type FetchSafetyDecisionEventResult,
  type ListSafetyDecisionsResult,
  type RecordSafetyDecisionInput,
  type RecordSafetyDecisionResult,
  type ReworkSafetyRejectedEventResult
} from '../db/safetyDecisions';
import { validateSafetyDecision } from './safetyDecisions';

const UNAVAILABLE_MESSAGE = 'Safety checks are temporarily unavailable. Please try again later.';
const NOT_FOUND_MESSAGE = 'Event not found.';
const CLOSED_MESSAGE = 'This event is no longer awaiting a safety check.';
const STALE_MESSAGE = 'This event changed after you opened it. Refresh the safety checks and review it again.';
const NOT_REJECTED_MESSAGE = 'Only a Safety Rejected event can be reworked.';

export interface SafetyDecisionDependencies {
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchEvent?: (admin: SupabaseClient, eventId: number) => Promise<FetchSafetyDecisionEventResult>;
  listDecisions?: (admin: SupabaseClient, eventId: number) => Promise<ListSafetyDecisionsResult>;
  recordDecision?: (admin: SupabaseClient, input: RecordSafetyDecisionInput) => Promise<RecordSafetyDecisionResult>;
  rework?: (admin: SupabaseClient, eventId: number, actorId: string) => Promise<ReworkSafetyRejectedEventResult>;
}

/**
 * The signed-in caller, the admin client and the event id every event route
 * starts with. Returns null once a response has been sent. The route's
 * permission already limits the roles; per-row checks are the caller's.
 */
function prelude(req: Request, res: Response, deps: Required<Pick<SafetyDecisionDependencies, 'getPrincipal' | 'getAdminClient'>>) {
  const principal = deps.getPrincipal(req);
  if (!principal) {
    // Defensive: these handlers are only mounted behind requireAuth.
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const raw = req.params.eventId;
  const eventId = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
    res.status(400).json({ error: 'eventId must be a positive integer.' });
    return null;
  }
  const admin = deps.getAdminClient();
  if (!admin) {
    res.status(503).json({ error: UNAVAILABLE_MESSAGE });
    return null;
  }
  return { principal, admin, eventId };
}

/**
 * SG2-92 routes (the list of events awaiting a check is SG2-91's
 * GET /api/safety-checks, which returns each event's safety_check_revision):
 * - POST /api/event-requests/:eventId/safety-decision — the Safety Officer's
 *   Approve / Reject / Request Changes on the revision they reviewed
 *   (AC1–AC6, one database transaction; a stale review is refused);
 * - GET  /api/event-requests/:eventId/safety-decisions — every decision, newest
 *   first, for the Safety Officer, the assigned coordinator or the organiser;
 * - POST /api/event-requests/:eventId/rework — the assigned coordinator takes a
 *   Safety Rejected event back to Planning (AC4).
 */
export function createSafetyDecisionHandlers({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchEvent = fetchSafetyDecisionEvent,
  listDecisions = listSafetyDecisions,
  recordDecision = recordSafetyDecision,
  rework = reworkSafetyRejectedEvent
}: SafetyDecisionDependencies): { record: RequestHandler; decisions: RequestHandler; rework: RequestHandler } {
  const deps = { getPrincipal, getAdminClient };

  const record: RequestHandler = async (req, res) => {
    const loaded = prelude(req, res, deps);
    if (!loaded) return;
    const validated = validateSafetyDecision(req.body);
    if (!validated.valid) {
      res.status(400).json({ error: 'Invalid safety decision', details: validated.errors });
      return;
    }
    const result = await recordDecision(loaded.admin, { ...validated.value, eventId: loaded.eventId, actorId: loaded.principal.userId });
    switch (result.outcome) {
      case 'ok': {
        const history = await listDecisions(loaded.admin, loaded.eventId);
        const decision = history.ok ? history.decisions.find(row => row.decision_id === result.decision_id) : undefined;
        res.status(201).json({
          decision: decision ?? {
            decision_id: result.decision_id, event_id: loaded.eventId, decision: result.decision,
            reason: validated.value.reason, arrangements: validated.value.arrangements,
            decided_by: loaded.principal.userId, decided_by_name: null, decided_at: result.decided_at
          },
          previous_status: result.previous_status,
          status: result.status
        });
        return;
      }
      case 'closed':
        res.status(409).json({ error: CLOSED_MESSAGE, status: result.status });
        return;
      case 'stale':
        res.status(409).json({ error: STALE_MESSAGE, code: 'stale', revision: result.revision });
        return;
      case 'missing':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'forbidden':
        // The role was revoked between sign-in and the write.
        res.status(403).json({ error: 'Access denied' });
        return;
      case 'invalid':
        // validateSafetyDecision and the database function apply the same rules.
        res.status(400).json({ error: 'Invalid safety decision', details: [] });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  };

  const decisions: RequestHandler = async (req, res) => {
    const loaded = prelude(req, res, deps);
    if (!loaded) return;
    const { principal, admin, eventId } = loaded;
    const fetched = await fetchEvent(admin, eventId);
    if (!fetched.ok && fetched.reason === 'unavailable') {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    // An event the caller may not see is reported missing, so its existence is not revealed.
    const visible = fetched.ok && (principal.role === 'safety_officer'
      || (principal.role === 'event_coordinator' && fetched.event.coordinator_id === principal.userId)
      || (principal.role === 'event_organiser' && fetched.event.organiser_id === principal.userId));
    if (!visible) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }
    const history = await listDecisions(admin, eventId);
    if (!history.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.status(200).json({ decisions: history.decisions });
  };

  const reworkEvent: RequestHandler = async (req, res) => {
    const loaded = prelude(req, res, deps);
    if (!loaded) return;
    const result = await rework(loaded.admin, loaded.eventId, loaded.principal.userId);
    switch (result.outcome) {
      case 'ok':
        res.status(200).json({ event_id: loaded.eventId, status: result.status });
        return;
      case 'closed':
        res.status(409).json({ error: NOT_REJECTED_MESSAGE, status: result.status });
        return;
      case 'missing':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  };

  return { record, decisions, rework: reworkEvent };
}

import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchEventRequestById,
  requestClarification,
  type FetchEventRequestResult,
  type RequestClarificationResult
} from '../db/eventRequests';
import {
  fetchClarifications,
  insertClarification,
  type FetchClarificationsResult,
  type InsertClarificationResult
} from '../db/clarifications';
import { insertAuditLogs, statusChange, type InsertAuditLogsResult } from '../db/auditLogs';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';
const NOT_FOUND_MESSAGE = 'No event request found for this account.';

/** Matches the free-text limit the draft fields already use. */
const MAX_MESSAGE_LENGTH = 5000;

export interface ClarificationDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchRequest?: (admin: SupabaseClient, eventId: number) => Promise<FetchEventRequestResult>;
  fetchThread?: (admin: SupabaseClient, eventId: number) => Promise<FetchClarificationsResult>;
  addMessage?: (
    admin: SupabaseClient,
    eventId: number,
    senderId: string,
    message: string
  ) => Promise<InsertClarificationResult>;
  returnForClarification?: (
    admin: SupabaseClient,
    eventId: number,
    coordinatorId: string
  ) => Promise<RequestClarificationResult>;
  writeAuditLogs?: typeof insertAuditLogs;
}

/**
 * Who may take part in an event's clarification thread (SG2-36): the
 * coordinator the request is assigned to, and the organiser who raised it.
 *
 * Anyone else — including a different coordinator, or a colleague who can
 * merely view the event under SG2-26 — is answered as though the request does
 * not exist, so a thread cannot be probed for.
 */
function participantRole(
  principal: Principal,
  request: { organiser_id: string; coordinator_id?: string | null }
): 'coordinator' | 'organiser' | null {
  if (principal.role === 'event_coordinator' && request.coordinator_id === principal.userId) {
    return 'coordinator';
  }
  if (principal.role === 'event_organiser' && request.organiser_id === principal.userId) {
    return 'organiser';
  }
  return null;
}

/** Shared preamble: verify the caller, the id, the client, and participation. */
async function resolveParticipant(
  req: Request,
  deps: Required<Pick<ClarificationDependencies, 'getPrincipal' | 'getAdminClient' | 'fetchRequest'>>
): Promise<
  | { ok: true; admin: SupabaseClient; principal: Principal; eventId: number; request: FetchEventRequestResult & { ok: true } }
  | { ok: false; status: 400 | 401 | 404 | 503; error: string }
> {
  const principal = deps.getPrincipal(req);
  if (!principal) {
    // Defensive: these handlers are only mounted behind requireAuth.
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const eventId = Number(req.params.eventId);
  if (!Number.isInteger(eventId) || eventId < 1) {
    return { ok: false, status: 400, error: 'eventId must be a positive integer.' };
  }

  const admin = deps.getAdminClient();
  if (!admin) {
    return { ok: false, status: 503, error: UNAVAILABLE_MESSAGE };
  }

  const existing = await deps.fetchRequest(admin, eventId);
  if (!existing.ok) {
    if (existing.reason === 'not_found') {
      return { ok: false, status: 404, error: NOT_FOUND_MESSAGE };
    }
    return { ok: false, status: 503, error: UNAVAILABLE_MESSAGE };
  }

  if (!participantRole(principal, existing.request)) {
    return { ok: false, status: 404, error: NOT_FOUND_MESSAGE };
  }

  return { ok: true, admin, principal, eventId, request: existing };
}

/**
 * GET /api/event-requests/:eventId/clarifications — reads the exchange (SG2-36).
 *
 * The thread stays attached to the event record, so both sides can see what
 * was asked and answered rather than relying on email.
 */
export function createListClarificationsHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequest = fetchEventRequestById,
  fetchThread = fetchClarifications
}: ClarificationDependencies): RequestHandler {
  return async (req, res) => {
    const resolved = await resolveParticipant(req, { getPrincipal, getAdminClient, fetchRequest });
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const thread = await fetchThread(resolved.admin, resolved.eventId);
    if (!thread.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ clarifications: thread.clarifications, status: resolved.request.request.status });
  };
}

/**
 * POST /api/event-requests/:eventId/clarifications — adds a message (SG2-36).
 *
 * When the assigned coordinator posts while the request is still
 * `under_review`, the same call returns it to the organiser: the status moves
 * to `needs_clarification`, which SG2-29's edit and SG2-30's submit both
 * accept, so the organiser can amend and resubmit. The status change is
 * recorded in the SG2-39 audit log so the history shows who parked it.
 *
 * Posting at any other point simply appends, which is what a follow-up
 * question or the organiser's answer is.
 */
export function createAddClarificationHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequest = fetchEventRequestById,
  addMessage = insertClarification,
  returnForClarification = requestClarification,
  writeAuditLogs = insertAuditLogs
}: ClarificationDependencies): RequestHandler {
  return async (req, res) => {
    const resolved = await resolveParticipant(req, { getPrincipal, getAdminClient, fetchRequest });
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const { admin, principal, eventId, request } = resolved;

    const raw = (req.body ?? {}) as { message?: unknown };
    if (raw.message !== undefined && raw.message !== null && typeof raw.message !== 'string') {
      res.status(400).json({ error: 'message must be text.' });
      return;
    }
    const message = typeof raw.message === 'string' ? raw.message.trim() : '';
    if (message.length === 0) {
      res.status(400).json({ error: 'A message is required.' });
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
      return;
    }

    const role = participantRole(principal, request.request)!;
    let status = request.request.status;

    if (role === 'coordinator' && status === 'under_review') {
      const returned = await returnForClarification(admin, eventId, principal.userId);
      if (!returned.ok) {
        // The request moved on between the read and the write — another
        // coordinator decided it, or it was reassigned.
        res.status(returned.reason === 'not_found' ? 404 : 503).json({
          error: returned.reason === 'not_found' ? NOT_FOUND_MESSAGE : UNAVAILABLE_MESSAGE
        });
        return;
      }
      status = returned.request.status;
      const logged = await writeAuditLogs(admin, [statusChange(eventId, principal.userId, 'under_review', status)]);
      if (!logged.ok) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
    }

    const added = await addMessage(admin, eventId, principal.userId, message);
    if (!added.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(201).json({ clarification: added.clarification, status });
  };
}

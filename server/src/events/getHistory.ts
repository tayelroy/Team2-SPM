import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchEventRequestById,
  type FetchEventRequestResult
} from '../db/eventRequests';
import {
  fetchEventAuditLogs,
  type FetchEventAuditLogsResult
} from '../db/auditLogs';
import { INTERNAL_ONLY_AUDIT_FIELDS, isInternalRole, type Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event history service is temporarily unavailable. Please try again later.';

export interface GetEventHistoryDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchEventRequest?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventRequestResult>;
  fetchAuditLogs?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventAuditLogsResult>;
}

/**
 * GET /api/event-requests/:eventId/history — returns change history for an event (SG2-40).
 */
export function createGetEventHistoryHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchEventRequest = fetchEventRequestById,
  fetchAuditLogs = fetchEventAuditLogs
}: GetEventHistoryDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId < 1) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }

    // RBAC: Attendees are strictly denied
    if (principal.role === 'attendee') {
      res.status(403).json({ error: 'Attendees are not authorized to view change history.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const eventResult = await fetchEventRequest(admin, eventId);
    if (!eventResult.ok) {
      if (eventResult.reason === 'not_found') {
        res.status(404).json({ error: 'Event not found.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const event = eventResult.request;

    // RBAC & Ownership: Organisers can only view history of their own events
    if (principal.role === 'event_organiser' && event.organiser_id !== principal.userId) {
      res.status(403).json({ error: 'You are not authorized to view the change history of this event.' });
      return;
    }

    const historyResult = await fetchAuditLogs(admin, eventId);
    if (!historyResult.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    // The audit read uses the admin client, so RLS does not apply here: an
    // organiser must not receive the coordinators' internal-only entries.
    const internal = isInternalRole(principal.role);
    const visible = historyResult.logs.filter(
      (log) => internal || !INTERNAL_ONLY_AUDIT_FIELDS.includes(log.field_name)
    );

    const history = visible.map((log) => ({
      log_id: log.log_id,
      event_id: log.event_id,
      actor_id: log.actor_id,
      actor_name: log.actor_name ?? 'Unknown',
      field_name: log.field_name,
      old_value: log.old_value,
      new_value: log.new_value,
      created_at: log.created_at
    }));

    res.status(200).json({
      event_id: eventId,
      history
    });
  };
}

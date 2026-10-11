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
import { getAccountRoles, type GetAccountRolesResult } from '../db/accountRoles';
import { INTERNAL_ONLY_AUDIT_FIELDS, isInternalRole, type Principal } from '../auth/policy';
import { toDisplayRole } from '../auth/roleFormat';

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
  fetchActorRoles?: (client: SupabaseClient, userIds: string[]) => Promise<GetAccountRolesResult>;
}

/**
 * GET /api/event-requests/:eventId/history — returns change history for an event (SG2-40).
 *
 * Each entry names the actor's role (`actor_role`, Title Case, from the
 * authoritative `account_roles` store), so the drawer can say who acted in
 * what capacity. It is the actor's current role; system-written rows have no
 * actor and so no role.
 */
export function createGetEventHistoryHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchEventRequest = fetchEventRequestById,
  fetchAuditLogs = fetchEventAuditLogs,
  fetchActorRoles = getAccountRoles
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

    const actorIds = [...new Set(visible.flatMap((log) => (log.actor_id === null ? [] : [log.actor_id])))];
    let roles = new Map<string, string>();
    if (actorIds.length > 0) {
      const rolesResult = await fetchActorRoles(admin, actorIds);
      if (!rolesResult.ok) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
      roles = rolesResult.roles;
    }

    const history = visible.map((log) => {
      const role = log.actor_id === null ? undefined : roles.get(log.actor_id);
      return {
        log_id: log.log_id,
        event_id: log.event_id,
        actor_id: log.actor_id,
        actor_name: log.actor_name ?? 'Unknown',
        actor_role: role === undefined ? null : toDisplayRole(role),
        field_name: log.field_name,
        old_value: log.old_value,
        new_value: log.new_value,
        created_at: log.created_at
      };
    });

    res.status(200).json({
      event_id: eventId,
      history
    });
  };
}

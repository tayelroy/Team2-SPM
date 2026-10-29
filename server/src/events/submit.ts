import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchManageableEventRequest,
  submitEventRequest,
  type FetchEventRequestResult,
  type SubmitEventRequestResult
} from '../db/eventRequests';
import { insertAuditLogs, statusChange } from '../db/auditLogs';
import { eventLabel, eventNoticeMessages, fetchLeadIds, notifyEvent, type EventNotice } from '../db/eventNotifications';
import type { Principal } from '../auth/policy';
import { missingForSubmission, PROPOSED_DATE_IN_FUTURE_MESSAGE, PROPOSED_DATE_IN_PAST } from './fields';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface SubmitEventRequestDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchOwnRequest?: (
    admin: SupabaseClient,
    eventId: number,
    organiserId: string
  ) => Promise<FetchEventRequestResult>;
  submitRequest?: (admin: SupabaseClient, eventId: number) => Promise<SubmitEventRequestResult>;
  writeHistory?: typeof insertAuditLogs;
  fetchLeads?: typeof fetchLeadIds;
  notify?: typeof notifyEvent;
  /** The clock a proposed date must be after (SG2-30 AC2). */
  now?: () => number;
}

/** Statuses a caller may submit from: a fresh draft, or a rejected request being reworked. */
const SUBMITTABLE_STATUSES = new Set(['draft', 'rejected', 'needs_clarification']);

/**
 * PATCH /api/event-requests/:eventId/submit — submits a draft for review (SG2-30).
 *
 * Only the request's own organiser may submit it, only while it is still a
 * `draft` or `rejected` (customer clarification: rejection is not final —
 * organisers may revise and resubmit), only once every
 * SUBMISSION_REQUIRED_FIELDS value (SG2-28) is filled in, and only while the
 * proposed date is still in the future (a past date is listed as the
 * outstanding item `proposed_date_in_past`). The transition to
 * `submitted` happens only here, through the admin client, so it can never be
 * forged by a direct client write to `status` — the gap the AI Security
 * Review flagged on the earlier attempt at this ticket (PR #13).
 *
 * The transition is recorded in SG2-40's history with the organiser as
 * actor. The old value is the status just read: the write is guarded on the
 * same submittable statuses and none of them can move to another submittable
 * one in between, so it is the status the write actually replaced. As in the
 * clarification handler, a history row that cannot be written answers 503
 * rather than reporting a change the history does not show.
 *
 * SG2-68: the people who act next are told. A request waiting for a
 * coordinator notifies every Event Coordinator Lead; a resubmission that
 * goes straight back to its coordinator notifies that coordinator. A notice
 * that cannot be stored answers 503 like the history row, with the
 * submission already made (see docs/notifications.md).
 */
export function submitEventRequestHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchOwnRequest = fetchManageableEventRequest,
  submitRequest = submitEventRequest,
  writeHistory = insertAuditLogs,
  fetchLeads = fetchLeadIds,
  notify = notifyEvent,
  now = Date.now
}: SubmitEventRequestDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId < 1) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const existing = await fetchOwnRequest(admin, eventId, principal.userId);
    if (!existing.ok) {
      if (existing.reason === 'not_found') {
        // Deliberately the same response whether the row belongs to someone
        // else or does not exist at all — see fetchManageableEventRequest.
        res.status(404).json({ error: 'No event request found for this account.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    if (!SUBMITTABLE_STATUSES.has(existing.request.status)) {
      // Criterion #3: once a request has been submitted (or is otherwise
      // beyond draft/rejected) it is not a valid submission target — this is
      // also what makes it immutable.
      res
        .status(409)
        .json({ error: 'Only a draft or rejected event request can be submitted.' });
      return;
    }

    const missing = missingForSubmission(existing.request, now());
    if (missing.length > 0) {
      // Criterion #2: refuse submission and list what is outstanding — blank
      // fields, or a date that is no longer in the future; the request stays
      // in its current status because no update is issued.
      const error = missing.length === 1 && missing[0] === PROPOSED_DATE_IN_PAST
        ? PROPOSED_DATE_IN_FUTURE_MESSAGE
        : 'Event request is missing required fields.';
      res.status(400).json({ error, missing });
      return;
    }

    const submitted = await submitRequest(admin, eventId);
    if (!submitted.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const recorded = await writeHistory(admin, [
      statusChange(eventId, principal.userId, existing.request.status, submitted.request.status)
    ]);
    if (!recorded.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const label = eventLabel(submitted.request.name);
    let notices: EventNotice[];
    if (submitted.request.status === 'unassigned') {
      const leads = await fetchLeads(admin);
      if (!leads.ok) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
      notices = leads.ids.map(id => ({
        recipient_id: id, event_id: eventId, kind: 'event_submitted', message: eventNoticeMessages.submittedToLeads(label)
      }));
    } else {
      notices = [{
        recipient_id: existing.request.coordinator_id, event_id: eventId, kind: 'event_submitted',
        message: eventNoticeMessages.resubmittedToCoordinator(label)
      }];
    }
    const notified = await notify(admin, notices.filter(notice => notice.recipient_id !== principal.userId));
    if (!notified.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    // Criterion #1: now visible to ConnectSphere for review and reflects as submitted.
    res.status(200).json({ request: submitted.request });
  };
}

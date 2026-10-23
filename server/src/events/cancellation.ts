import type { Request, RequestHandler, Response } from 'express';
import { AccessError, type Principal } from '../auth/policy';
import {
  cancelEvent,
  requestEventCancellation,
  type CancelEventResult,
  type RequestCancellationResult
} from '../db/eventCancellation';

const INVALID_REASON_MESSAGE = 'Give a reason for the cancellation, up to 500 characters.';
const NOT_FOUND_MESSAGE = 'Event not found.';
const CLOSED_MESSAGE = 'A completed or cancelled event cannot be cancelled, and a draft is deleted instead.';
const REQUESTED_MESSAGE = 'A cancellation has already been requested for this event.';
const NOT_REQUESTED_MESSAGE = 'The organiser has not asked for this event to be cancelled.';

export interface EventCancellationDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  request?: (token: string, eventId: number, reason: string) => Promise<RequestCancellationResult>;
  cancel?: (token: string, eventId: number) => Promise<CancelEventResult>;
}

/** The validated event id, or null once a 400 or 401 has been sent. */
function eventIdFrom(req: Request, res: Response, getPrincipal: EventCancellationDependencies['getPrincipal']) {
  if (!getPrincipal(req)) {
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
  return eventId;
}

function sendFailure(res: Response, error: unknown) {
  const failure = error instanceof AccessError ? error : new AccessError(503);
  res.status(failure.status).json({ error: failure.message });
}

/**
 * SG2-67: the Event Organiser asks for a cancellation with a reason, and only
 * the assigned Event Coordinator carries it out.
 *
 * POST  /api/event-requests/:eventId/cancellation-request  { reason }
 * PATCH /api/event-requests/:eventId/cancel                (no body)
 *
 * Everything that decides the outcome happens in the database under the
 * caller's JWT (request_event_cancellation and cancel_event): the acting
 * role, who created or is assigned the event, the status guards, releasing
 * venues and equipment, the history and the notices. An event the caller
 * did not create, or is not assigned, gets the same 404 as one that does not
 * exist, so nothing about it is revealed.
 */
export function createEventCancellationHandlers({
  getPrincipal,
  request = requestEventCancellation,
  cancel = cancelEvent
}: EventCancellationDependencies): { request: RequestHandler; cancel: RequestHandler } {
  return {
    request: async (req, res) => {
      const eventId = eventIdFrom(req, res, getPrincipal);
      if (eventId === null) return;
      const reason = (req.body as { reason?: unknown } | undefined)?.reason;
      if (typeof reason !== 'string') {
        res.status(400).json({ error: INVALID_REASON_MESSAGE });
        return;
      }

      let result: RequestCancellationResult;
      try {
        result = await request(req.get('authorization')!.slice(7), eventId, reason);
      } catch (error) {
        sendFailure(res, error);
        return;
      }
      switch (result.outcome) {
        case 'ok':
          res.status(201).json({
            event_id: result.event_id,
            cancellation_requested_at: result.cancellation_requested_at,
            coordinator_notified: result.coordinator_notified
          });
          return;
        case 'invalid':
          res.status(400).json({ error: INVALID_REASON_MESSAGE });
          return;
        case 'missing':
          res.status(404).json({ error: NOT_FOUND_MESSAGE });
          return;
        case 'closed':
          res.status(409).json({ error: CLOSED_MESSAGE, code: 'closed' });
          return;
        case 'requested':
          res.status(409).json({ error: REQUESTED_MESSAGE, code: 'requested' });
          return;
      }
    },

    cancel: async (req, res) => {
      const eventId = eventIdFrom(req, res, getPrincipal);
      if (eventId === null) return;

      let result: CancelEventResult;
      try {
        result = await cancel(req.get('authorization')!.slice(7), eventId);
      } catch (error) {
        sendFailure(res, error);
        return;
      }
      switch (result.outcome) {
        case 'ok':
          res.status(200).json({
            event_id: result.event_id,
            status: result.status,
            cancelled_at: result.cancelled_at,
            bookings_released: result.bookings_released,
            attendees_notified: result.attendees_notified
          });
          return;
        case 'invalid':
        case 'missing':
          res.status(404).json({ error: NOT_FOUND_MESSAGE });
          return;
        case 'closed':
          res.status(409).json({ error: CLOSED_MESSAGE, code: 'closed' });
          return;
        case 'not_requested':
          res.status(409).json({ error: NOT_REQUESTED_MESSAGE, code: 'not_requested' });
          return;
      }
    }
  };
}

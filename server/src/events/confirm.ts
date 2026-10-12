import type { Request, RequestHandler } from 'express';
import { AccessError, type Principal } from '../auth/policy';
import { confirmEvent, type ConfirmEventResult } from '../db/eventConfirmation';

const NOT_FOUND_MESSAGE = 'No event in preparation is assigned to this account.';
const CLOSED_MESSAGE = 'Only an event in Preparation can be confirmed.';
const OUTSTANDING_MESSAGE = 'Confirmation refused: arrangements are still outstanding.';

export interface ConfirmEventDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  confirm?: (token: string, eventId: number) => Promise<ConfirmEventResult>;
}

/**
 * PATCH /api/event-requests/:eventId/confirm — the assigned coordinator
 * confirms an event in Preparation once every required arrangement is in
 * place (SG2-58 AC1/AC2). No request body.
 *
 * Everything that decides the outcome happens in `public.confirm_event` under
 * the caller's JWT: the stored role, the assignment, the status guard, the
 * readiness gate and the status, audit and organiser-notification writes are
 * one transaction holding the event row lock. A coordinator who is not
 * assigned gets the same 404 as one asking about an event that does not
 * exist, so assignments cannot be probed.
 */
export function createConfirmEventHandler({
  getPrincipal,
  confirm = confirmEvent
}: ConfirmEventDependencies): RequestHandler {
  return async (req, res) => {
    if (!getPrincipal(req)) {
      // Defensive: this handler is only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const raw = req.params.eventId;
    const eventId = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }

    let result: ConfirmEventResult;
    try {
      result = await confirm(req.get('authorization')!.slice(7), eventId);
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
      return;
    }

    switch (result.outcome) {
      case 'ok':
        res.status(200).json({
          event_id: result.event_id,
          status: result.status,
          confirmed_at: result.confirmed_at,
          organiser_notified: result.organiser_notified
        });
        return;
      case 'missing':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'closed':
        res.status(409).json({ error: CLOSED_MESSAGE, code: 'closed' });
        return;
      case 'outstanding':
        res.status(409).json({ error: OUTSTANDING_MESSAGE, code: 'outstanding', outstanding: result.outstanding });
        return;
    }
  };
}

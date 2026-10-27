import type { Response } from 'express';
import { AccessError, authorization } from '../auth';
import { createMyRegistrationsStore, type WithdrawResult } from '../db/myRegistrations';
import { formatInstant } from '../events/changeImpact';

const UNAVAILABLE_MESSAGE = 'Your registrations are temporarily unavailable. Please try again.';

function send(res: Response, error: unknown) {
  const failure = error instanceof AccessError ? error : new AccessError(503);
  res.status(failure.status).json({ error: failure.status === 503 ? UNAVAILABLE_MESSAGE : failure.message });
}

/** SG2-62: the answer for each withdrawal outcome. */
function sendWithdrawal(res: Response, result: WithdrawResult) {
  switch (result.outcome) {
    case 'ok':
      res.json({ withdrawal: result.withdrawal });
      return;
    case 'missing':
      res.status(404).json({ error: 'This registration was not found.' });
      return;
    case 'withdrawn':
      res.status(409).json({ error: 'You have already withdrawn from this event.', reason: 'withdrawn' });
      return;
    case 'cancelled':
      res.status(409).json({ error: 'This event has been cancelled.', reason: 'cancelled' });
      return;
    case 'started':
      res.status(409).json({
        error: result.proposed_date
          ? `This event started ${formatInstant(result.proposed_date)}, so you can no longer withdraw.`
          : 'This event has started, so you can no longer withdraw.',
        reason: 'started', proposed_date: result.proposed_date
      });
  }
}

/**
 * GET /api/my-registrations — every registration the caller has made, with
 * the event's attendee-facing details and where each stands (SG2-62 AC1).
 * Needs 'registrations.mine.read' here and an attendee acting role in the
 * database.
 * POST /api/my-registrations/:registrationId/withdrawal — withdraws one of
 * them (AC2): 200 with the withdrawal, which gives the place back (AC3) and
 * tells the organiser and coordinator (AC5); 409 once the event has started
 * (AC4), was cancelled, or the registration was already withdrawn; 404 for
 * a registration that is not the caller's. Needs 'registrations.withdraw'.
 */
export function createMyRegistrationsRouter(access = authorization, store = createMyRegistrationsStore) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('registrations.mine.read'), async (req, res) => {
    try {
      res.json({ registrations: await store(req.get('authorization')!.slice(7)).list() });
    } catch (error) {
      send(res, error);
    }
  });
  router.post('/:registrationId/withdrawal', access.requirePermission('registrations.withdraw'), async (req, res) => {
    const raw = String(req.params.registrationId);
    const registrationId = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || registrationId > 2147483647) {
      res.status(400).json({ error: 'registrationId must be a positive integer.' });
      return;
    }
    try {
      sendWithdrawal(res, await store(req.get('authorization')!.slice(7)).withdraw(registrationId));
    } catch (error) {
      send(res, error);
    }
  });
  return router;
}

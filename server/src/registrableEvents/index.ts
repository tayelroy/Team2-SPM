import type { Request, Response } from 'express';
import { AccessError, authorization } from '../auth';
import { createRegistrableEventsStore, type RegisterResult } from '../db/registrableEvents';
import { formatInstant } from '../events/changeImpact';
import { readRegistration } from './registration';

const UNAVAILABLE_MESSAGE = 'Events are temporarily unavailable. Please try again.';
const NOT_FOUND_MESSAGE = 'This event is not open for registration.';
const INVALID_MESSAGE = 'Check your registration details.';

function send(res: Response, error: unknown) {
  const failure = error instanceof AccessError ? error : new AccessError(503);
  res.status(failure.status).json({ error: failure.status === 503 ? UNAVAILABLE_MESSAGE : failure.message });
}

/** The event id from the path, or null after answering 400. */
function eventIdOf(req: Request, res: Response): number | null {
  const raw = String(req.params.eventId);
  const eventId = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
    res.status(400).json({ error: 'eventId must be a positive integer.' });
    return null;
  }
  return eventId;
}

/** SG2-60: the answer for each registration outcome. */
function sendRegistration(res: Response, result: RegisterResult) {
  switch (result.outcome) {
    case 'ok':
      res.status(201).json({ registration: result.registration });
      return;
    case 'missing':
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    case 'invalid':
      res.status(400).json({ error: INVALID_MESSAGE });
      return;
    case 'duplicate':
      res.status(409).json({ error: 'You are already registered for this event.', reason: 'duplicate' });
      return;
    case 'full':
      res.status(409).json({ error: 'This event is full.', reason: 'full' });
      return;
    case 'not_open':
      res.status(409).json({ error: `Registration opens ${formatInstant(result.registration_opens_at)}.`,
        reason: 'not_open', registration_opens_at: result.registration_opens_at });
      return;
    case 'closed':
      res.status(409).json({ error: 'Registration for this event has closed.', reason: 'closed',
        registration_closes_at: result.registration_closes_at });
  }
}

/**
 * GET /api/registrable-events — the confirmed events an attendee can register
 * for, whose registration is open or opens later, soonest first, with name,
 * date, time and venue (SG2-59 AC1). Unconfirmed events and events without
 * registration are never returned (AC2).
 * GET /api/registrable-events/:eventId — one of those events with its
 * attendee-facing details only (AC3); any other event is 404, whether it is
 * missing or simply not listed, so an attendee cannot probe for internal ones.
 * Both need 'events.registrable.read' here and an attendee acting role in the
 * database.
 * POST /api/registrable-events/:eventId/registrations — registers the caller
 * (SG2-60): 201 with the place held (AC1), 409 for a duplicate (AC2), a
 * window that is not open, with when it opens or that it closed (AC3), or a
 * full event; 400 for missing or invalid details (AC4), checked before the
 * database is asked. Needs 'events.register' and an attendee acting role.
 */
export function createRegistrableEventsRouter(access = authorization, store = createRegistrableEventsStore) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('events.registrable.read'), async (req, res) => {
    try {
      res.json({ events: await store(req.get('authorization')!.slice(7)).list() });
    } catch (error) {
      send(res, error);
    }
  });
  router.get('/:eventId', access.requirePermission('events.registrable.read'), async (req, res) => {
    const eventId = eventIdOf(req, res);
    if (eventId === null) return;
    try {
      const event = await store(req.get('authorization')!.slice(7)).get(eventId);
      if (!event) {
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      }
      res.json({ event });
    } catch (error) {
      send(res, error);
    }
  });
  router.post('/:eventId/registrations', access.requirePermission('events.register'), async (req, res) => {
    const eventId = eventIdOf(req, res);
    if (eventId === null) return;
    const validation = readRegistration(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: INVALID_MESSAGE, errors: validation.errors });
      return;
    }
    try {
      sendRegistration(res, await store(req.get('authorization')!.slice(7)).register(eventId, validation.values));
    } catch (error) {
      send(res, error);
    }
  });
  return router;
}

import type { Response } from 'express';
import { AccessError, authorization } from '../auth';
import { createRegistrableEventsStore } from '../db/registrableEvents';

const UNAVAILABLE_MESSAGE = 'Events are temporarily unavailable. Please try again.';
const NOT_FOUND_MESSAGE = 'This event is not open for registration.';

function send(res: Response, error: unknown) {
  const failure = error instanceof AccessError ? error : new AccessError(503);
  res.status(failure.status).json({ error: failure.status === 503 ? UNAVAILABLE_MESSAGE : failure.message });
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
    const raw = req.params.eventId;
    const eventId = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }
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
  return router;
}

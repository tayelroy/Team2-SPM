import type { RequestHandler } from 'express';
import { AccessError, type createAuthorization } from '../auth';
import { createVenueHoldStore } from '../db/venueHolds';
import { parseHoldId, validateVenueHold } from './holdFields';

const FAILURES = {
  missing: { status: 404, error: 'Event, venue or tentative hold not found.' },
  invalid: { status: 400, error: 'Choose a planning event with an assigned coordinator, a valid period and a future expiry.' },
  conflict: { status: 409, error: 'This venue is already booked, held or unavailable for that period.' },
  inactive: { status: 409, error: 'This hold is no longer active. Place a new request.' },
  capacity: { status: 409, error: 'Approve a capacity exception for this booking request before converting the hold.' },
  suitability: { status: 409, error: 'Required venue facilities are missing. Choose a suitable venue.' }
} as const;

export function createVenueHoldsRouter(access: ReturnType<typeof createAuthorization>, store = createVenueHoldStore, now: () => number = Date.now) {
  const router = access.protectedRouter();
  const handle = (operation: 'list' | 'options' | 'notifications' | 'create' | 'release' | 'convert'): RequestHandler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const changing = operation === 'release' || operation === 'convert';
      const id = changing ? parseHoldId(req.params.holdId) : null;
      const values = operation === 'create' ? validateVenueHold(req.body, now()) : null;
      if ((changing && id === null) || (operation === 'create' && values === null)) {
        res.status(400).json({ error: 'Enter valid event and venue IDs, a start and end with time zones, and a mandatory future expiry.' }); return;
      }
      const database = store(req.get('authorization')!.slice(7));
      if (operation === 'list') { res.json({ holds: await database.list() }); return; }
      if (operation === 'options') { res.json(await database.options()); return; }
      if (operation === 'notifications') { res.json({ notifications: await database.notifications() }); return; }
      const result = operation === 'create' ? await database.create(values!) : await database.change(id!, operation);
      if (result.outcome === 'created' || result.outcome === 'updated') { res.status(operation === 'create' ? 201 : 200).json({ hold: result.hold }); return; }
      const failure = FAILURES[result.outcome]; res.status(failure.status).json({ error: failure.error });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
  const read = access.requirePermission('venues.holds.read'); const manage = access.requirePermission('venues.holds.manage');
  router.get('/', read, handle('list'));
  router.get('/options', manage, handle('options'));
  router.get('/notifications', read, handle('notifications'));
  router.post('/', manage, handle('create'));
  router.post('/:holdId/release', manage, handle('release'));
  router.post('/:holdId/convert', manage, handle('convert'));
  return router;
}

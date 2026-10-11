import { Router, type RequestHandler } from 'express';
import { AccessError, type createAuthorization } from '../auth';
import { createEquipmentReservationsStore, type ReservationsAction } from '../db/equipmentReservations';
import type { AvailabilityPeriod } from '../db/equipmentAvailability';

function identifier(raw: unknown, maximum: number): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}
const positiveSafe = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
function instant(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw)) return null;
  const time = Date.parse(raw);
  const day = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(time) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === raw.slice(0, 10) ? time : null;
}
const refusals = {
  missing: [404, 'Event or equipment request not found.'],
  invalid: [400, 'Choose a valid equipment request and reservation period.'],
  closed: [409, 'This event or request can no longer be reserved. Refresh before continuing.'],
  conflict: [409, 'This request changed or already has a reservation. Refresh before trying again.'],
  insufficient: [409, 'There is not enough operational equipment available for this period. Refresh availability before trying again.']
} as const;

export function createEquipmentReservationsRouter(access: ReturnType<typeof createAuthorization>, store = createEquipmentReservationsStore) {
  // These routes have two API prefixes, so scope authentication to the
  // matched endpoints instead of intercepting every request under /api.
  const router = Router();
  const handle = (action: ReservationsAction): RequestHandler => async (req, res) => {
    try {
      let eventId: number | null;
      let requestId: number | undefined;
      let version: number | undefined;
      let period: AvailabilityPeriod | undefined;
      if (action === 'read') {
        eventId = identifier(req.query.event_id, 2147483647);
        if (eventId === null || Object.keys(req.query).some(key => key !== 'event_id')) {
          res.status(400).json({ error: 'Choose a valid event.' }); return;
        }
      } else {
        const body: unknown = req.body;
        if (typeof body !== 'object' || body === null || Array.isArray(body)
            || Object.keys(body).some(key => !['event_id', 'version', 'starts_at', 'ends_at'].includes(key))) {
          res.status(400).json({ error: 'Send only the event, request version and reservation period.' }); return;
        }
        const values = body as Record<string, unknown>;
        if (!positiveSafe(values.event_id) || values.event_id > 2147483647) {
          res.status(400).json({ error: 'Choose a valid event.' }); return;
        }
        eventId = values.event_id;
        const parsedRequest = identifier(req.params.requestId, Number.MAX_SAFE_INTEGER);
        if (parsedRequest === null || !positiveSafe(values.version)) {
          res.status(400).json({ error: 'Refresh a valid equipment request before reserving.' }); return;
        }
        requestId = parsedRequest; version = values.version;
        const start = instant(values.starts_at); const end = instant(values.ends_at);
        if (start === null || end === null || end <= start) {
          res.status(400).json({ error: 'Choose a complete time period with a time zone and an end after its start.' }); return;
        }
        period = { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
      }
      const result = await store(req.get('authorization')!.slice(7)).run(action, eventId, requestId, version, period);
      if (result.outcome !== 'ok') {
        const [status, error] = refusals[result.outcome];
        res.status(status).json({ error, code: result.outcome }); return;
      }
      const { outcome, ...view } = result;
      res.status(action === 'reserve' ? 201 : 200).json(view);
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
  router.get('/equipment-reservations', access.requireAuth, access.requirePermission('equipment_requirements.read'), handle('read'));
  router.post('/equipment-requests/:requestId/reservation', access.requireAuth, access.requirePermission('equipment.reservations.manage'), handle('reserve'));
  return router;
}

import { AccessError, type createAuthorization } from '../auth';
import { createEquipmentAvailabilityStore, type AvailabilityPeriod } from '../db/equipmentAvailability';

function identifier(raw: unknown, maximum: number): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}
function instant(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw)) return null;
  const time = Date.parse(raw);
  const day = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(time) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === raw.slice(0, 10) ? time : null;
}

export function createEquipmentAvailabilityRouter(access: ReturnType<typeof createAuthorization>, store = createEquipmentAvailabilityStore) {
  const router = access.protectedRouter();
  router.get('/:requestId/availability', access.requirePermission('equipment.availability.read'), async (req, res) => {
    try {
      const eventId = identifier(req.query.event_id, 2147483647);
      const requestId = identifier(req.params.requestId, Number.MAX_SAFE_INTEGER);
      if (eventId === null || requestId === null) { res.status(400).json({ error: 'Choose a valid event and equipment request.' }); return; }
      let period: AvailabilityPeriod | undefined;
      if (req.query.starts_at !== undefined || req.query.ends_at !== undefined) {
        const start = instant(req.query.starts_at); const end = instant(req.query.ends_at);
        if (start === null || end === null || end <= start) {
          res.status(400).json({ error: 'Choose a complete time period with a time zone and an end after its start.' }); return;
        }
        period = { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
      }
      const result = await store(req.get('authorization')!.slice(7)).run(eventId, requestId, period);
      if (result.outcome === 'missing') { res.status(404).json({ error: 'Event or equipment request not found.' }); return; }
      if (result.outcome === 'invalid') { res.status(400).json({ error: 'Choose a valid equipment request and time period.' }); return; }
      const { outcome, ...view } = result;
      res.json({ ...view, status: outcome === 'ok' ? 'ready' : 'dates_required' });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  });
  return router;
}

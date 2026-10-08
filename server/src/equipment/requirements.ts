import type { RequestHandler } from 'express';
import { AccessError, type createAuthorization } from '../auth';
import { createEquipmentRequirementsStore, type ArrangementValues, type RequirementValues,
  type RequirementsAction } from '../db/equipmentRequirements';

const int32 = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
const positiveSafe = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return [...trimmed].length > 2000 ? undefined : trimmed || null;
}
export function validateRequirement(input: unknown): RequirementValues | null {
  const values = object(input);
  if (!values || !int32(values.equipment_id) || !int32(values.quantity)) return null;
  const notes = optionalText(values.notes);
  return notes === undefined ? null : { equipment_id: values.equipment_id, quantity: values.quantity, notes };
}
export function validateArrangement(input: unknown): ArrangementValues | null {
  const values = object(input);
  if (!values || !Number.isInteger(values.shortfall) || (values.shortfall as number) < 0 || (values.shortfall as number) > 2147483647) return null;
  const arrangement_notes = optionalText(values.arrangement_notes);
  const placement_position = optionalText(values.placement_position);
  const venue = values.placement_venue_id;
  const placement_venue_id = venue === undefined || venue === null || (typeof venue === 'string' && venue.trim() === '') ? null : venue;
  if (arrangement_notes === undefined || placement_position === undefined
      || (placement_venue_id !== null && !int32(placement_venue_id))
      || (placement_venue_id === null) !== (placement_position === null)) return null;
  return { arrangement_notes, shortfall: values.shortfall as number,
    placement_venue_id: placement_venue_id as number | null, placement_position };
}

const refusals = {
  missing: [404, 'Event or equipment request not found.'],
  closed: [409, 'This event or request is no longer being arranged. Refresh before continuing.'],
  conflict: [409, 'This request changed. Refresh before saving again.'],
  duplicate: [409, 'This equipment already has a pending request for the event.'],
  invalid: [400, 'Check the equipment, quantity, shortfall and placement values.']
} as const;

export function createEquipmentRequirementsRouter(access: ReturnType<typeof createAuthorization>, store = createEquipmentRequirementsStore) {
  const router = access.protectedRouter();
  const handle = (action: RequirementsAction): RequestHandler => async (req, res) => {
    try {
      const body = object(req.body);
      const rawEvent = action === 'read' ? req.query.event_id : body?.event_id;
      const eventId = action === 'read' && typeof rawEvent === 'string' && /^[1-9]\d*$/.test(rawEvent) ? Number(rawEvent) : rawEvent;
      if (!int32(eventId)) { res.status(400).json({ error: 'Choose a valid event.' }); return; }
      const updating = action === 'amend' || action === 'arrange';
      let requestId: number | undefined;
      let version: number | undefined;
      if (updating) {
        requestId = /^[1-9]\d*$/.test(req.params.requestId) ? Number(req.params.requestId) : NaN;
        if (!positiveSafe(requestId) || !positiveSafe(body!.version)) {
          res.status(400).json({ error: 'Refresh a valid equipment request before saving.' }); return;
        }
        version = body!.version as number;
      }
      const values = action === 'read' ? undefined : action === 'arrange' ? validateArrangement(body) : validateRequirement(body);
      if (values === null) { res.status(400).json({ error: 'Enter a positive whole quantity, valid equipment and complete placement details when recording a location. Notes and positions must be at most 2000 characters.' }); return; }
      const result = await store(req.get('authorization')!.slice(7)).run(action, eventId, requestId, version, values);
      if (result.outcome !== 'ok') {
        const [status, error] = refusals[result.outcome];
        res.status(status).json({ error }); return;
      }
      const { outcome, ...view } = result;
      res.status(action === 'create' ? 201 : 200).json(view);
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
  router.get('/', access.requirePermission('equipment_requirements.read'), handle('read'));
  router.post('/', access.requirePermission('equipment_requirements.request'), handle('create'));
  router.patch('/:requestId', access.requirePermission('equipment_requirements.request'), handle('amend'));
  router.patch('/:requestId/arrangement', access.requirePermission('equipment_requirements.arrange'), handle('arrange'));
  return router;
}

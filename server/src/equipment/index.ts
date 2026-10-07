import type { RequestHandler } from 'express';
import { AccessError, type createAuthorization } from '../auth';
import { createEquipmentStore } from '../db/equipment';
import { validateEquipment } from './fields';

export function createEquipmentRouter(access: ReturnType<typeof createAuthorization>, store = createEquipmentStore) {
  const router = access.protectedRouter();
  const handle = (operation: 'list' | 'create' | 'update'): RequestHandler => async (req, res) => {
    try {
      if (operation === 'update' && (!/^[1-9]\d*$/.test(req.params.equipmentId)
          || Number(req.params.equipmentId) > 2147483647)) {
        res.status(400).json({ error: 'Invalid equipment ID.' });
        return;
      }
      const values = operation === 'list' ? null : validateEquipment(req.body);
      if (operation !== 'list' && !values) {
        res.status(400).json({ error: 'Complete every equipment field, keep type within 255 characters and description and location within 2000 characters, enter a non-negative whole-number quantity, and choose an operational status.' });
        return;
      }
      if (operation === 'update' && (!Number.isSafeInteger(req.body.version) || req.body.version < 1)) {
        res.status(400).json({ error: 'Refresh the equipment record before saving.' });
        return;
      }
      const database = store(req.get('authorization')!.slice(7));
      if (operation === 'list') {
        res.json({ equipment: await database.list() });
        return;
      }
      const equipment = operation === 'create' ? await database.create(values!)
        : await database.update(Number(req.params.equipmentId), req.body.version, values!);
      if (!equipment) {
        res.status(operation === 'update' ? 409 : 503).json({ error: operation === 'update'
          ? 'Equipment has changed or is no longer editable. Refresh the record before saving again.'
          : 'Equipment could not be saved.' });
        return;
      }
      res.status(operation === 'create' ? 201 : 200).json({ equipment });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
  router.get('/', access.requirePermission('equipment.read'), handle('list'));
  router.post('/', access.requirePermission('equipment.create'), handle('create'));
  router.patch('/:equipmentId', access.requirePermission('equipment.update'), handle('update'));
  return router;
}

import type { RequestHandler } from 'express';
import { type createAuthorization, AccessError } from '../auth';
import { createVenueBlockStore } from '../db/venueBlocks';
import { MAX_REASON_LENGTH, validateVenueBlock } from './blockFields';

function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > Number.MAX_SAFE_INTEGER) return null;
  return Number(raw);
}

function parseVenueId(raw: string): number | null {
  const id = parseId(raw);
  return id !== null && id <= 2147483647 ? id : null;
}

/**
 * Router for blocking a venue from use (SG2-45). Blocks are rows in
 * venue_unavailability, so they appear on the SG2-44 availability calendar as
 * soon as they are created. Mounted alongside the other venue routers at
 * /api/venues; the route pattern (/:venueId/blocks) does not overlap them.
 */
export function createVenueBlocksRouter(
  access: ReturnType<typeof createAuthorization>,
  store = createVenueBlockStore,
  now: () => number = Date.now
) {
  const router = access.protectedRouter();

  const handle = (operation: 'list' | 'create' | 'remove'): RequestHandler => async (req, res) => {
    try {
      const venueId = parseVenueId(req.params.venueId);
      const blockId = operation === 'remove' ? parseId(req.params.blockId) : null;
      if (venueId === null || (operation === 'remove' && blockId === null)) {
        res.status(400).json({ error: venueId === null ? 'Invalid venue ID.' : 'Invalid block ID.' });
        return;
      }
      const values = operation === 'create' ? validateVenueBlock(req.body, now()) : null;
      if (operation === 'create' && !values) {
        res.status(400).json({
          error: `Enter a start and an end, with the end after the start and not in the past, and a reason within ${MAX_REASON_LENGTH} characters.`
        });
        return;
      }
      // requireAuth has already verified the single, well-formed bearer header.
      const database = store(req.get('authorization')!.slice(7));
      if (operation === 'list') {
        res.json({ blocks: await database.list(venueId, new Date(now()).toISOString()) });
        return;
      }
      if (operation === 'remove') {
        if (!(await database.remove(venueId, blockId!))) {
          res.status(404).json({ error: 'Block not found.' });
          return;
        }
        res.status(204).end();
        return;
      }
      const result = await database.create(venueId, values!);
      if (result.outcome === 'missing') {
        res.status(404).json({ error: 'Venue not found.' });
        return;
      }
      if (result.outcome === 'conflict') {
        res.status(409).json({ error: 'This period already holds a confirmed booking.', booking: result.booking });
        return;
      }
      res.status(201).json({ block: result.block });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };

  const manage = access.requirePermission('venues.blocks.manage');
  router.get('/:venueId/blocks', manage, handle('list'));
  router.post('/:venueId/blocks', manage, handle('create'));
  router.delete('/:venueId/blocks/:blockId', manage, handle('remove'));
  return router;
}

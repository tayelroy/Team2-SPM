import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import type { Principal } from '../auth/policy';
import {
  confirmSafetyRereview,
  listSafetyRereviewQueue,
  type ConfirmSafetyRereviewResult,
  type ListSafetyRereviewQueueResult,
  type SafetyRereviewArrangement
} from '../db/safetyRereviews';

const UNAVAILABLE_MESSAGE = 'Safety checks are temporarily unavailable. Please try again later.';
const NOT_FOUND_MESSAGE = 'That safety re-review was not found.';
const CLOSED_MESSAGE = 'This booking or equipment request has already been dealt with.';

/** Which flags each staff role works through (SG2-93 AC2). */
const ARRANGEMENT_BY_ROLE: Partial<Record<Principal['role'], SafetyRereviewArrangement>> = {
  venue_staff: 'venue',
  technical_support_staff: 'equipment'
};

export interface SafetyRereviewDependencies {
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  listQueue?: (admin: SupabaseClient, arrangement: SafetyRereviewArrangement) => Promise<ListSafetyRereviewQueueResult>;
  confirm?: (admin: SupabaseClient, reviewId: number, actorId: string, actingRole: string) => Promise<ConfirmSafetyRereviewResult>;
}

/**
 * SG2-93 AC2/AC4 routes for Venue Staff and Technical Support, behind
 * requireAuth and the 'safety_rereviews.*' permissions:
 * - GET  /api/safety-rereviews — the open flags of the acting role's kind
 *   (venue for Venue Staff, equipment for Technical Support), oldest first;
 * - POST /api/safety-rereviews/:reviewId/confirm — confirms one again. The
 *   last flag of its kind settles the change, and the event returns to
 *   Awaiting Safety Check once nothing is outstanding.
 */
export function createSafetyRereviewHandlers({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  listQueue = listSafetyRereviewQueue,
  confirm = confirmSafetyRereview
}: SafetyRereviewDependencies): { queue: RequestHandler; confirm: RequestHandler } {
  const queue: RequestHandler = async (req, res) => {
    const principal = getPrincipal(req);
    const arrangement = principal ? ARRANGEMENT_BY_ROLE[principal.role] : undefined;
    if (!arrangement) {
      // Defensive: the route permission admits only the two staff roles.
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const admin = getAdminClient();
    const listed = admin ? await listQueue(admin, arrangement) : { ok: false as const };
    if (!listed.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.status(200).json({ arrangement, rereviews: listed.items });
  };

  const confirmOne: RequestHandler = async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const raw = req.params.reviewId;
    const reviewId = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(reviewId)) {
      res.status(400).json({ error: 'reviewId must be a positive integer.' });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const result = await confirm(admin, reviewId, principal.userId, principal.role);
    switch (result.outcome) {
      case 'ok':
        res.status(200).json({
          review_id: result.review_id,
          event_id: result.event_id,
          status: result.status,
          outstanding_arrangements: result.outstanding_arrangements
        });
        return;
      case 'closed':
        res.status(409).json({ error: CLOSED_MESSAGE, resolution: result.resolution });
        return;
      case 'missing':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'forbidden':
        // Another kind of flag, or the role was revoked since sign-in.
        res.status(403).json({ error: 'Access denied' });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  };

  return { queue, confirm: confirmOne };
}

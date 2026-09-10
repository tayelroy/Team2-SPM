import { Response, Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { authorization as defaultAuthorization, createAuthorization } from '../auth';
import {
  createEventRequestDraft,
  getEventRequestForOrganiser,
  submitEventRequest,
  updateEventRequestDraft
} from './service';

type Authorization = ReturnType<typeof createAuthorization>;
type AccessDependencies = Pick<Authorization, 'protectedRouter' | 'requirePermission' | 'getPrincipal'>;

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';
const NOT_FOUND_MESSAGE = 'Event request not found.';

/** Routes for SG2-30: create, view, edit and submit an organiser's own event requests. */
export function createEventRequestsRouter(
  access: AccessDependencies = defaultAuthorization,
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient
): Router {
  const router = access.protectedRouter();

  function adminOrUnavailable(res: Response): SupabaseClient | null {
    const client = getAdminClient();
    if (!client) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    return client;
  }

  router.post('/', access.requirePermission('event_requests.create'), async (req, res) => {
    const client = adminOrUnavailable(res);
    if (!client) return;
    const principal = access.getPrincipal(req)!;
    const result = await createEventRequestDraft(client, principal.userId, req.body ?? {});
    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.status(201).json(result.request);
  });

  router.get('/:id', access.requirePermission('event_requests.view'), async (req, res) => {
    const client = adminOrUnavailable(res);
    if (!client) return;
    const principal = access.getPrincipal(req)!;
    const result = await getEventRequestForOrganiser(client, principal.userId, req.params.id);
    if (result.outcome === 'found') {
      res.status(200).json(result.request);
      return;
    }
    if (result.outcome === 'not_found') {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }
    res.status(503).json({ error: UNAVAILABLE_MESSAGE });
  });

  router.patch('/:id', access.requirePermission('event_requests.update'), async (req, res) => {
    const client = adminOrUnavailable(res);
    if (!client) return;
    const principal = access.getPrincipal(req)!;
    const result = await updateEventRequestDraft(client, principal.userId, req.params.id, req.body ?? {});
    switch (result.outcome) {
      case 'updated':
        res.status(200).json(result.request);
        return;
      case 'not_found':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'locked':
        // SG2-30 AC3: a submitted request cannot be edited directly.
        res.status(409).json({
          error: 'This event request has already been submitted and can no longer be edited.'
        });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  });

  router.post('/:id/submit', access.requirePermission('event_requests.submit'), async (req, res) => {
    const client = adminOrUnavailable(res);
    if (!client) return;
    const principal = access.getPrincipal(req)!;
    const result = await submitEventRequest(client, principal.userId, req.params.id);
    switch (result.outcome) {
      case 'submitted':
        res.status(200).json(result.request);
        return;
      case 'invalid':
        // SG2-30 AC2: refuse and list every outstanding mandatory field.
        res.status(400).json({
          error: 'This event request is missing mandatory information.',
          missingFields: result.missingFields
        });
        return;
      case 'not_found':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'already_submitted':
        res.status(409).json({ error: 'This event request has already been submitted.' });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  });

  return router;
}

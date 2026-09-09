import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient, getSupabaseClient } from '../db';
import { readBearerToken, verifyCaller } from './session';

export function createMeHandler(
  getClient: () => SupabaseClient | null = getSupabaseClient,
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient
): RequestHandler {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const token = readBearerToken(req.header('authorization'));
    if (!token) {
      res.status(401).json({ error: 'Missing or malformed Authorization header.' });
      return;
    }

    const client = getClient();
    const admin = getAdminClient();
    if (!client || !admin) {
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
      return;
    }

    const verified = await verifyCaller(client, admin, token);
    if (!verified.ok) {
      const status = verified.reason === 'invalid_token' ? 401 : 403;
      res.status(status).json({ error: 'Not signed in.' });
      return;
    }

    res.status(200).json({ user: verified.caller });
  };
}

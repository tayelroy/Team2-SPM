// Local-only test composition; never imported by production. Real app routes,
// permission policy, draft handler and UI; isolated identity/storage adapters.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/src/app';
import { createAuthorization, AccessError } from '../server/src/auth/index';
import { createEventDraftHandler } from '../server/src/events/createDraft';
import type { Role } from '../server/src/auth/policy';
import type { SupabaseClient } from '@supabase/supabase-js';

if (process.env.NODE_ENV !== 'test') throw new Error('Authorization fixture requires NODE_ENV=test');
let organiserRole: Role = 'event_organiser';
let expired = false;
let writes: unknown[] = [];
const access = createAuthorization({ resolvePrincipal: async token => {
  if (expired) throw new AccessError(401);
  if (token === 'test-organiser') return { userId: 'organiser-1', role: organiserRole };
  if (token === 'test-attendee') return { userId: 'attendee-1', role: 'attendee' };
  if (token === 'test-coordinator') return { userId: 'coordinator-1', role: 'event_coordinator' };
  throw new AccessError(401);
} });
const draft = createEventDraftHandler({
  getPrincipal: access.getPrincipal,
  getAdminClient: () => ({} as SupabaseClient),
  lookupOrganisation: async () => ({ ok: true, organisation: 'Test Organisation' }),
  insertDraft: async (_client, input) => {
    writes.push(input);
    return { ok: true, request: { event_id: writes.length, organiser_id: input.organiserId,
      organisation: input.organisation, status: 'Draft', ...input.values } };
  }
});
const app = createApp(undefined, access, draft, undefined, (_req, res) => { expired = true; res.sendStatus(204); });
app.post('/__test/reset', (_req, res) => { organiserRole = 'event_organiser'; expired = false; writes = []; res.sendStatus(204); });
app.post('/__test/downgrade', (_req, res) => { organiserRole = 'attendee'; res.sendStatus(204); });
app.post('/__test/expire', (_req, res) => { expired = true; res.sendStatus(204); });
app.get('/__test/writes', (_req, res) => { res.json(writes); });
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../client', import.meta.url)),
  plugins: [react()], server: { middlewareMode: true } });
app.use(vite.middlewares);
app.listen(4176, '127.0.0.1');

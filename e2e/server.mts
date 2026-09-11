// Test-only composition: real routes/permissions, isolated identity and storage.
// This entry point is never imported by either production application.
import express from 'express';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createAuthorization, AccessError } from '../server/src/auth/index';
import { createVenuesRouter } from '../server/src/venues/index';
import type { VenueStore } from '../server/src/db/venues';
import type { VenueRecord } from '../server/src/venues/fields';

if (process.env.NODE_ENV !== 'test') throw new Error('Venue fixture requires NODE_ENV=test');

const seed: VenueRecord = {
  venue_id: 1, name: 'Atrium Hall', location: 'North wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Lift', operating_information: '09:00–18:00'
};
let rows = [{ ...seed }];
let nextId = 2;
const store: VenueStore = {
  list: async () => rows,
  save: async (values, id) => {
    const index = rows.findIndex(row => row.venue_id === id);
    if (id !== undefined && index < 0) return null;
    const venue = { ...values, venue_id: id ?? nextId++ };
    if (index < 0) rows.push(venue); else rows[index] = venue;
    return venue;
  }
};
const access = createAuthorization({ resolvePrincipal: async token => {
  if (token === 'test-staff') return { userId: 'test-staff', role: 'venue_staff' };
  if (token === 'test-coordinator') return { userId: 'test-coordinator', role: 'event_coordinator' };
  throw new AccessError(401);
} });
const app = express();
app.use(express.json());
app.post('/__test/reset', (_req, res) => {
  rows = [{ ...seed }];
  nextId = 2;
  res.sendStatus(204);
});
app.use('/api/auth', access.router);
app.use('/api/venues', createVenuesRouter(access, () => store));
const vite = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('./fixture', import.meta.url)),
  plugins: [react()],
  server: { middlewareMode: true, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } }
});
app.use(vite.middlewares);
app.listen(4175, '127.0.0.1');

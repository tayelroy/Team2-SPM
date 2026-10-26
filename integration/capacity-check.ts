/** SG2-96 NFR and capacity check: times the common actions through the real
 * Express app, production DB adapters and PostgREST over a DISPOSABLE local
 * PostgreSQL loaded with integration/capacity-seed.sql. Identity is a synthetic
 * token map, as in api.test.ts; authorisation and role reads are real.
 *
 *   CAPACITY_REST_URL=http://127.0.0.1:<port> CAPACITY_JWT_SECRET=<PostgREST secret> \
 *     npx --workspace server tsx ../integration/capacity-check.ts [--samples 30] [--users 50,200] [--seconds 20] [--think 0]
 *
 * It refuses any database address other than loopback. Results go to stdout as
 * JSON; docs/nfr-capacity-review.md records a run. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../server/src/app';
import { createAuthorization, AccessError, type Role } from '../server/src/auth';
import { getHeldRoles } from '../server/src/db/accountRoles';
import { dbConfig } from '../server/src/db/config';

const rest = new URL(process.env.CAPACITY_REST_URL ?? '');
assert.equal(rest.hostname, '127.0.0.1', 'The capacity check only runs against a loopback PostgREST.');
const secret = process.env.CAPACITY_JWT_SECRET ?? '';
assert.ok(secret.length >= 32, 'Set CAPACITY_JWT_SECRET to the local PostgREST secret.');
const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const userCounts = arg('users', '50,200').split(',').map(Number);
const seconds = Number(arg('seconds', '20'));
const samples = Number(arg('samples', '30'));
const think = Number(arg('think', '0'));

const jwt = (role: string, sub?: string) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, ...(sub ? { sub } : {}), exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const gateway = 'https://capacity.supabase.test';
const serviceKey = jwt('service_role');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const original = new Request(input, init);
  const url = new URL(original.url);
  if (url.hostname.endsWith('.supabase.test')) {
    url.pathname = url.pathname.slice('/rest/v1'.length);
    url.protocol = rest.protocol;
    url.host = rest.host;
    return originalFetch(new Request(url, original));
  }
  assert.equal(url.hostname, '127.0.0.1', 'Only loopback traffic is allowed.');
  return originalFetch(original);
};
Object.assign(dbConfig, { supabaseUrl: gateway, supabaseAnonKey: jwt('anon'), supabaseServiceRoleKey: serviceKey });
const admin = createClient(gateway, serviceKey, { auth: { persistSession: false } });

async function one<T>(query: PromiseLike<{ data: T | null; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await query;
  assert.equal(error, null, `${what}: ${JSON.stringify(error)}`);
  assert.ok(data, `${what}: no row`);
  return data;
}

async function main() {
  // Actors and the records each action reads, taken from the seeded data.
  const firstOf = async (role: string) => (await one(admin.from('account_roles').select('user_id').eq('role', role).limit(1).single(), role) as { user_id: string }).user_id;
  const confirmed = await one(admin.from('events').select('event_id, organiser_id, coordinator_id')
    .eq('status', 'confirmed').gt('proposed_date', new Date().toISOString()).order('proposed_date').limit(1).single(), 'confirmed event') as
    { event_id: number; organiser_id: string; coordinator_id: string };
  const equipmentRequest = await one(admin.from('equipment_requests').select('request_id').eq('event_id', confirmed.event_id).limit(1).single(), 'equipment request') as { request_id: number };
  const venue = await one(admin.from('venues').select('venue_id').limit(1).single(), 'venue') as { venue_id: number };
  const ids = {
    organiser: confirmed.organiser_id,
    coordinator: confirmed.coordinator_id,
    venue: await firstOf('venue_staff'),
    support: await firstOf('technical_support_staff'),
    lead: await firstOf('event_coordinator_lead'),
    safety: await firstOf('safety_officer'),
    attendee: await firstOf('attendee'),
  };
  type Actor = keyof typeof ids;
  const tokens = Object.fromEntries(Object.entries(ids).map(([who, id]) => [who, jwt('authenticated', id)])) as Record<Actor, string>;
  const access = createAuthorization({ resolvePrincipal: async token => {
    const who = (Object.keys(tokens) as Actor[]).find(name => tokens[name] === token);
    if (!who) throw new AccessError(401);
    const held = await getHeldRoles(admin, ids[who]);
    if (!held.ok) throw new AccessError(403);
    return { userId: ids[who], roles: held.roles as Role[] };
  } });
  const server = createApp(undefined, access).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const month = new Date();
  const from = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).toISOString();
  const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)).toISOString();
  const day = new Date(Date.now() + 40 * 86_400_000);
  const slot = { from: new Date(day.setUTCHours(1, 0, 0, 0)).toISOString(), to: new Date(day.setUTCHours(9, 0, 0, 0)).toISOString() };
  const registrable = await fetch(`${base}/api/registrable-events`, { headers: { Authorization: `Bearer ${tokens.attendee}` } });
  const registrableBody = await registrable.json() as { events?: Array<{ event_id: number }> };
  const openEvent = registrableBody.events?.[0]?.event_id;

  type Action = { name: string; brief: string; who: Actor; method?: string; path: string; body?: unknown };
  const e = confirmed.event_id;
  const actions: Action[] = [
    { name: 'Event stage (coordinator)', brief: 'viewing an event', who: 'coordinator', path: `/api/event-requests/${e}/stage` },
    { name: 'Event confirmation (coordinator)', brief: 'viewing an event', who: 'coordinator', path: `/api/event-requests/${e}/confirmation` },
    { name: 'View own event (organiser)', brief: 'viewing an event', who: 'organiser', path: `/api/event-requests/${e}` },
    { name: 'Event arrangements', brief: 'viewing an event', who: 'coordinator', path: `/api/event-requests/${e}/arrangements` },
    { name: 'Event history', brief: 'auditability', who: 'coordinator', path: `/api/event-requests/${e}/history` },
    { name: 'My events list (organiser)', brief: 'viewing an event', who: 'organiser', path: '/api/event-requests' },
    { name: 'Search available venues', brief: 'searching available venues', who: 'coordinator',
      path: `/api/venues/search?attendance=100&layout=classroom&from=${encodeURIComponent(slot.from)}&to=${encodeURIComponent(slot.to)}` },
    { name: 'Venue calendar, all venues, one month', brief: 'opening a venue calendar', who: 'venue',
      path: `/api/venues/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` },
    { name: 'Venue calendar, one venue, one month', brief: 'opening a venue calendar', who: 'venue',
      path: `/api/venues/${venue.venue_id}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` },
    { name: 'Check equipment availability', brief: 'checking equipment availability', who: 'support',
      path: `/api/equipment-requests/${equipmentRequest.request_id}/availability?event_id=${e}` },
    { name: 'Events open for registration (attendee)', brief: 'registration (submitting is SG2-60, not built)', who: 'attendee', path: '/api/registrable-events' },
    ...(openEvent ? [{ name: 'One open event (attendee)', brief: 'registration (submitting is SG2-60, not built)', who: 'attendee' as const, path: `/api/registrable-events/${openEvent}` }] : []),
    { name: 'Event search', brief: 'search and filtering', who: 'coordinator', path: '/api/event-search?q=Conference' },
    { name: 'Work queue (venue staff)', brief: 'internal queues', who: 'venue', path: '/api/work-queue' },
    { name: 'Unassigned queue (Lead)', brief: 'internal queues', who: 'lead', path: '/api/assignment-queue' },
    { name: 'Coordinator oversight (Lead)', brief: 'internal queues', who: 'lead', path: '/api/coordinator-overview' },
    { name: 'Safety check queue', brief: 'internal queues', who: 'safety', path: '/api/safety-checks' },
    { name: 'Notification inbox', brief: 'notifications', who: 'coordinator', path: '/api/notifications/inbox' },
    { name: 'Raise an event request (write)', brief: 'submitting a request', who: 'organiser', method: 'POST', path: '/api/event-requests',
      body: { name: 'Capacity check request', purpose: 'Load', description: 'Load', proposed_date: slot.from, expected_attendance: 50,
        venue_requirements: 'Seating', equipment_requirements: 'Projector', registration_needed: false, preferred_layout: 'Classroom',
        accessibility_needs: 'None', category: 'workshop' } },
  ];

  const call = async (action: Action) => {
    const started = performance.now();
    const response = await fetch(`${base}${action.path}`, {
      method: action.method ?? 'GET',
      headers: { Authorization: `Bearer ${tokens[action.who]}`, ...(action.body ? { 'Content-Type': 'application/json' } : {}) },
      body: action.body ? JSON.stringify(action.body) : undefined,
    });
    const text = await response.text();
    if (response.status >= 300 && process.env.CAPACITY_DEBUG) console.error(action.name, response.status, text.slice(0, 300));
    return { ms: performance.now() - started, status: response.status };
  };
  const pct = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
  };

  // 1. Single user: each action on its own.
  const single = [];
  for (const action of samples > 0 ? actions : []) {
    for (let i = 0; i < 3; i++) await call(action);
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const { ms, status } = await call(action);
      assert.ok(status < 300, `${action.name}: HTTP ${status}`);
      times.push(ms);
    }
    single.push({ action: action.name, brief: action.brief, p50: pct(times, 50), p95: pct(times, 95), max: Math.round(Math.max(...times)) });
  }

  // 2. Concurrent users repeating the mixed actions. With --think 0 each user
  // fires back to back (a stress test); otherwise each waits a random 0–2× the
  // given milliseconds between actions, like a person reading the page.
  const load = [];
  for (const users of userCounts) {
    const times = new Map<string, number[]>();
    let errors = 0;
    let done = 0;
    const until = performance.now() + seconds * 1000;
    await Promise.all(Array.from({ length: users }, async (_, user) => {
      if (think) await new Promise(resolve => setTimeout(resolve, Math.random() * think));
      for (let i = user; performance.now() < until; i++) {
        const action = actions[i % actions.length];
        const { ms, status } = await call(action);
        if (status >= 300) errors++;
        done++;
        times.set(action.name, [...(times.get(action.name) ?? []), ms]);
        if (think) await new Promise(resolve => setTimeout(resolve, Math.random() * 2 * think));
      }
    }));
    const all = [...times.values()].flat();
    const slowest = [...times.entries()].map(([name, list]) => ({ name, p95: pct(list, 95) })).sort((a, b) => b.p95 - a.p95).slice(0, 3);
    load.push({ users, thinkMs: think, seconds, requests: done, perSecond: Math.round(done / seconds), errors, p50: pct(all, 50), p95: pct(all, 95), slowest });
  }
  server.close();
  console.log(JSON.stringify({ single, load }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });

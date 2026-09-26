import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError, type Role } from '../../server/src/auth/policy';

// Synthetic fixtures only. This adapter deliberately does not emulate Postgres
// constraints or RLS: the independent database-policy CI job owns that evidence.
export const TEST_PASSWORD = 'Regression123!';
export const accounts = [
  { key: 'organiser', email: 'organiser@example.test', role: 'event_organiser' },
  { key: 'organiser2', email: 'organiser2@example.test', role: 'event_organiser' },
  { key: 'colleague', email: 'colleague@example.test', role: 'event_organiser' },
  { key: 'unassigned', email: 'unassigned@example.test', role: 'event_organiser' },
  { key: 'coordinator', email: 'coordinator@example.test', role: 'event_coordinator' },
  { key: 'venue', email: 'venue@example.test', role: 'venue_staff' },
  { key: 'support', email: 'support@example.test', role: 'technical_support_staff' },
  { key: 'attendee', email: 'attendee@example.test', role: 'attendee' }
] as const;

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: null; status: number };

/** A small stateful adapter at the external database boundary. Unsupported
 * query operations fail rather than silently ignoring query constraints. */
export class MemoryDatabase {
  tables: Record<string, Row[]> = {};
  sessions = new Map<string, string>();
  private sessionSequence = 0;

  constructor() { this.reset(); }

  reset() {
    this.sessions.clear();
    this.sessionSequence = 0;
    const draft = {
      name: 'Planning workshop', purpose: 'Team planning', description: 'A planning workshop.',
      proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 20,
      venue_requirements: 'A room with seating', accessibility_needs: null,
      equipment_requirements: 'Projector', registration_needed: false,
      organisation: 'Regression Organisation', status: 'draft', coordinator_id: null
    };
    const venue = {
      venue_id: 1, name: 'Regression Hall', location: 'Level 1', capacity: 100,
      facilities: 'Projector and seating', accessibility_features: 'Step-free access',
      operating_information: '08:00–22:00'
    };
    this.tables = {
      users: accounts.map(account => ({
        user_id: `user-${account.key}`, name: `Regression ${account.key}`,
        organisation: account.key === 'unassigned' ? null : account.key === 'organiser2' ? 'Other Organisation' : 'Regression Organisation',
        phone: '+6581234567', communication_preferences: ['email'], department: 'Operations'
      })),
      account_roles: accounts.map(account => ({ user_id: `user-${account.key}`, role: account.role })),
      venue_booking_requests: [],
      equipment_requests: [],
      equipment: [{ equipment_id: 1, name: 'Wireless microphones', quantity_total: 20 }],
      events: [
        { ...draft, event_id: 1, organiser_id: 'user-organiser' },
        { ...draft, event_id: 2, organiser_id: 'user-organiser2', name: 'Other organisation draft', organisation: 'Other Organisation' }
      ],
      venues: [venue, { ...venue, venue_id: 2, name: 'Quiet Room', capacity: 20 }],
      venue_bookings: [
        { booking_id: 1, venue_id: 1, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z', status: 'confirmed', event_id: 1 },
        { booking_id: 2, venue_id: 1, starts_at: '2026-09-15T02:00:00.000Z', ends_at: '2026-09-15T04:00:00.000Z', status: 'confirmed', event_id: 1 }
      ],
      venue_unavailability: [
        { unavailability_id: 1, venue_id: 1, starts_at: '2030-06-16T02:00:00.000Z', ends_at: '2030-06-16T04:00:00.000Z', reason: 'Scheduled maintenance' }
      ],
      venue_layouts: []
    };
  }

  seedWorkQueue() {
    const base = this.tables.events[0];
    this.tables.events.push(
      { ...base, event_id: 41, name: 'Sustainability Leadership Forum', status: 'submitted', purpose: 'Bring partners together to plan sustainable events', description: 'Keynotes, workshops and an evening reception.', expected_attendance: 80 },
      { ...base, event_id: 42, name: 'Partner Innovation Summit', status: 'planning', coordinator_id: 'user-coordinator' },
      { ...base, event_id: 43, name: 'Another coordinator’s event', status: 'under_review', coordinator_id: 'user-another' },
      { ...base, event_id: 44, name: 'Completed event', status: 'completed', coordinator_id: 'user-coordinator' },
    );
    const request = { request_id: 11, event_id: 41, starts_at: '2030-06-15T02:00:00Z', ends_at: '2030-06-15T10:00:00Z', status: 'pending', notes: 'Set up before guests arrive.' };
    this.tables.venue_booking_requests.push({ ...request, venue_id: 1 }, { ...request, request_id: 12, venue_id: 2, status: 'approved' });
    this.tables.equipment_requests.push({ ...request, equipment_id: 1, quantity: 4 }, { ...request, request_id: 12, equipment_id: 1, quantity: 1, status: 'rejected' });
  }

  /** SG2-35: a submitted request already assigned to the signed-in coordinator.
   * Seeded separately from seedWorkQueue so its queue counts stay unchanged. */
  seedAssignedReview() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 51, name: 'Assigned Review Forum', status: 'submitted',
      coordinator_id: 'user-coordinator', purpose: 'Decide whether the forum proceeds',
    });
  }

  /** Test equivalent of the SQL view; SQL policy tests exercise the real view. */
  private workItems(): Row[] {
    const active = this.tables.events.filter(event => ['submitted', 'under_review', 'approved', 'planning', 'confirmed'].includes(String(event.status)));
    const items = active.filter(event => ['submitted', 'under_review'].includes(String(event.status)) || event.coordinator_id !== null).map(event => ({
      kind: 'event', item_id: event.event_id, event_id: event.event_id, title: event.name || 'Untitled event', event_name: event.name || 'Untitled event',
      status: event.status, starts_at: event.proposed_date, ends_at: null, audience: 'event_coordinator', assigned_to: event.coordinator_id,
      category: ['submitted', 'under_review'].includes(String(event.status)) ? 'review' : 'assigned',
      details: Object.fromEntries(['organisation', 'purpose', 'description', 'expected_attendance', 'venue_requirements', 'accessibility_needs', 'equipment_requirements', 'registration_needed'].map(key => [key, event[key]])),
    } as Row));
    for (const [table, kind, resourceTable, resourceKey, audience] of [
      ['venue_booking_requests', 'venue', 'venues', 'venue_id', 'venue_staff'],
      ['equipment_requests', 'equipment', 'equipment', 'equipment_id', 'technical_support_staff'],
    ]) {
      for (const request of this.tables[table]) {
        const event = active.find(event => event.event_id === request.event_id);
        if (request.status !== 'pending' || !event) continue;
        const resource = this.tables[resourceTable].find(resource => resource[resourceKey] === request[resourceKey])!;
        items.push({ kind, item_id: request.request_id, event_id: event.event_id, title: resource.name,
          event_name: event.name || 'Untitled event', status: request.status, starts_at: request.starts_at, ends_at: request.ends_at,
          audience, assigned_to: null, category: kind, details: kind === 'venue'
            ? { location: resource.location, capacity: resource.capacity, expected_attendance: event.expected_attendance, venue_requirements: event.venue_requirements, accessibility_needs: event.accessibility_needs, notes: request.notes }
            : { quantity: request.quantity, equipment_requirements: event.equipment_requirements, notes: request.notes } });
      }
    }
    return items;
  }

  async principal(token: string) {
    const userId = this.sessions.get(token);
    if (!userId) throw new AccessError(401);
    const role = this.tables.account_roles.find(row => row.user_id === userId)?.role as Role | undefined;
    if (!role) throw new AccessError(403);
    return { userId, role };
  }

  readonly client = {
    from: (table: string) => {
      if (table === 'internal_work_items') this.tables[table] = this.workItems();
      if (!(table in this.tables)) throw new Error(`Unsupported fixture table: ${table}`);
      return new MemoryQuery(this, table);
    },
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const account = accounts.find(account => account.email === email && password === TEST_PASSWORD);
        if (!account) return { data: null, error: { message: 'Invalid credentials' } };
        const token = `regression-${account.key}-${++this.sessionSequence}`;
        this.sessions.set(token, `user-${account.key}`);
        return { data: { session: { access_token: token }, user: { id: `user-${account.key}`, email } }, error: null };
      },
      admin: {
        signOut: async (token: string) => {
          this.sessions.delete(token);
          return { error: null };
        }
      }
    }
  } as unknown as SupabaseClient;
}

class MemoryQuery implements PromiseLike<QueryResult> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { key: string; ascending: boolean }[] = [];
  private columns = '*';
  private operation: 'read' | 'insert' | 'update' | 'delete' = 'read';
  private values: Row | Row[] = {};
  private single = false;
  private window?: [number, number];
  private execution?: Promise<QueryResult>;

  constructor(private database: MemoryDatabase, private table: string) {}
  select(columns = '*') { this.columns = columns; return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  is(key: string, value: null) { this.filters.push(row => row[key] === value); return this; }
  range(start: number, end: number) { this.window = [start, end]; return this; }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
  lt(key: string, value: string | number) { this.filters.push(row => (row[key] as string | number) < value); return this; }
  gt(key: string, value: string | number) { this.filters.push(row => (row[key] as string | number) > value); return this; }
  order(key: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ key, ascending: options.ascending !== false }); return this;
  }
  insert(values: Row | Row[]) { this.operation = 'insert'; this.values = values; return this; }
  update(values: Row) { this.operation = 'update'; this.values = values; return this; }
  delete() { this.operation = 'delete'; return this; }
  maybeSingle() { this.single = true; return this; }

  private execute(): QueryResult {
    const table = this.database.tables[this.table];
    let rows = table.filter(row => this.filters.every(filter => filter(row)));
    if (this.operation === 'insert') {
      const incoming = Array.isArray(this.values) ? this.values : [this.values];
      const id = { events: 'event_id', venues: 'venue_id', venue_unavailability: 'unavailability_id' }[this.table];
      let nextId = id ? Math.max(0, ...table.map(row => Number(row[id]))) + 1 : 0;
      rows = incoming.map(value => {
        const row = structuredClone(value);
        if (id) row[id] = nextId++;
        table.push(row);
        return row;
      });
    } else if (this.operation === 'update') {
      rows.forEach(row => Object.assign(row, structuredClone(this.values as Row)));
    } else if (this.operation === 'delete') {
      this.database.tables[this.table] = table.filter(row => !rows.includes(row));
    }
    rows.sort((a, b) => {
      for (const { key, ascending } of this.orders) {
        const left = a[key] as string | number, right = b[key] as string | number;
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    const projected = rows.map(row => {
      if (this.columns === '*') return structuredClone(row);
      return Object.fromEntries(this.columns.split(',').map(column => {
        const key = column.trim();
        if (key.startsWith('coordinator:')) {
          const coordinator = this.database.tables.users.find(user => user.user_id === row.coordinator_id);
          return ['coordinator', coordinator ? { name: coordinator.name } : null];
        }
        return [key, structuredClone(row[key] ?? null)];
      }));
    });
    if (this.single && projected.length > 1) throw new Error('Fixture query expected at most one row');
    return { data: this.single ? projected[0] ?? null : projected, error: null, status: 200 };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.execution ??= Promise.resolve().then(() => this.execute());
    return this.execution.then(onfulfilled, onrejected);
  }
}

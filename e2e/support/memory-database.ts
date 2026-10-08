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
  { key: 'attendee', email: 'attendee@example.test', role: 'attendee' },
  // SG2-86: Week 7 customer changes — new internal roles alongside the five.
  { key: 'lead', email: 'lead@example.test', role: 'event_coordinator_lead' },
  { key: 'safety', email: 'safety@example.test', role: 'safety_officer' }
] as const;

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: null; status: number };

/** A small stateful adapter at the external database boundary. Unsupported
 * query operations fail rather than silently ignoring query constraints. */
export class MemoryDatabase {
  tables: Record<string, Row[]> = {};
  sessions = new Map<string, string>();
  venueHoldNow: () => number = Date.now;
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
      venue_capacity_exceptions: [],
      venue_holds: [],
      venue_hold_notifications: [],
      notifications: [],
      equipment_requests: [],
      equipment: [{ equipment_id: 1, name: 'Wireless microphones', description: 'Handheld wireless microphones',
        quantity_total: 20, location: 'Technical store', operational_status: 'operational', version: 1 }],
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
      venue_layouts: [],
      venue_operations: [],
      event_clarifications: [],
      event_audit_logs: []
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
  /** SG2-37: a request this coordinator is already reviewing, ready to decide. */
  seedUnderReview() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 52, name: 'Decision Forum', status: 'under_review',
      coordinator_id: 'user-coordinator', purpose: 'Decide whether the forum proceeds',
      decided_by: null, decided_at: null, decision_reason: null,
    });
  }

  /** SG2-47: an approved event for 150 people needing a stage, a projector and
   * a hearing loop. Grand Ballroom fits; Lecture Theatre is only too small
   * (request 21 needs a capacity exception); Regression Hall also lacks a
   * stage (request 22 is blocked). Booking requests are seeded directly
   * because coordinators cannot raise them until SG2-48. */
  seedVenueSuitability() {
    const facilities = { location: 'Level 2', operating_information: '08:00–22:00', accessibility_features: 'Step-free, hearing loop' };
    this.tables.venues.push(
      { ...facilities, venue_id: 3, name: 'Lecture Theatre', capacity: 120, facilities: 'Stage, projector' },
      { ...facilities, venue_id: 4, name: 'Grand Ballroom', capacity: 300, facilities: 'Stage, projector, PA' }
    );
    this.tables.events.push({
      ...this.tables.events[0], event_id: 61, name: 'Suitability Forum', status: 'approved', coordinator_id: 'user-coordinator',
      expected_attendance: 150, venue_requirements: 'A stage and a projector', accessibility_needs: 'Needs a hearing loop'
    });
    const request = { event_id: 61, starts_at: '2030-06-17T02:00:00Z', ends_at: '2030-06-17T10:00:00Z', status: 'pending', notes: null };
    this.tables.venue_booking_requests.push({ ...request, request_id: 21, venue_id: 3 }, { ...request, request_id: 22, venue_id: 1 });
  }

  /** SG2-33/34: an unassigned submitted request, plus a second coordinator
   * (no sign-in account needed) so a real reassignment can be made. */
  seedCoordinatorAssignment() {
    this.tables.users.push({
      user_id: 'user-coordinator2', name: 'Regression second coordinator', organisation: 'Regression Organisation',
      phone: null, communication_preferences: [], department: 'Operations'
    });
    this.tables.account_roles.push({ user_id: 'user-coordinator2', role: 'event_coordinator' });
    this.tables.events.push({
      ...this.tables.events[0], event_id: 71, name: 'Assignment Forum', status: 'submitted', coordinator_id: null
    });
  }

  /** SG2-90: events in every state a coordinator can act on, for each
   * assignment state they can meet. Status matters: review and decision also
   * guard on status, so each assignment guard needs an event that is otherwise
   * actionable. Ids: 81 approved, 88/90 submitted, 89/91 under review are the
   * signed-in coordinator's own; 82-87 are approved/submitted/under review
   * pairs assigned to a second coordinator (no sign-in account) and unassigned. */
  seedCoordinatorAccess() {
    this.tables.users.push({
      user_id: 'user-coordinator2', name: 'Regression second coordinator', organisation: 'Regression Organisation',
      phone: null, communication_preferences: [], department: 'Operations'
    });
    this.tables.account_roles.push({ user_id: 'user-coordinator2', role: 'event_coordinator' });
    const base = { ...this.tables.events[0], proposed_date: '2030-06-20T02:00:00.000Z',
      expected_attendance: 80, venue_requirements: 'A projector' };
    const own = 'user-coordinator', other = 'user-coordinator2';
    const rows: [number, string, string, string | null][] = [
      [81, 'Own Forum', 'approved', own], [82, 'Colleague Forum', 'approved', other], [83, 'Queued Forum', 'approved', null],
      [84, 'Colleague Review', 'submitted', other], [85, 'Queued Review', 'submitted', null],
      [86, 'Colleague Decision', 'under_review', other], [87, 'Queued Decision', 'under_review', null],
      [88, 'Own Review', 'submitted', own], [89, 'Own Decision', 'under_review', own],
      [90, 'Handover Review', 'submitted', own], [91, 'Handover Decision', 'under_review', own]
    ];
    for (const [event_id, name, status, coordinator_id] of rows) {
      this.tables.events.push({ ...base, event_id, name, status, coordinator_id });
    }
    this.tables.venue_layouts.push({ venue_id: 1, layout: 'theatre', other_description: null });
  }

  /** SG2-97: an approved event whose coordinator was assigned by Technical
   * Support Staff before assignment moved to the Event Coordinator Lead, with
   * the history row that assignment wrote. */
  seedLegacyAssignment() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 95, name: 'Legacy Forum', status: 'approved', coordinator_id: 'user-coordinator'
    });
    this.tables.event_audit_logs.push({
      log_id: 1, event_id: 95, actor_id: 'user-support', field_name: 'coordinator_id',
      old_value: null, new_value: 'Regression coordinator', created_at: '2026-10-01T02:00:00.000Z'
    });
  }

  /** SG2-48: an approved event assigned to the coordinator, for 80 people
   * needing a projector on 20 June 2030, when both venues are free. Regression
   * Hall offers theatre and classroom layouts; Quiet Room a boardroom. */
  seedVenueRequest() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 91, name: 'Venue Request Forum', status: 'approved', coordinator_id: 'user-coordinator',
      proposed_date: '2030-06-20T02:00:00.000Z', expected_attendance: 80, venue_requirements: 'A projector'
    });
    this.tables.venue_layouts.push(
      { venue_id: 1, layout: 'theatre', other_description: null },
      { venue_id: 1, layout: 'classroom', other_description: null },
      { venue_id: 2, layout: 'boardroom', other_description: null }
    );
  }

  /** SG2-49: on top of seedVenueRequest, four pending requests from event 91's
   * coordinator. 101 is clear to approve and 102 to reject; Quiet Room (103)
   * is too small for 80 guests; 104 overlaps Regression Hall's confirmed
   * booking for the Planning workshop on 15 June. */
  seedVenueDecision() {
    this.seedVenueRequest();
    const request = { event_id: 91, status: 'pending', notes: null, venue_requirements: 'A projector', requested_by: 'user-coordinator',
      requested_at: '2030-01-01T00:00:00.000Z', decided_by: null, decided_at: null, decision_reason: null, venue_booking_id: null };
    this.tables.venue_booking_requests.push(
      { ...request, request_id: 101, venue_id: 1, layout: 'theatre', starts_at: '2030-06-20T01:00:00.000Z', ends_at: '2030-06-20T04:00:00.000Z' },
      { ...request, request_id: 102, venue_id: 1, layout: 'classroom', starts_at: '2030-06-21T01:00:00.000Z', ends_at: '2030-06-21T04:00:00.000Z' },
      { ...request, request_id: 103, venue_id: 2, layout: 'boardroom', starts_at: '2030-06-20T01:00:00.000Z', ends_at: '2030-06-20T04:00:00.000Z' },
      { ...request, request_id: 104, venue_id: 1, layout: 'theatre', starts_at: '2030-06-15T03:00:00.000Z', ends_at: '2030-06-15T05:00:00.000Z' }
    );
  }

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
          event_name: event.name || 'Untitled event', status: request.status, starts_at: request.starts_at ?? event.proposed_date, ends_at: request.ends_at,
          audience, assigned_to: null, category: kind, details: kind === 'venue'
            ? { location: resource.location, capacity: resource.capacity, expected_attendance: event.expected_attendance,
              venue_requirements: request.venue_requirements ?? event.venue_requirements, accessibility_needs: event.accessibility_needs, notes: request.notes,
              // SG2-48 AC2: the layout and requester, as the SQL view adds them.
              layout: request.layout ?? null, requested_by: this.tables.users.find(user => user.user_id === request.requested_by)?.name ?? null,
              // SG2-49: requests created by a tentative hold are decided through the hold.
              hold_id: this.tables.venue_holds.find(hold => hold.request_id === request.request_id)?.hold_id ?? null }
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
      if (table === 'venue_booking_occupancy') this.tables[table] = [
        ...this.tables.venue_bookings,
        ...this.tables.venue_holds.filter(hold => hold.status === 'tentative' && Date.parse(String(hold.expires_at)) > this.venueHoldNow())
          .map(hold => ({ venue_id: hold.venue_id, event_id: hold.event_id, starts_at: hold.starts_at, ends_at: hold.ends_at, status: 'tentative' })),
      ];
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
  not(key: string, operator: 'is', value: null) { this.filters.push(row => (row[key] ?? null) !== value); return this; }
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
      const id = { events: 'event_id', venues: 'venue_id', venue_unavailability: 'unavailability_id',
        event_clarifications: 'clarification_id', event_audit_logs: 'log_id', venue_capacity_exceptions: 'exception_id',
        venue_booking_requests: 'request_id' }[this.table];
      let nextId = id ? Math.max(0, ...table.map(row => Number(row[id]))) + 1 : 0;
      rows = incoming.map(value => {
        const row = structuredClone(value);
        if (id) row[id] = nextId++;
        if (['event_clarifications', 'event_audit_logs'].includes(this.table)) row.created_at ??= new Date().toISOString();
        // SG2-48: the column defaults a new venue request takes.
        if (this.table === 'venue_booking_requests') { row.status ??= 'pending'; row.requested_at ??= new Date().toISOString(); }
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
      // Split on commas outside parentheses, so an embedded `(name, phone)`
      // stays one column, and return the fields the embed asks for (SG2-97).
      return Object.fromEntries(this.columns.split(/,(?![^(]*\))/).map(column => {
        const key = column.trim();
        const embed = /^(coordinator|actor|sender):users!\w+\(([^)]*)\)$/.exec(key);
        if (embed) {
          const [, alias, fields] = embed;
          const user = this.database.tables.users.find(candidate => candidate.user_id === row[`${alias}_id`]);
          return [alias, user ? Object.fromEntries(fields.split(',').map(field => [field.trim(), user[field.trim()] ?? null])) : null];
        }
        if (key.startsWith('coordinator:')) {
          const coordinator = this.database.tables.users.find(user => user.user_id === row.coordinator_id);
          return ['coordinator', coordinator ? { name: coordinator.name } : null];
        }
        if (key.startsWith('actor:')) {
          const actor = this.database.tables.users.find(user => user.user_id === row.actor_id);
          return ['actor', actor ? { name: actor.name } : null];
        }
        if (key.startsWith('sender:')) {
          const sender = this.database.tables.users.find(user => user.user_id === row.sender_id);
          return ['sender', sender ? { name: sender.name } : null];
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

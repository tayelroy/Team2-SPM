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
    const now = new Date();
    const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 2));
    this.tables = {
      users: accounts.map(account => ({
        user_id: `user-${account.key}`, name: `Regression ${account.key}`,
        organisation: account.key === 'unassigned' ? null : account.key === 'organiser2' ? 'Other Organisation' : 'Regression Organisation',
        phone: '+6581234567', communication_preferences: ['email'], department: 'Operations'
      })),
      account_roles: accounts.map(account => ({ user_id: `user-${account.key}`, role: account.role })),
      events: [
        { ...draft, event_id: 1, organiser_id: 'user-organiser' },
        { ...draft, event_id: 2, organiser_id: 'user-organiser2', name: 'Other organisation draft', organisation: 'Other Organisation' }
      ],
      venues: [venue, { ...venue, venue_id: 2, name: 'Quiet Room', capacity: 20 }],
      venue_bookings: [
        { venue_id: 1, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z', status: 'confirmed', event_id: 1 },
        { venue_id: 1, starts_at: currentMonth.toISOString(), ends_at: new Date(currentMonth.getTime() + 7200000).toISOString(), status: 'confirmed', event_id: 1 }
      ],
      venue_unavailability: [
        { venue_id: 1, starts_at: '2030-06-16T02:00:00.000Z', ends_at: '2030-06-16T04:00:00.000Z', reason: 'Scheduled maintenance' }
      ]
    };
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
  private values: Row = {};
  private single = false;
  private execution?: Promise<QueryResult>;

  constructor(private database: MemoryDatabase, private table: string) {}
  select(columns = '*') { this.columns = columns; return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
  lt(key: string, value: string | number) { this.filters.push(row => (row[key] as string | number) < value); return this; }
  gt(key: string, value: string | number) { this.filters.push(row => (row[key] as string | number) > value); return this; }
  order(key: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ key, ascending: options.ascending !== false }); return this;
  }
  insert(values: Row) { this.operation = 'insert'; this.values = values; return this; }
  update(values: Row) { this.operation = 'update'; this.values = values; return this; }
  delete() { this.operation = 'delete'; return this; }
  maybeSingle() { this.single = true; return this; }

  private execute(): QueryResult {
    const table = this.database.tables[this.table];
    let rows = table.filter(row => this.filters.every(filter => filter(row)));
    if (this.operation === 'insert') {
      const row = structuredClone(this.values);
      const id = { events: 'event_id', venues: 'venue_id' }[this.table];
      if (id) row[id] = Math.max(0, ...table.map(row => Number(row[id]))) + 1;
      table.push(row);
      rows = [row];
    } else if (this.operation === 'update') {
      rows.forEach(row => Object.assign(row, structuredClone(this.values)));
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

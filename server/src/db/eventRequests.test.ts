import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchOrganiserOrganisation,
  fetchOwnEventRequest,
  insertEventRequestDraft,
  submitEventRequest
} from './eventRequests';
import type { DraftValues } from '../events/fields';

type Result = { data: unknown; error: { message: string } | null };

function fakeUsersClient(result: Result, capture?: (userId: unknown) => void): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'users');
      return {
        select: (columns: string) => {
          assert.equal(columns, 'organisation');
          return {
            eq: async (column: string, value: unknown) => {
              assert.equal(column, 'user_id');
              capture?.(value);
              return result;
            }
          };
        }
      };
    }
  } as unknown as SupabaseClient;
}

function fakeEventsClient(result: Result, capture?: (row: Record<string, unknown>) => void): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        insert: (row: Record<string, unknown>) => {
          capture?.(row);
          return { select: async () => result };
        }
      };
    }
  } as unknown as SupabaseClient;
}

function fakeEventsSelectClient(
  result: Result,
  capture?: (filters: { eventId: unknown; organiserId: unknown }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        select: (_columns: string) => {
          const filters: { eventId?: unknown; organiserId?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              if (column === 'organiser_id') filters.organiserId = value;
              return chain;
            },
            then(resolve: (value: Result) => unknown) {
              capture?.({ eventId: filters.eventId, organiserId: filters.organiserId });
              return Promise.resolve(result).then(resolve);
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

function fakeEventsUpdateClient(
  result: Result,
  capture?: (update: { row: Record<string, unknown>; eventId: unknown; status: unknown }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        update: (row: Record<string, unknown>) => {
          const filters: { eventId?: unknown; status?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              return chain;
            },
            in(column: string, value: unknown) {
              if (column === 'status') filters.status = value;
              return chain;
            },
            select: async () => {
              capture?.({ row, eventId: filters.eventId, status: filters.status });
              return result;
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

const EMPTY_VALUES: DraftValues = {
  name: 'Partner Forum',
  purpose: null,
  description: null,
  proposed_date: null,
  expected_attendance: null,
  venue_requirements: null,
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: null
};

describe('fetchOrganiserOrganisation', () => {
  test('returns the organisation for the given user', async () => {
    let askedFor: unknown;
    const result = await fetchOrganiserOrganisation(
      fakeUsersClient({ data: [{ organisation: 'ConnectSphere Test' }], error: null }, (v) => (askedFor = v)),
      'user-1'
    );
    assert.deepEqual(result, { ok: true, organisation: 'ConnectSphere Test' });
    assert.equal(askedFor, 'user-1');
  });

  test('treats a null organisation as a valid absent value', async () => {
    const result = await fetchOrganiserOrganisation(
      fakeUsersClient({ data: [{ organisation: null }], error: null }),
      'user-1'
    );
    assert.deepEqual(result, { ok: true, organisation: null });
  });

  test('reports not_found when the user has no record', async () => {
    const result = await fetchOrganiserOrganisation(fakeUsersClient({ data: [], error: null }), 'ghost');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports not_found when the driver returns no data at all', async () => {
    const result = await fetchOrganiserOrganisation(fakeUsersClient({ data: null, error: null }), 'ghost');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports unavailable when the query errors', async () => {
    const result = await fetchOrganiserOrganisation(
      fakeUsersClient({ data: null, error: { message: 'connection reset' } }),
      'user-1'
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
      assert.equal(result.message, 'connection reset');
    }
  });
});

describe('insertEventRequestDraft', () => {
  test('writes server-supplied ownership and an explicit draft status', async () => {
    let inserted: Record<string, unknown> | undefined;
    const result = await insertEventRequestDraft(
      fakeEventsClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'draft' }], error: null },
        (row) => (inserted = row)
      ),
      { organiserId: 'user-1', organisation: 'ConnectSphere Test', values: EMPTY_VALUES }
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.event_id, 7);
    assert.equal(inserted?.organiser_id, 'user-1');
    assert.equal(inserted?.organisation, 'ConnectSphere Test');
    assert.equal(inserted?.status, 'draft');
    assert.equal(inserted?.name, 'Partner Forum');
  });

  test('reports unavailable when the insert errors', async () => {
    const result = await insertEventRequestDraft(
      fakeEventsClient({ data: null, error: { message: 'violates foreign key' } }),
      { organiserId: 'user-1', organisation: null, values: EMPTY_VALUES }
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, 'violates foreign key');
  });

  for (const data of [[], null]) {
    test(`reports unavailable when the insert returns ${JSON.stringify(data)}`, async () => {
      const result = await insertEventRequestDraft(fakeEventsClient({ data, error: null }), {
        organiserId: 'user-1',
        organisation: null,
        values: EMPTY_VALUES
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /not returned/);
    });
  }
});

describe('fetchOwnEventRequest', () => {
  test('returns the request scoped to the given event and organiser', async () => {
    let filters: { eventId: unknown; organiserId: unknown } | undefined;
    const result = await fetchOwnEventRequest(
      fakeEventsSelectClient({ data: [{ event_id: 7, organiser_id: 'user-1', status: 'draft' }], error: null }, (f) => (filters = f)),
      7,
      'user-1'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.event_id, 7);
    assert.deepEqual(filters, { eventId: 7, organiserId: 'user-1' });
  });

  test('reports not_found when no row matches the event and organiser', async () => {
    const result = await fetchOwnEventRequest(fakeEventsSelectClient({ data: [], error: null }), 7, 'user-1');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports unavailable when the query errors', async () => {
    const result = await fetchOwnEventRequest(
      fakeEventsSelectClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'user-1'
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
      assert.equal(result.message, 'connection reset');
    }
  });
});

describe('submitEventRequest', () => {
  test('updates status to submitted, filtered to draft or rejected rows', async () => {
    let captured: { row: Record<string, unknown>; eventId: unknown; status: unknown } | undefined;
    const result = await submitEventRequest(
      fakeEventsUpdateClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'submitted' }], error: null },
        (c) => (captured = c)
      ),
      7
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.status, 'submitted');
    assert.equal(captured?.row.status, 'submitted');
    assert.equal(captured?.eventId, 7);
    assert.deepEqual(captured?.status, ['draft', 'rejected']);
  });

  test('reports unavailable when the update errors', async () => {
    const result = await submitEventRequest(
      fakeEventsUpdateClient({ data: null, error: { message: 'connection reset' } }),
      7
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, 'connection reset');
  });

  for (const data of [[], null]) {
    test(`reports unavailable when the update returns ${JSON.stringify(data)}`, async () => {
      const result = await submitEventRequest(fakeEventsUpdateClient({ data, error: null }), 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /not returned/);
    });
  }
});

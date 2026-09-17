import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteEventRequestDraft,
  fetchOrganiserOrganisation,
  fetchOwnEventRequest,
  insertEventRequestDraft,
  listOwnEventRequests,
  submitEventRequest,
  updateEventRequestDraft
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

function fakeEventsUpdateDraftClient(
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

function fakeEventsListClient(
  result: Result,
  capture?: (filters: { organiserId: unknown; order: { column: unknown; ascending: unknown } }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        select: (_columns: string) => {
          const filters: { organiserId?: unknown } = {};
          let order: { column: unknown; ascending: unknown } | undefined;
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'organiser_id') filters.organiserId = value;
              return chain;
            },
            order(column: string, options: { ascending: boolean }) {
              order = { column, ascending: options.ascending };
              return chain;
            },
            then(resolve: (value: Result) => unknown) {
              capture?.({ organiserId: filters.organiserId, order: order! });
              return Promise.resolve(result).then(resolve);
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

function fakeEventsDeleteClient(
  result: Result,
  capture?: (filters: { eventId: unknown; status: unknown }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        delete: () => {
          const filters: { eventId?: unknown; status?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              if (column === 'status') filters.status = value;
              return chain;
            },
            select: async (columns: string) => {
              assert.equal(columns, 'event_id');
              capture?.({ eventId: filters.eventId, status: filters.status });
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

describe('listOwnEventRequests', () => {
  test('scopes to the given organiser, newest first', async () => {
    let captured: { organiserId: unknown; order: { column: unknown; ascending: unknown } } | undefined;
    const result = await listOwnEventRequests(
      fakeEventsListClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'draft' }], error: null },
        (c) => (captured = c)
      ),
      'user-1'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.requests.length, 1);
    assert.equal(captured?.organiserId, 'user-1');
    assert.deepEqual(captured?.order, { column: 'event_id', ascending: false });
  });

  test('returns an empty list rather than failing when the caller has no requests', async () => {
    const result = await listOwnEventRequests(fakeEventsListClient({ data: [], error: null }), 'user-1');
    assert.deepEqual(result, { ok: true, requests: [] });
  });

  test('returns an empty list when the driver returns no data at all', async () => {
    const result = await listOwnEventRequests(fakeEventsListClient({ data: null, error: null }), 'user-1');
    assert.deepEqual(result, { ok: true, requests: [] });
  });

  test('reports unavailable when the query errors', async () => {
    const result = await listOwnEventRequests(
      fakeEventsListClient({ data: null, error: { message: 'connection reset' } }),
      'user-1'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });
});

describe('deleteEventRequestDraft', () => {
  test('deletes, filtered to the given event and draft status', async () => {
    let captured: { eventId: unknown; status: unknown } | undefined;
    const result = await deleteEventRequestDraft(
      fakeEventsDeleteClient({ data: [{ event_id: 7 }], error: null }, (c) => (captured = c)),
      7
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.status, 'draft');
  });

  test('reports unavailable when the delete errors', async () => {
    const result = await deleteEventRequestDraft(
      fakeEventsDeleteClient({ data: null, error: { message: 'connection reset' } }),
      7
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`reports unavailable if the status changed and the delete matches ${JSON.stringify(data)} rows`, async () => {
      const result = await deleteEventRequestDraft(fakeEventsDeleteClient({ data, error: null }), 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /status may have changed/);
    });
  }
});

describe('updateEventRequestDraft', () => {
  test('updates the given fields, filtered to the event and draft status', async () => {
    let captured: { row: Record<string, unknown>; eventId: unknown; status: unknown } | undefined;
    const result = await updateEventRequestDraft(
      fakeEventsUpdateDraftClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'draft', name: 'Renamed' }], error: null },
        (c) => (captured = c)
      ),
      7,
      { ...EMPTY_VALUES, name: 'Renamed' }
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.name, 'Renamed');
    assert.equal(captured?.row.name, 'Renamed');
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.status, 'draft');
  });

  test('reports unavailable when the update errors', async () => {
    const result = await updateEventRequestDraft(
      fakeEventsUpdateDraftClient({ data: null, error: { message: 'connection reset' } }),
      7,
      EMPTY_VALUES
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`reports unavailable if the status changed and the update matches ${JSON.stringify(data)} rows`, async () => {
      const result = await updateEventRequestDraft(fakeEventsUpdateDraftClient({ data, error: null }), 7, EMPTY_VALUES);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /not returned/);
    });
  }
});

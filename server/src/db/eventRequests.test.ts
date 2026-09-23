import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteEventRequestDraft,
  fetchOrganiserOrganisation,
  fetchOwnEventRequest,
  fetchOwnEventRequests,
  insertEventRequestDraft,
  startEventReview,
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

function fakeEventsListClient(
  result: Result,
  capture?: (filters: { organiserId?: unknown; status?: unknown; orderColumn?: unknown; orderOptions?: unknown }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        select: (_columns: string) => {
          const filters: { organiserId?: unknown; status?: unknown; orderColumn?: unknown; orderOptions?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'organiser_id') filters.organiserId = value;
              if (column === 'status') filters.status = value;
              return chain;
            },
            order(column: string, options: unknown) {
              filters.orderColumn = column;
              filters.orderOptions = options;
              return Promise.resolve(result).then((res) => {
                capture?.(filters);
                return res;
              });
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

/** Like fakeEventsUpdateClient, but also records the coordinator filter that
 * keeps one coordinator's review off another's assignment (SG2-35). */
function fakeEventsReviewClient(
  result: Result,
  capture?: (update: {
    row: Record<string, unknown>;
    eventId: unknown;
    coordinatorId: unknown;
    status: unknown;
  }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        update: (row: Record<string, unknown>) => {
          const filters: { eventId?: unknown; coordinatorId?: unknown; status?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              if (column === 'coordinator_id') filters.coordinatorId = value;
              return chain;
            },
            in(column: string, value: unknown) {
              if (column === 'status') filters.status = value;
              return chain;
            },
            select: async () => {
              capture?.({
                row,
                eventId: filters.eventId,
                coordinatorId: filters.coordinatorId,
                status: filters.status
              });
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
  capture?: (update: { row: Record<string, unknown>; eventId: unknown; organiserId: unknown; status: unknown }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        update: (row: Record<string, unknown>) => {
          const filters: { eventId?: unknown; organiserId?: unknown; status?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              if (column === 'organiser_id') filters.organiserId = value;
              if (column === 'status') filters.status = value;
              return chain;
            },
            select: async () => {
              capture?.({ row, eventId: filters.eventId, organiserId: filters.organiserId, status: filters.status });
              return result;
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
  capture?: (filters: { eventId: unknown; organiserId: unknown; status: unknown }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        delete: () => {
          const filters: { eventId?: unknown; organiserId?: unknown; status?: unknown } = {};
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              if (column === 'organiser_id') filters.organiserId = value;
              if (column === 'status') filters.status = value;
              return chain;
            },
            select: async (columns: string) => {
              assert.equal(columns, 'event_id');
              capture?.({ eventId: filters.eventId, organiserId: filters.organiserId, status: filters.status });
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
    assert.deepEqual(inserted, {
      organiser_id: 'user-1', organisation: 'ConnectSphere Test', status: 'draft', ...EMPTY_VALUES
    });
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
    if (result.ok) {
      assert.equal(result.request.event_id, 7);
      assert.equal(result.request.coordinator_id, null);
      assert.equal(result.request.coordinator_name, null);
    }
    assert.deepEqual(filters, { eventId: 7, organiserId: 'user-1' });
  });

  test('extracts coordinator information from joined relation', async () => {
    const result = await fetchOwnEventRequest(
      fakeEventsSelectClient({
        data: [
          {
            event_id: 101,
            organiser_id: 'user-1',
            status: 'draft',
            coordinator_id: 'coord-uuid-1',
            coordinator: { name: 'Sarah Coordinator' }
          }
        ],
        error: null
      }),
      101,
      'user-1'
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.event_id, 101);
      assert.equal(result.request.coordinator_id, 'coord-uuid-1');
      assert.equal(result.request.coordinator_name, 'Sarah Coordinator');
    }
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

describe('fetchOwnEventRequests', () => {
  test('returns list of event requests with coordinator name extracted from joined object', async () => {
    let capturedFilters: { organiserId?: unknown; status?: unknown; orderColumn?: unknown; orderOptions?: unknown } | undefined;
    const result = await fetchOwnEventRequests(
      fakeEventsListClient(
        {
          data: [
            {
              event_id: 101,
              name: 'Leadership Retreat',
              proposed_date: '2026-11-15T09:00:00.000Z',
              status: 'draft',
              coordinator_id: 'coord-uuid-1',
              coordinator: { name: 'Sarah Coordinator' }
            }
          ],
          error: null
        },
        (f) => (capturedFilters = f)
      ),
      'user-1'
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.requests, [
        {
          event_id: 101,
          name: 'Leadership Retreat',
          proposed_date: '2026-11-15T09:00:00.000Z',
          status: 'draft',
          coordinator_id: 'coord-uuid-1',
          coordinator_name: 'Sarah Coordinator'
        }
      ]);
    }
    assert.equal(capturedFilters?.organiserId, 'user-1');
    assert.equal(capturedFilters?.status, undefined);
    assert.equal(capturedFilters?.orderColumn, 'event_id');
    assert.deepEqual(capturedFilters?.orderOptions, { ascending: false });
  });

  test('extracts coordinator name when coordinator is an array or coordinator_name string', async () => {
    const result = await fetchOwnEventRequests(
      fakeEventsListClient({
        data: [
          {
            event_id: 102,
            name: 'Annual Gala',
            proposed_date: '2026-12-01T18:00:00.000Z',
            status: 'submitted',
            coordinator_id: 'coord-uuid-2',
            coordinator: [{ name: 'Alex Coordinator' }]
          },
          {
            event_id: 103,
            name: 'Tech Talk',
            proposed_date: null,
            status: 'approved',
            coordinator_id: 'coord-uuid-3',
            coordinator_name: 'Jordan Coordinator'
          }
        ],
        error: null
      }),
      'user-1'
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.requests[0].coordinator_name, 'Alex Coordinator');
      assert.equal(result.requests[1].coordinator_name, 'Jordan Coordinator');
    }
  });

  test('handles null/missing coordinator, dates, and non-string fields safely', async () => {
    const result = await fetchOwnEventRequests(
      fakeEventsListClient({
        data: [
          {
            event_id: '104',
            name: null,
            proposed_date: null,
            status: null,
            coordinator_id: null,
            coordinator: null
          }
        ],
        error: null
      }),
      'user-1'
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.requests[0], {
        event_id: 104,
        name: '',
        proposed_date: null,
        status: 'draft',
        coordinator_id: null,
        coordinator_name: null
      });
    }
  });

  test('applies status filter when provided', async () => {
    let capturedFilters: { organiserId?: unknown; status?: unknown } | undefined;
    const result = await fetchOwnEventRequests(
      fakeEventsListClient({ data: [], error: null }, (f) => (capturedFilters = f)),
      'user-1',
      'submitted'
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.requests, []);
    assert.equal(capturedFilters?.status, 'submitted');
  });

  for (const data of [[], null]) {
    test(`returns empty array when data is ${JSON.stringify(data)}`, async () => {
      const result = await fetchOwnEventRequests(fakeEventsListClient({ data, error: null }), 'user-1');
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.requests, []);
    });
  }

  test('reports unavailable when the query errors', async () => {
    const result = await fetchOwnEventRequests(
      fakeEventsListClient({ data: null, error: { message: 'connection failed' } }),
      'user-1'
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
      assert.equal(result.message, 'connection failed');
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
    assert.deepEqual(captured?.row, { status: 'submitted' });
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

describe('startEventReview', () => {
  test('updates status to under_review, filtered to the event, its coordinator and reviewable rows', async () => {
    let captured:
      | { row: Record<string, unknown>; eventId: unknown; coordinatorId: unknown; status: unknown }
      | undefined;
    const result = await startEventReview(
      fakeEventsReviewClient(
        {
          data: [
            {
              event_id: 7,
              organiser_id: 'user-1',
              status: 'under_review',
              coordinator_id: 'coordinator-1',
              coordinator: { name: 'Casey Coordinator' }
            }
          ],
          error: null
        },
        (c) => (captured = c)
      ),
      7,
      'coordinator-1'
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.status, 'under_review');
      assert.equal(result.request.coordinator_name, 'Casey Coordinator');
    }
    assert.deepEqual(captured?.row, { status: 'under_review' });
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.coordinatorId, 'coordinator-1');
    assert.deepEqual(captured?.status, ['submitted', 'under_review']);
  });

  test('reports unavailable when the update errors', async () => {
    const result = await startEventReview(
      fakeEventsReviewClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'coordinator-1'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`reports not_found when the update matches ${JSON.stringify(data)}`, async () => {
      // A request assigned elsewhere, already decided, or absent must all look
      // identical so assignments cannot be probed for.
      const result = await startEventReview(fakeEventsReviewClient({ data, error: null }), 7, 'coordinator-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, 'not_found');
    });
  }
});

describe('deleteEventRequestDraft', () => {
  test('deletes, filtered to the given event, organiser and draft status', async () => {
    let captured: { eventId: unknown; organiserId: unknown; status: unknown } | undefined;
    const result = await deleteEventRequestDraft(
      fakeEventsDeleteClient({ data: [{ event_id: 7 }], error: null }, (c) => (captured = c)),
      7,
      'user-1'
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.organiserId, 'user-1');
    assert.equal(captured?.status, 'draft');
  });

  test('reports unavailable when the delete errors', async () => {
    const result = await deleteEventRequestDraft(
      fakeEventsDeleteClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'user-1'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`reports unavailable if the owner or status no longer matches, matching ${JSON.stringify(data)} rows`, async () => {
      const result = await deleteEventRequestDraft(fakeEventsDeleteClient({ data, error: null }), 7, 'user-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /status may have changed/);
    });
  }
});

describe('updateEventRequestDraft', () => {
  test('updates the given fields, filtered to the event, organiser and draft status', async () => {
    let captured: { row: Record<string, unknown>; eventId: unknown; organiserId: unknown; status: unknown } | undefined;
    const result = await updateEventRequestDraft(
      fakeEventsUpdateDraftClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'draft', name: 'Renamed' }], error: null },
        (c) => (captured = c)
      ),
      7,
      'user-1',
      { ...EMPTY_VALUES, name: 'Renamed' }
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.name, 'Renamed');
    assert.deepEqual(captured?.row, { ...EMPTY_VALUES, name: 'Renamed' });
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.organiserId, 'user-1');
    assert.equal(captured?.status, 'draft');
  });

  test('reports unavailable when the update errors', async () => {
    const result = await updateEventRequestDraft(
      fakeEventsUpdateDraftClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'user-1',
      EMPTY_VALUES
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`reports unavailable if the owner or status no longer matches, matching ${JSON.stringify(data)} rows`, async () => {
      const result = await updateEventRequestDraft(
        fakeEventsUpdateDraftClient({ data, error: null }),
        7,
        'user-1',
        EMPTY_VALUES
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /not returned/);
    });
  }
});

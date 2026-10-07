import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  assignEventCoordinator,
  deleteEventRequestDraft,
  fetchAssignableRequests,
  fetchEventRequestById,
  fetchOrganiserOrganisation,
  fetchOwnEventRequest,
  fetchOwnEventRequests,
  decideEventRequest,
  requestClarification,
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
/** Records the decision payload plus the coordinator and under_review guards
 * that keep one coordinator off another's assignment (SG2-37). */
function fakeEventsDecisionClient(
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
              return chain;
            },
            in(column: string, value: unknown) {
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

// Only the external PostgREST boundary is simulated. The real SDK builds each
// update, and this dataset applies its equality and membership filters.
function eventDatabase(initial: Record<string, unknown>) {
  let rows = [{ ...initial }];
  const client = createClient('https://event-state.test.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/rest/v1/events');
      const selected = rows.filter(row => [...url.searchParams].every(([column, filter]) => {
        if (filter.startsWith('eq.')) return String(row[column]) === filter.slice(3);
        if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(row[column]));
        return true;
      }));
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body));
        for (const row of selected) Object.assign(row, patch);
      } else if (init?.method === 'DELETE') {
        rows = rows.filter(row => !selected.includes(row));
      }
      return Response.json(selected);
    } }
  });
  return { client, stored: () => rows.map(row => ({ ...row })) };
}

test('[CONFLICT] [SG2-35:AC2] an assigned review can be reopened without creating another event', async () => {
  const db = eventDatabase({ event_id: 7, status: 'submitted', organiser_id: 'user-1', coordinator_id: 'coordinator-1' });
  const first = await startEventReview(db.client, 7, 'coordinator-1');
  const reopened = await startEventReview(db.client, 7, 'coordinator-1');
  assert.equal(first.ok, true);
  assert.equal(reopened.ok, true);
  if (reopened.ok) assert.equal(reopened.request.status, 'under_review');
  assert.deepEqual(db.stored(), [{ event_id: 7, status: 'under_review', organiser_id: 'user-1', coordinator_id: 'coordinator-1' }]);
});

test('[CONFLICT] [SG2-37:AC1] [SG2-37:AC2] a second decision cannot overwrite a completed review', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T02:00:00.000Z') });
  const db = eventDatabase({ event_id: 7, status: 'under_review', organiser_id: 'user-1', coordinator_id: 'coordinator-1' });
  assert.equal((await decideEventRequest(db.client, 7, 'coordinator-1', 'approved', null)).ok, true);
  const again = await decideEventRequest(db.client, 7, 'coordinator-1', 'rejected', 'Changed my mind');
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, 'not_found');
  assert.deepEqual(db.stored(), [{ event_id: 7, status: 'approved', organiser_id: 'user-1', coordinator_id: 'coordinator-1',
    decided_by: 'coordinator-1', decided_at: '2026-09-25T02:00:00.000Z', decision_reason: null }]);
});

test('[CONFLICT] [SG2-29:AC1] [SG2-30:AC3] [SG2-32:AC2] submission stops stale draft edits and deletes', async () => {
  const db = eventDatabase({ event_id: 7, status: 'draft', organiser_id: 'user-1', name: 'Original draft' });
  assert.equal((await submitEventRequest(db.client, 7, () => '2026-10-07T01:00:00.000Z')).ok, true);
  assert.equal((await updateEventRequestDraft(db.client, 7, 'user-1', { ...EMPTY_VALUES, name: 'Stale edit' })).ok, false);
  assert.equal((await deleteEventRequestDraft(db.client, 7, 'user-1')).ok, false);
  assert.deepEqual(db.stored(), [{
    event_id: 7, status: 'submitted', organiser_id: 'user-1', name: 'Original draft', submitted_at: '2026-10-07T01:00:00.000Z'
  }]);
});

describe('fetchOrganiserOrganisation', () => {
  test('[NORMAL] [SG2-26:AC1] [SG2-28:AC3] returns the organisation for the given user', async () => {
    let askedFor: unknown;
    const result = await fetchOrganiserOrganisation(
      fakeUsersClient({ data: [{ organisation: 'ConnectSphere Test' }], error: null }, (v) => (askedFor = v)),
      'user-1'
    );
    assert.deepEqual(result, { ok: true, organisation: 'ConnectSphere Test' });
    assert.equal(askedFor, 'user-1');
  });

  test('[BOUNDARY] [SG2-26:AC1] [SG2-28:AC3] treats a null organisation as a valid absent value', async () => {
    const result = await fetchOrganiserOrganisation(
      fakeUsersClient({ data: [{ organisation: null }], error: null }),
      'user-1'
    );
    assert.deepEqual(result, { ok: true, organisation: null });
  });

  test('[FAILURE] [SG2-26:AC1] [SG2-28:AC3] reports not_found when the user has no record', async () => {
    const result = await fetchOrganiserOrganisation(fakeUsersClient({ data: [], error: null }), 'ghost');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('[FAILURE] [SG2-26:AC1] [SG2-28:AC3] reports not_found when the driver returns no data at all', async () => {
    const result = await fetchOrganiserOrganisation(fakeUsersClient({ data: null, error: null }), 'ghost');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('[FAILURE] [SG2-26:AC1] [SG2-28:AC3] reports unavailable when the query errors', async () => {
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
  test('[NORMAL] [SG2-28:AC1] [SG2-28:AC3] writes server-supplied ownership and an explicit draft status', async () => {
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

  test('[FAILURE] [SG2-28:AC3] reports unavailable when the insert errors', async () => {
    const result = await insertEventRequestDraft(
      fakeEventsClient({ data: null, error: { message: 'violates foreign key' } }),
      { organiserId: 'user-1', organisation: null, values: EMPTY_VALUES }
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, 'violates foreign key');
  });

  for (const data of [[], null]) {
    test(`[FAILURE] [SG2-28:AC3] reports unavailable when the insert returns ${JSON.stringify(data)}`, async () => {
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
  test('[NORMAL] [SG2-31:AC3] returns the request scoped to the given event and organiser', async () => {
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

  test('[NORMAL] [SG2-33:AC3] extracts coordinator information from joined relation', async () => {
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

  test('[FAILURE] [SG2-31:AC3] reports not_found when no row matches the event and organiser', async () => {
    const result = await fetchOwnEventRequest(fakeEventsSelectClient({ data: [], error: null }), 7, 'user-1');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('[FAILURE] [SG2-31:AC3] reports unavailable when the query errors', async () => {
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
  test('[NORMAL] [SG2-31:AC1] returns list of event requests with coordinator name extracted from joined object', async () => {
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

  test('[NORMAL] [SG2-31:AC1] extracts coordinator name when coordinator is an array or coordinator_name string', async () => {
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

  test('[FAILURE] [SG2-31:AC1] handles null/missing coordinator, dates, and non-string fields safely', async () => {
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

  test('[NORMAL] [SG2-31:AC2] applies status filter when provided', async () => {
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
    test(`[BOUNDARY] [SG2-31:AC1] returns empty array when data is ${JSON.stringify(data)}`, async () => {
      const result = await fetchOwnEventRequests(fakeEventsListClient({ data, error: null }), 'user-1');
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.requests, []);
    });
  }

  test('[FAILURE] [SG2-31:AC1] reports unavailable when the query errors', async () => {
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
  test('[NORMAL] [SG2-30:AC1] [SG2-36:AC2] [SG2-87:AC1] [SG2-87:AC3] updates status to submitted and stamps the submission time, filtered to draft, rejected or returned rows', async () => {
    let captured: { row: Record<string, unknown>; eventId: unknown; status: unknown } | undefined;
    const result = await submitEventRequest(
      fakeEventsUpdateClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'submitted' }], error: null },
        (c) => (captured = c)
      ),
      7,
      () => '2026-10-07T01:00:00.000Z'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.status, 'submitted');
    assert.deepEqual(captured?.row, { status: 'submitted', submitted_at: '2026-10-07T01:00:00.000Z' });
    assert.equal(captured?.eventId, 7);
    assert.deepEqual(captured?.status, ['draft', 'rejected', 'needs_clarification']);
  });

  test('[FAILURE] [SG2-30:AC1] reports unavailable when the update errors', async () => {
    const result = await submitEventRequest(
      fakeEventsUpdateClient({ data: null, error: { message: 'connection reset' } }),
      7
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, 'connection reset');
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-30:AC3] reports unavailable when the update returns ${JSON.stringify(data)}`, async () => {
      const result = await submitEventRequest(fakeEventsUpdateClient({ data, error: null }), 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /not returned/);
    });
  }
});

describe('startEventReview', () => {
  test('[NORMAL] [SG2-35:AC2] [SG2-35:AC3] updates status to under_review, filtered to the event, its coordinator and reviewable rows', async () => {
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

  test('[FAILURE] [SG2-35:AC2] reports unavailable when the update errors', async () => {
    const result = await startEventReview(
      fakeEventsReviewClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'coordinator-1'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-35:AC3] reports not_found when the update matches ${JSON.stringify(data)}`, async () => {
      // A request assigned elsewhere, already decided, or absent must all look
      // identical so assignments cannot be probed for.
      const result = await startEventReview(fakeEventsReviewClient({ data, error: null }), 7, 'coordinator-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, 'not_found');
    });
  }
});

describe('decideEventRequest', () => {
  test('[NORMAL] [SG2-37:AC3] records the outcome, decider and time, filtered to a request this coordinator is reviewing', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T02:00:00.000Z') });
    let captured:
      | { row: Record<string, unknown>; eventId: unknown; coordinatorId: unknown; status: unknown }
      | undefined;
    const result = await decideEventRequest(
      fakeEventsDecisionClient(
        {
          data: [
            {
              event_id: 7,
              organiser_id: 'user-1',
              status: 'approved',
              coordinator_id: 'coordinator-1',
              coordinator: { name: 'Casey Coordinator' }
            }
          ],
          error: null
        },
        (c) => (captured = c)
      ),
      7,
      'coordinator-1',
      'approved',
      null
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.coordinator_name, 'Casey Coordinator');
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.coordinatorId, 'coordinator-1');
    // Only a request already under review may be decided.
    assert.equal(captured?.status, 'under_review');
    assert.equal(captured?.row.status, 'approved');
    assert.equal(captured?.row.decided_by, 'coordinator-1');
    assert.equal(captured?.row.decision_reason, null);
    // AC3: when the decision happened is recorded, not left to the caller.
    assert.equal(captured?.row.decided_at, '2026-09-25T02:00:00.000Z');
  });

  test('[NORMAL] [SG2-37:AC2] stores the rejection reason alongside the outcome', async () => {
    let captured: { row: Record<string, unknown> } | undefined;
    await decideEventRequest(
      fakeEventsDecisionClient({ data: [{ event_id: 7, status: 'rejected' }], error: null }, (c) => (captured = c)),
      7,
      'coordinator-1',
      'rejected',
      'Date clashes with the AGM.'
    );
    assert.equal(captured?.row.status, 'rejected');
    assert.equal(captured?.row.decision_reason, 'Date clashes with the AGM.');
  });

  test('[FAILURE] [SG2-37:AC3] reports unavailable when the update errors', async () => {
    const result = await decideEventRequest(
      fakeEventsDecisionClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'coordinator-1',
      'approved',
      null
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-37:AC1] [SG2-37:AC2] reports not_found when the update matches ${JSON.stringify(data)}`, async () => {
      // Assigned elsewhere, already decided, or absent must look identical.
      const result = await decideEventRequest(
        fakeEventsDecisionClient({ data, error: null }),
        7,
        'coordinator-1',
        'approved',
        null
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, 'not_found');
    });
  }
});

describe('requestClarification', () => {
  test('[NORMAL] [SG2-36:AC1] returns the request to its organiser, filtered to this coordinator and under review', async () => {
    let captured:
      | { row: Record<string, unknown>; eventId: unknown; coordinatorId: unknown; status: unknown }
      | undefined;
    const result = await requestClarification(
      fakeEventsDecisionClient(
        { data: [{ event_id: 7, status: 'needs_clarification', coordinator_id: 'coordinator-1' }], error: null },
        (c) => (captured = c)
      ),
      7,
      'coordinator-1'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.status, 'needs_clarification');
    assert.deepEqual(captured?.row, { status: 'needs_clarification' });
    assert.equal(captured?.eventId, 7);
    assert.equal(captured?.coordinatorId, 'coordinator-1');
    // Only a request this coordinator is actively reviewing may be parked.
    assert.equal(captured?.status, 'under_review');
  });

  test('[FAILURE] [SG2-36:AC1] reports unavailable when the update errors', async () => {
    const result = await requestClarification(
      fakeEventsDecisionClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'coordinator-1'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-36:AC1] reports not_found when the update matches ${JSON.stringify(data)}`, async () => {
      const result = await requestClarification(fakeEventsDecisionClient({ data, error: null }), 7, 'coordinator-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, 'not_found');
    });
  }
});

describe('deleteEventRequestDraft', () => {
  test('[NORMAL] [SG2-32:AC1] [SG2-32:AC2] deletes, filtered to the given event, organiser and draft status', async () => {
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

  test('[FAILURE] [SG2-32:AC1] reports unavailable when the delete errors', async () => {
    const result = await deleteEventRequestDraft(
      fakeEventsDeleteClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'user-1'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-32:AC2] reports unavailable if the owner or status no longer matches, matching ${JSON.stringify(data)} rows`, async () => {
      const result = await deleteEventRequestDraft(fakeEventsDeleteClient({ data, error: null }), 7, 'user-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /status may have changed/);
    });
  }
});

describe('updateEventRequestDraft', () => {
  test('[NORMAL] [SG2-29:AC1] [SG2-30:AC3] [SG2-36:AC2] updates the given fields, filtered to the event, organiser and editable statuses', async () => {
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
    assert.deepEqual(captured?.status, ['draft', 'needs_clarification']);
  });

  test('[FAILURE] [SG2-29:AC1] reports unavailable when the update errors', async () => {
    const result = await updateEventRequestDraft(
      fakeEventsUpdateDraftClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'user-1',
      EMPTY_VALUES
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-30:AC3] reports unavailable if the owner or status no longer matches, matching ${JSON.stringify(data)} rows`, async () => {
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

describe('fetchEventRequestById', () => {
  test('[NORMAL] [SG2-38:AC1] returns the request scoped only by event id, unscoped by organiser', async () => {
    let filters: { eventId: unknown; organiserId: unknown } | undefined;
    const result = await fetchEventRequestById(
      fakeEventsSelectClient(
        { data: [{ event_id: 7, organiser_id: 'user-1', status: 'submitted' }], error: null },
        (f) => (filters = f)
      ),
      7
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.event_id, 7);
    assert.equal(filters?.eventId, 7);
    assert.equal(filters?.organiserId, undefined);
  });

  test('[NORMAL] [SG2-38:AC2] extracts coordinator information from joined relation', async () => {
    const result = await fetchEventRequestById(
      fakeEventsSelectClient({
        data: [
          {
            event_id: 101,
            status: 'submitted',
            coordinator_id: 'coord-uuid-1',
            coordinator: { name: 'Sarah Coordinator' }
          }
        ],
        error: null
      }),
      101
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.coordinator_id, 'coord-uuid-1');
      assert.equal(result.request.coordinator_name, 'Sarah Coordinator');
    }
  });

  test('[FAILURE] [SG2-38:AC1] reports not_found when no row matches the event id', async () => {
    const result = await fetchEventRequestById(fakeEventsSelectClient({ data: [], error: null }), 7);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('[FAILURE] [SG2-38:AC1] reports unavailable when the query errors', async () => {
    const result = await fetchEventRequestById(
      fakeEventsSelectClient({ data: null, error: { message: 'connection reset' } }),
      7
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
      assert.equal(result.message, 'connection reset');
    }
  });
});

/** Records every guard on the coordinator write, including the one on the
 * current coordinator that keeps a reassignment from overwriting a newer one. */
function fakeAssignClient(
  result: Result,
  capture?: (update: { row: Record<string, unknown>; filters: [string, string, unknown][] }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'events');
      return {
        update: (row: Record<string, unknown>) => {
          const filters: [string, string, unknown][] = [];
          const chain = {
            eq(column: string, value: unknown) { filters.push(['eq', column, value]); return chain; },
            is(column: string, value: unknown) { filters.push(['is', column, value]); return chain; },
            in(column: string, value: unknown) { filters.push(['in', column, value]); return chain; },
            select: async () => {
              capture?.({ row, filters });
              return result;
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

const ASSIGNABLE = ['submitted', 'under_review', 'approved', 'planning', 'confirmed'];

describe('assignEventCoordinator', () => {
  test('[NORMAL] [SG2-33:AC1] [SG2-33:AC2] sets coordinator_id only while the request is assignable and still unassigned', async () => {
    let captured: { row: Record<string, unknown>; filters: [string, string, unknown][] } | undefined;
    const result = await assignEventCoordinator(
      fakeAssignClient(
        {
          data: [{ event_id: 7, status: 'submitted', coordinator_id: 'coord-1', coordinator: { name: 'Coord One' } }],
          error: null
        },
        (c) => (captured = c)
      ),
      7,
      'coord-1',
      null
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.coordinator_id, 'coord-1');
      assert.equal(result.request.coordinator_name, 'Coord One');
    }
    assert.deepEqual(captured?.row, { coordinator_id: 'coord-1' });
    assert.deepEqual(captured?.filters, [
      ['eq', 'event_id', 7],
      ['in', 'status', ASSIGNABLE],
      ['is', 'coordinator_id', null]
    ]);
  });

  test('[NORMAL] [SG2-34:AC1] [SG2-34:AC2] reassigns only while the previous coordinator still holds the request', async () => {
    let captured: { row: Record<string, unknown>; filters: [string, string, unknown][] } | undefined;
    const result = await assignEventCoordinator(
      fakeAssignClient(
        {
          data: [{ event_id: 7, status: 'under_review', coordinator_id: 'coord-new', coordinator: { name: 'New Coord' } }],
          error: null
        },
        (c) => (captured = c)
      ),
      7,
      'coord-new',
      'coord-old'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.coordinator_id, 'coord-new');
    assert.deepEqual(captured?.filters, [
      ['eq', 'event_id', 7],
      ['in', 'status', ASSIGNABLE],
      ['eq', 'coordinator_id', 'coord-old']
    ]);
  });

  test('[NORMAL] [SG2-33:AC4] can clear the coordinator again, which is how an unrecorded first assignment is undone', async () => {
    let captured: { row: Record<string, unknown>; filters: [string, string, unknown][] } | undefined;
    const result = await assignEventCoordinator(
      fakeAssignClient({ data: [{ event_id: 7, status: 'submitted', coordinator_id: null }], error: null }, (c) => (captured = c)),
      7,
      null,
      'coord-1'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.request.coordinator_id, null);
    assert.deepEqual(captured?.row, { coordinator_id: null });
    assert.deepEqual(captured?.filters.at(-1), ['eq', 'coordinator_id', 'coord-1']);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] reports unavailable when the update errors', async () => {
    const result = await assignEventCoordinator(
      fakeAssignClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'coord-1',
      null
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`[CONFLICT] [SG2-33:AC1] [SG2-34:AC1] reports not_assignable when the status or coordinator moved on, matching ${JSON.stringify(data)} rows`, async () => {
      const result = await assignEventCoordinator(fakeAssignClient({ data, error: null }), 7, 'coord-1', 'coord-old');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, 'not_assignable');
    });
  }
});

describe('coordinator contact on a single request (SG2-33 AC3)', () => {
  async function phoneFor(coordinator: unknown) {
    const result = await fetchOwnEventRequest(
      fakeEventsSelectClient({
        data: [{ event_id: 1, organiser_id: 'user-1', status: 'submitted', coordinator }],
        error: null
      }),
      1,
      'user-1'
    );
    assert.equal(result.ok, true);
    return result.ok ? result.request.coordinator_phone : undefined;
  }

  test('[NORMAL] [SG2-33:AC3] [SG2-34:AC3] returns the phone from an object relation', async () => {
    assert.equal(await phoneFor({ name: 'Sarah', phone: '+65 9123 4567' }), '+65 9123 4567');
  });

  test('[NORMAL] [SG2-33:AC3] [SG2-34:AC3] returns the phone from an array relation', async () => {
    assert.equal(await phoneFor([{ name: 'Sarah', phone: '+65 9123 4567' }]), '+65 9123 4567');
  });

  test('[BOUNDARY] [SG2-33:AC3] [SG2-34:AC3] reports null when the coordinator has no usable phone', async () => {
    assert.equal(await phoneFor({ name: 'Sarah', phone: null }), null);
    assert.equal(await phoneFor({ name: 'Sarah', phone: '   ' }), null);
  });

  test('[BOUNDARY] [SG2-33:AC3] reports null when no coordinator is assigned', async () => {
    assert.equal(await phoneFor(null), null);
  });
});

describe('fetchAssignableRequests', () => {
  function fakeAssignableClient(result: Result, capture?: (statuses: unknown) => void): SupabaseClient {
    return {
      from(table: string) {
        assert.equal(table, 'events');
        return {
          select: () => ({
            in: (column: string, statuses: unknown) => {
              assert.equal(column, 'status');
              capture?.(statuses);
              return {
                order: async (column: string, options: unknown) => {
                  assert.equal(column, 'event_id');
                  assert.deepEqual(options, { ascending: false });
                  return result;
                }
              };
            }
          })
        };
      }
    } as unknown as SupabaseClient;
  }

  test('[NORMAL] [SG2-33:AC1] [SG2-34:AC1] lists requests in an assignable status with their current coordinator', async () => {
    let statuses: unknown;
    const result = await fetchAssignableRequests(
      fakeAssignableClient(
        {
          data: [
            {
              event_id: 9,
              name: 'Partner Forum',
              organisation: 'Acme',
              status: 'submitted',
              coordinator_id: 'coord-1',
              coordinator: { name: 'Sarah' }
            },
            { event_id: 8, name: null, organisation: null, status: null, coordinator_id: null, coordinator: null }
          ],
          error: null
        },
        (s) => (statuses = s)
      )
    );

    assert.deepEqual(statuses, ['submitted', 'under_review', 'approved', 'planning', 'confirmed']);
    assert.deepEqual(result, {
      ok: true,
      requests: [
        {
          event_id: 9,
          name: 'Partner Forum',
          organisation: 'Acme',
          status: 'submitted',
          coordinator_id: 'coord-1',
          coordinator_name: 'Sarah'
        },
        {
          event_id: 8,
          name: '',
          organisation: null,
          status: 'submitted',
          coordinator_id: null,
          coordinator_name: null
        }
      ]
    });
  });

  test('[BOUNDARY] [SG2-33:AC1] [SG2-34:AC1] returns an empty list when the query returns no data', async () => {
    assert.deepEqual(await fetchAssignableRequests(fakeAssignableClient({ data: null, error: null })), {
      ok: true,
      requests: []
    });
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] reports unavailable when the query errors', async () => {
    assert.deepEqual(
      await fetchAssignableRequests(fakeAssignableClient({ data: null, error: { message: 'boom' } })),
      { ok: false, reason: 'unavailable', message: 'boom' }
    );
  });
});

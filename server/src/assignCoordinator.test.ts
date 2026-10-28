import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role, Principal } from './auth/policy';
import { dbConfig } from './db/config';
import { createAssignCoordinatorHandler } from './events/assignCoordinator';
import type {
  AssignCoordinatorResult,
  AssignStatusTransition,
  FetchEventRequestResult
} from './db/eventRequests';
import type { GetHeldRolesResult } from './db/accountRoles';
import type { FetchEventSupervisorResult } from './db/coordinatorOverview';
import type { InsertAuditLogInput, InsertAuditLogsResult } from './db/auditLogs';
import type { EventNotice, NotifyEventResult } from './db/eventNotifications';

// SG2-97: assignment belongs to the Event Coordinator Lead.
const STAFF: Principal = { userId: 'staff-1', role: 'event_coordinator_lead' };

const SUBMITTED_REQUEST = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'submitted',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Quarterly partner networking session.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  preferred_layout: null,
  category: null,
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: true,
  coordinator_id: null,
  coordinator_name: null
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventRequestResult;
  roleResult?: GetHeldRolesResult;
  assignResult?: AssignCoordinatorResult;
  /** Result of the compensating write that undoes an unrecorded assignment. */
  rollbackResult?: AssignCoordinatorResult;
  auditResult?: InsertAuditLogsResult;
  captureFetch?: (eventId: number) => void;
  captureRole?: (userId: string) => void;
  captureAssign?: (eventId: number, coordinatorId: string) => void;
  /** Every coordinator write, including a rollback: [eventId, to, expectedCurrent]. */
  writes?: [number, string | null, string | null][];
  /** SG2-100: the status move each coordinator write carried, in order. */
  transitions?: (AssignStatusTransition | undefined)[];
  audits?: InsertAuditLogInput[][];
  notifyResult?: NotifyEventResult;
  /** SG2-68: each notice batch, with how many history batches preceded it. */
  notices?: { afterHistory: number; batch: EventNotice[] }[];
  /** SG2-89: the Lead supervising the event before the change. */
  supervisorResult?: FetchEventSupervisorResult;
  /** SG2-89: the supervising Lead each coordinator write carried, in order. */
  assigners?: (string | null)[];
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/coordinator',
    createAssignCoordinatorHandler({
      getPrincipal: () => ('principal' in options ? options.principal : STAFF),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchRequest: async (_admin, eventId) => {
        options.captureFetch?.(eventId);
        return options.fetchResult ?? { ok: true, request: SUBMITTED_REQUEST };
      },
      lookupRole: async (_admin, userId) => {
        options.captureRole?.(userId);
        return options.roleResult ?? { ok: true, roles: ['event_coordinator'] };
      },
      fetchSupervisor: async () => options.supervisorResult ?? { ok: true, supervisorId: 'lead-before' },
      assignCoordinator: async (_admin, eventId, { coordinatorId, assignedBy }, expectedCurrent, statusTransition) => {
        options.writes?.push([eventId, coordinatorId, expectedCurrent]);
        options.transitions?.push(statusTransition);
        options.assigners?.push(assignedBy);
        const isRollback = (options.writes?.length ?? 0) > 1;
        if (isRollback) {
          return options.rollbackResult ?? { ok: true, request: SUBMITTED_REQUEST };
        }
        options.captureAssign?.(eventId, coordinatorId!);
        return (
          options.assignResult ?? {
            ok: true,
            request: { ...SUBMITTED_REQUEST, coordinator_id: coordinatorId, coordinator_name: 'Coord One' }
          }
        );
      },
      writeHistory: async (_admin, entries) => {
        options.audits?.push(entries);
        return options.auditResult ?? { ok: true, logs: [] };
      },
      notify: async (_admin, batch) => {
        options.notices?.push({ afterHistory: options.audits?.length ?? 0, batch });
        return options.notifyResult ?? { ok: true };
      }
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId/coordinator (SG2-33/SG2-34)', () => {
  test('[BOUNDARY] [SG2-33:AC1] assignment accepts event id one and refuses zero before any lookup or write', async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, event_id: 1 } },
      assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, event_id: 1, coordinator_id: 'coord-1' } },
      captureFetch: eventId => { calls.push(['event', eventId]); },
      captureRole: coordinatorId => { calls.push(['role', coordinatorId]); },
      captureAssign: (eventId, coordinatorId) => { calls.push(['assign', eventId, coordinatorId]); }
    });
    const refused = await request(app).patch('/api/event-requests/0/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, { error: 'eventId must be a positive integer.' });
    assert.deepEqual(calls, []);
    const accepted = await request(app).patch('/api/event-requests/1/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.event_id, 1);
    assert.deepEqual(calls, [['event', 1], ['role', 'coord-1'], ['assign', 1, 'coord-1']]);
  });

  test('[NORMAL] [SG2-33:AC1] [SG2-33:AC2] [SG2-89:AC1] assigns a coordinator to a request with none yet (SG2-33)', async () => {
    let assigned: { eventId: number; coordinatorId: string } | undefined;
    const assigners: (string | null)[] = [];
    const response = await request(
      buildApp({ assigners, captureAssign: (eventId, coordinatorId) => (assigned = { eventId, coordinatorId }) })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.coordinator_id, 'coord-1');
    assert.deepEqual(assigned, { eventId: 7, coordinatorId: 'coord-1' });
    assert.deepEqual(assigners, ['staff-1']);
  });

  test('[NORMAL] [SG2-34:AC1] [SG2-34:AC2] reassigns a request that already has a coordinator (SG2-34)', async () => {
    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          request: { ...SUBMITTED_REQUEST, coordinator_id: 'coord-old', coordinator_name: 'Old Coord' }
        }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-new' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.coordinator_id, 'coord-new');
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 for a non-numeric eventId', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/not-a-number/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 when coordinatorId is missing', async () => {
    const response = await request(buildApp()).patch('/api/event-requests/7/coordinator').send({});
    assert.equal(response.status, 400);
  });

  test('[BOUNDARY] [SG2-33:AC1] [SG2-34:AC1] returns 400 when coordinatorId is blank', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: '   ' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 401);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 404 when the event request does not exist', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 404);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 without leaking the database error when the lookup fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 when coordinatorId does not belong to any account', async () => {
    const response = await request(buildApp({ roleResult: { ok: false, reason: 'user_not_found' } }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'ghost' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 when the target account is not an Event Coordinator', async () => {
    const response = await request(buildApp({ roleResult: { ok: true, roles: ['venue_staff'] } }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 without leaking the database error when the role lookup fails', async () => {
    const response = await request(
      buildApp({ roleResult: { ok: false, reason: 'error', error: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[CONFLICT] [SG2-33:AC1] [SG2-34:AC1] returns 409 when the assignment no longer matches an assignable status', async () => {
    const response = await request(
      buildApp({
        assignResult: {
          ok: false,
          reason: 'not_assignable',
          message: 'This event request cannot have a coordinator assigned in its current status.'
        }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 409);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 without leaking the database error when the update fails', async () => {
    const response = await request(
      buildApp({ assignResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('PATCH /api/event-requests/:eventId/coordinator records the assignment in the event history (SG2-33 AC4, SG2-34 AC4)', () => {
  const ASSIGNED = { ...SUBMITTED_REQUEST, coordinator_id: 'coord-old', coordinator_name: 'Old Coordinator' };

  test('[NORMAL] [SG2-33:AC4] a first assignment is recorded with the staff member who made it', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const writes: [number, string | null, string | null][] = [];
    const response = await request(
      buildApp({
        audits,
        writes,
        assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, coordinator_id: 'coord-1', coordinator_name: 'Sarah Tan' } }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 200);
    // The write only applies while the request is still unassigned.
    assert.deepEqual(writes, [[7, 'coord-1', null]]);
    // The database stamps created_at, so "when" is not taken from the caller.
    assert.deepEqual(audits, [[
      { event_id: 7, actor_id: 'staff-1', field_name: 'coordinator_id', old_value: null, new_value: 'Sarah Tan' }
    ]]);
  });

  test('[NORMAL] [SG2-34:AC4] [SG2-68:AC1] a reassignment keeps the previous coordinator in the history row', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const writes: [number, string | null, string | null][] = [];
    const notices: { afterHistory: number; batch: EventNotice[] }[] = [];
    const response = await request(
      buildApp({
        audits,
        writes,
        notices,
        fetchResult: { ok: true, request: ASSIGNED },
        assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, coordinator_id: 'coord-new', coordinator_name: 'New Coordinator' } }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-new' });

    assert.equal(response.status, 200);
    assert.deepEqual(writes, [[7, 'coord-new', 'coord-old']]);
    assert.deepEqual(audits, [[
      { event_id: 7, actor_id: 'staff-1', field_name: 'coordinator_id', old_value: 'Old Coordinator', new_value: 'New Coordinator' }
    ]]);
    assert.deepEqual(notices[0].batch, [
      { recipient_id: 'coord-new', event_id: 7, kind: 'coordinator_assigned', message: 'You are now coordinating Partner Forum.' },
      { recipient_id: 'user-1', event_id: 7, kind: 'coordinator_assigned', message: 'New Coordinator is now coordinating Partner Forum.' },
      { recipient_id: 'coord-old', event_id: 7, kind: 'coordinator_assigned', message: 'Partner Forum was reassigned to another coordinator.' }
    ]);
  });

  test('[BOUNDARY] [SG2-33:AC4] [SG2-34:AC4] choosing the coordinator already assigned changes nothing and adds no history', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const writes: [number, string | null, string | null][] = [];
    const response = await request(buildApp({ audits, writes, fetchResult: { ok: true, request: ASSIGNED } }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-old' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.coordinator_id, 'coord-old');
    assert.deepEqual(writes, []);
    assert.deepEqual(audits, []);
  });

  test('[BOUNDARY] [SG2-33:AC4] falls back to the coordinator id when a name cannot be resolved', async () => {
    const audits: InsertAuditLogInput[][] = [];
    await request(
      buildApp({
        audits,
        fetchResult: { ok: true, request: { ...ASSIGNED, coordinator_name: null } },
        assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, coordinator_id: 'coord-new', coordinator_name: null } }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-new' });

    assert.deepEqual(audits[0][0], {
      event_id: 7, actor_id: 'staff-1', field_name: 'coordinator_id', old_value: 'coord-old', new_value: 'coord-new'
    });
  });

  test('[NORMAL] [SG2-100:AC1] [SG2-40:AC1] [SG2-40:AC2] assigning a request awaiting assignment also moves it into review and records unassigned → submitted with the assignment', async () => {
    const transitions: (AssignStatusTransition | undefined)[] = [];
    const writes: [number, string | null, string | null][] = [];
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(
      buildApp({
        writes,
        transitions,
        audits,
        fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, status: 'unassigned' } },
        assignResult: {
          ok: true,
          request: { ...SUBMITTED_REQUEST, status: 'submitted', coordinator_id: 'coord-1', coordinator_name: 'Sarah Tan' }
        }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'submitted');
    assert.deepEqual(transitions, [{ from: 'unassigned', to: 'submitted' }]);
    assert.deepEqual(writes, [[7, 'coord-1', null]]);
    // One insert, so the undo path covers both rows together.
    assert.deepEqual(audits, [[
      { event_id: 7, actor_id: 'staff-1', field_name: 'coordinator_id', old_value: null, new_value: 'Sarah Tan' },
      { event_id: 7, actor_id: 'staff-1', field_name: 'status', old_value: 'unassigned', new_value: 'submitted' }
    ]]);
  });

  test('[CONFLICT] [SG2-100:AC1] reassigning a live event carries no status move, so the event is never rewound', async () => {
    for (const status of ['under_review', 'approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed']) {
      const transitions: (AssignStatusTransition | undefined)[] = [];
      const response = await request(
        buildApp({
          transitions,
          fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, status, coordinator_id: 'coord-old', coordinator_name: 'Old' } },
          assignResult: {
            ok: true,
            request: { ...SUBMITTED_REQUEST, status, coordinator_id: 'coord-new', coordinator_name: 'New' }
          }
        })
      )
        .patch('/api/event-requests/7/coordinator')
        .send({ coordinatorId: 'coord-new' });

      assert.equal(response.status, 200, status);
      assert.equal(response.body.request.status, status);
      assert.deepEqual(transitions, [undefined], status);
    }
  });

  test('[BOUNDARY] [SG2-100:AC1] an unrecorded first assignment is undone status and all', async () => {
    const transitions: (AssignStatusTransition | undefined)[] = [];
    const writes: [number, string | null, string | null][] = [];
    const response = await request(
      buildApp({
        writes,
        transitions,
        fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, status: 'unassigned' } },
        auditResult: { ok: false, reason: 'unavailable', message: 'down' }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 503);
    // Without the inverse move the row would be left in `submitted` with no
    // coordinator — the state 202610060002 backfilled away.
    assert.deepEqual(transitions, [
      { from: 'unassigned', to: 'submitted' },
      { from: 'submitted', to: 'unassigned' }
    ]);
    assert.deepEqual(writes, [[7, 'coord-1', null], [7, null, 'coord-1']]);
  });

  test('[CONFLICT] [SG2-33:AC1] [SG2-34:AC1] refuses a request that is not in an assignable status before any write', async () => {
    const writes: [number, string | null, string | null][] = [];
    const audits: InsertAuditLogInput[][] = [];
    for (const status of ['draft', 'rejected', 'completed', 'cancelled']) {
      const response = await request(
        buildApp({ writes, audits, fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, status } } })
      )
        .patch('/api/event-requests/7/coordinator')
        .send({ coordinatorId: 'coord-1' });
      assert.equal(response.status, 409, status);
      assert.deepEqual(response.body, {
        error: 'A coordinator can only be assigned to a submitted request that is not yet closed out.'
      });
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(audits, []);
  });

  test('[CONFLICT] [SG2-34:AC4] a reassignment that loses a race is refused, so history never names the wrong previous coordinator', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(
      buildApp({
        audits,
        fetchResult: { ok: true, request: ASSIGNED },
        assignResult: { ok: false, reason: 'not_assignable', message: 'zero rows' }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-new' });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: 'This request changed while you were assigning it. Reload the list and try again.'
    });
    assert.deepEqual(audits, []);
  });

  test('[FAILURE] [SG2-33:AC4] [SG2-34:AC4] an assignment that cannot be recorded is undone and reported as unavailable', async () => {
    const writes: [number, string | null, string | null][] = [];
    const response = await request(
      buildApp({
        writes,
        fetchResult: { ok: true, request: ASSIGNED },
        assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, coordinator_id: 'coord-new', coordinator_name: 'New Coordinator' } },
        auditResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-new' });

    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
    // Put the previous coordinator back, but only if nobody has changed it since.
    assert.deepEqual(writes, [[7, 'coord-new', 'coord-old'], [7, 'coord-old', 'coord-new']]);
  });

  test('[FAILURE] [SG2-33:AC4] [SG2-68:AC1] a first assignment that cannot be recorded is undone back to unassigned', async () => {
    const writes: [number, string | null, string | null][] = [];
    const notices: { afterHistory: number; batch: EventNotice[] }[] = [];
    const response = await request(
      buildApp({ writes, notices, auditResult: { ok: false, reason: 'unavailable', message: 'down' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 503);
    assert.deepEqual(writes, [[7, 'coord-1', null], [7, null, 'coord-1']]);
    assert.deepEqual(notices, []);
  });

  test('[FAILURE] [SG2-33:AC4] still answers 503 without leaking details when the undo also fails', async () => {
    const writes: [number, string | null, string | null][] = [];
    const audits: InsertAuditLogInput[][] = [];
    let storedCoordinator: string | null = null;
    const app = express().use(express.json());
    app.patch('/api/event-requests/:eventId/coordinator', createAssignCoordinatorHandler({
      getPrincipal: () => STAFF,
      getAdminClient: () => ({}) as SupabaseClient,
      fetchRequest: async () => ({ ok: true, request: { ...SUBMITTED_REQUEST, coordinator_id: storedCoordinator } }),
      lookupRole: async () => ({ ok: true, roles: ['event_coordinator'] }),
      fetchSupervisor: async () => ({ ok: true, supervisorId: null }),
      assignCoordinator: async (_admin, eventId, { coordinatorId }, expectedCurrent) => {
        writes.push([eventId, coordinatorId, expectedCurrent]);
        assert.equal(expectedCurrent, storedCoordinator);
        if (writes.length === 2) return { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' };
        storedCoordinator = coordinatorId;
        return { ok: true, request: { ...SUBMITTED_REQUEST, coordinator_id: storedCoordinator, coordinator_name: 'Coord One' } };
      },
      writeHistory: async (_admin, entries) => {
        audits.push(entries);
        return { ok: false, reason: 'unavailable', message: 'PRIVATE_AUDIT_DETAIL' };
      }
    }));
    const response = await request(app).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL|PRIVATE_AUDIT_DETAIL/);
    assert.deepEqual(writes, [[7, 'coord-1', null], [7, null, 'coord-1']]);
    assert.deepEqual(audits, [[{ event_id: 7, actor_id: 'staff-1', field_name: 'coordinator_id', old_value: null, new_value: 'Coord One' }]]);
    // A failed compensating write cannot restore the already saved assignment.
    assert.equal(storedCoordinator, 'coord-1');
  });

});

describe('PATCH /api/event-requests/:eventId/coordinator notices (SG2-68)', () => {
  const ASSIGNED_TO_OLD = { ...SUBMITTED_REQUEST, coordinator_id: 'coord-old', coordinator_name: 'Old Coordinator' };

  test('[NORMAL] [SG2-68:AC1] [SG2-68:AC2] a first assignment tells the new coordinator and the organiser, after the history row', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const notices: { afterHistory: number; batch: EventNotice[] }[] = [];
    const response = await request(buildApp({
      audits, notices, fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, status: 'unassigned' } }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 200);
    assert.deepEqual(notices, [{ afterHistory: 1, batch: [
      { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_assigned', message: 'You are now coordinating Partner Forum.' },
      { recipient_id: 'user-1', event_id: 7, kind: 'coordinator_assigned', message: 'Coord One is now coordinating Partner Forum.' },
      { recipient_id: null, event_id: 7, kind: 'coordinator_assigned', message: 'Partner Forum was reassigned to another coordinator.' }
    ] }]);
  });

  test('[BOUNDARY] [SG2-68:AC1] [SG2-68:AC3] re-choosing the current coordinator notifies nobody; an unnamed coordinator is "A coordinator"', async () => {
    const unchanged: { afterHistory: number; batch: EventNotice[] }[] = [];
    const same = await request(buildApp({ notices: unchanged, fetchResult: { ok: true, request: ASSIGNED_TO_OLD } }))
      .patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-old' });
    assert.equal(same.status, 200);
    assert.deepEqual(unchanged, []);

    const unnamed: { afterHistory: number; batch: EventNotice[] }[] = [];
    await request(buildApp({
      notices: unnamed,
      assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, name: '', coordinator_id: 'coord-1', coordinator_name: null } }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(unnamed[0].batch[1].message, 'A coordinator is now coordinating Untitled event.');
  });

  test('[CONFLICT] [SG2-68:AC3] the Lead making the change is never told about it, even when they are also the organiser', async () => {
    const notices: { afterHistory: number; batch: EventNotice[] }[] = [];
    await request(buildApp({
      notices,
      assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, organiser_id: 'staff-1', coordinator_id: 'coord-1', coordinator_name: 'Coord One' } }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-1' });
    assert.deepEqual(notices[0].batch.map(notice => notice.recipient_id), ['coord-1', null]);
  });

  test('[FAILURE] [SG2-68:AC1] a notice that cannot be stored answers 503 but leaves the recorded assignment in place', async () => {
    const writes: [number, string | null, string | null][] = [];
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(buildApp({ writes, audits, notifyResult: { ok: false } }))
      .patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-1' });
    assert.deepEqual([response.status, response.body], [503, { error: 'Event requests are temporarily unavailable. Please try again later.' }]);
    assert.deepEqual(writes, [[7, 'coord-1', null]]);
    assert.equal(audits.length, 1);
  });

});

describe('PATCH /api/event-requests/:eventId/coordinator authorisation wiring', () => {
  const userId = '10000000-0000-4000-8000-000000000002';
  const originalConfig = { ...dbConfig };

  beforeEach(() => {
    dbConfig.supabaseUrl = 'https://auth-test.supabase.co';
    dbConfig.supabaseAnonKey = 'sb_publishable_test';
    dbConfig.supabaseServiceRoleKey = 'test-service-role';
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected network request');
    });
  });

  afterEach(() => {
    mock.restoreAll();
    Object.assign(dbConfig, originalConfig);
  });

  /**
   * Uses the real PERMISSIONS policy, exercising the actual grant for
   * 'event_request.assign_coordinator'. Every other handler param is left
   * as the default (unused by this route); the assign-coordinator handler
   * is stubbed so reaching it is unambiguous.
   */
  const appForRole = (role: Role) =>
    createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_coordinator_lead')).patch(
      '/api/event-requests/7/coordinator'
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] denies a role without the assign-coordinator permission', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] denies an Event Coordinator (they receive assignments, not make them)', async () => {
    const response = await request(appForRole('event_coordinator'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('[FAILURE] [SG2-97:AC1] refuses Technical Support Staff now that assignment belongs to the Event Coordinator Lead', async () => {
    const response = await request(appForRole('technical_support_staff'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
    assert.equal(response.body.reached, undefined);
  });

  test('[BOUNDARY] [SG2-97:AC1] the two Week 7 roles split at assignment: the Event Coordinator Lead may assign, the Safety Officer may not', async () => {
    const statuses = [];
    for (const role of ['event_coordinator_lead', 'safety_officer'] as const) {
      const response = await request(appForRole(role))
        .patch('/api/event-requests/7/coordinator')
        .set('Authorization', 'Bearer token');
      statuses.push([role, response.status]);
    }
    assert.deepEqual(statuses, [['event_coordinator_lead', 200], ['safety_officer', 403]]);
  });

  test('[NORMAL] [SG2-33:AC1] [SG2-34:AC1] [SG2-97:AC1] [SG2-97:AC4] lets the Event Coordinator Lead reach the assign-coordinator handler', async () => {
    const response = await request(appForRole('event_coordinator_lead'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});

test("[FAILURE] [SG2-104:AC2] the Lead cannot make an event's own organiser its coordinator, and nothing is written", async () => {
  const writes: unknown[] = [];
  const audits: unknown[] = [];
  const response = await request(buildApp({ writes, audits } as never))
    .patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'user-1' });
  assert.equal(response.status, 400);
  assert.deepEqual([writes, audits], [[], []]);
});

describe('PATCH /api/event-requests/:eventId/coordinator supervision (SG2-89)', () => {
  const AWAITING_ANSWERS = { ...SUBMITTED_REQUEST, status: 'needs_clarification', coordinator_id: 'coord-old', coordinator_name: 'Old Coordinator' };

  test('[NORMAL] [SG2-89:AC6] the Lead reassigns an event awaiting clarification and its status stays put', async () => {
    const writes: [number, string | null, string | null][] = [];
    const transitions: (AssignStatusTransition | undefined)[] = [];
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(buildApp({
      writes, transitions, audits,
      fetchResult: { ok: true, request: AWAITING_ANSWERS },
      assignResult: { ok: true, request: { ...AWAITING_ANSWERS, coordinator_id: 'coord-new', coordinator_name: 'New Coordinator' } }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-new' });
    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'needs_clarification');
    assert.deepEqual(writes, [[7, 'coord-new', 'coord-old']]);
    assert.deepEqual(transitions, [undefined]);
    assert.deepEqual(audits[0].map(entry => entry.field_name), ['coordinator_id']);
  });

  test('[CONFLICT] [SG2-89:AC6] [SG2-89:AC1] when another Lead reassigns first, the second reassignment changes nothing', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(buildApp({
      audits,
      fetchResult: { ok: true, request: AWAITING_ANSWERS },
      assignResult: { ok: false, reason: 'not_assignable', message: 'moved on' }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-new' });
    assert.equal(response.status, 409);
    assert.deepEqual(audits, []);
  });

  test('[FAILURE] [SG2-89:AC1] an unrecorded reassignment is undone back under the Lead who supervised it before', async () => {
    const assigners: (string | null)[] = [];
    const response = await request(buildApp({
      assigners,
      fetchResult: { ok: true, request: AWAITING_ANSWERS },
      auditResult: { ok: false, reason: 'unavailable', message: 'down' }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-new' });
    assert.equal(response.status, 503);
    assert.deepEqual(assigners, ['staff-1', 'lead-before']);
  });

  test('[FAILURE] [SG2-89:AC1] when the supervising Lead cannot be read, nothing is written', async () => {
    const writes: [number, string | null, string | null][] = [];
    const response = await request(buildApp({
      writes, supervisorResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' }
    })).patch('/api/event-requests/7/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
    assert.deepEqual(writes, []);
  });
});

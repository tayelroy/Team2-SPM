import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentNotices } from './assignmentNotices';

const EVENT = { eventId: 7, eventName: 'Partner Forum', organiserId: 'org-1' };

test('[NORMAL] [SG2-88:AC4] a first assignment tells the new coordinator and the organiser', () => {
  assert.deepEqual(assignmentNotices({ ...EVENT, coordinatorId: 'coord-1', coordinatorName: 'Casey Coordinator', previousCoordinatorId: null }), [
    { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_assigned',
      message: 'You are now the Event Coordinator for “Partner Forum”.' },
    { recipient_id: 'org-1', event_id: 7, kind: 'event_coordinator_changed',
      message: 'Casey Coordinator is now the Event Coordinator for “Partner Forum”.' }
  ]);
});

test('[NORMAL] [SG2-88:AC4] a reassignment also tells the previous coordinator they no longer hold the event', () => {
  assert.deepEqual(assignmentNotices({ ...EVENT, coordinatorId: 'coord-2', coordinatorName: 'Robin Second', previousCoordinatorId: 'coord-1' }), [
    { recipient_id: 'coord-2', event_id: 7, kind: 'coordinator_assigned',
      message: 'You are now the Event Coordinator for “Partner Forum”.' },
    { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_removed',
      message: '“Partner Forum” has been reassigned to Robin Second. You are no longer its Event Coordinator.' },
    { recipient_id: 'org-1', event_id: 7, kind: 'event_coordinator_changed',
      message: 'Robin Second is now the Event Coordinator for “Partner Forum”.' }
  ]);
});

test('[BOUNDARY] [SG2-88:AC4] an untitled event and an unnamed coordinator still read as plain sentences', () => {
  const notices = assignmentNotices({ eventId: 9, eventName: '   ', organiserId: 'org-1', coordinatorId: 'coord-1', coordinatorName: null, previousCoordinatorId: 'coord-0' });
  assert.deepEqual(notices.map(notice => notice.message), [
    'You are now the Event Coordinator for “Untitled event”.',
    '“Untitled event” has been reassigned to another coordinator. You are no longer its Event Coordinator.',
    'A new Event Coordinator has been assigned to “Untitled event”.'
  ]);
});

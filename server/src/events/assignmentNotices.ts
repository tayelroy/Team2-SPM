import type { AssignmentNotice } from '../db/assignmentNotifications';

export interface AssignmentChange {
  eventId: number;
  eventName: string;
  organiserId: string;
  coordinatorId: string;
  coordinatorName: string | null;
  previousCoordinatorId: string | null;
}

/**
 * Who hears about an assignment or reassignment (SG2-88 AC4): the newly
 * assigned coordinator, any previous coordinator, and the event's organiser.
 */
export function assignmentNotices(change: AssignmentChange): AssignmentNotice[] {
  const event = `“${change.eventName.trim() || 'Untitled event'}”`;
  const coordinator = change.coordinatorName?.trim() || null;
  const notices: AssignmentNotice[] = [{
    recipient_id: change.coordinatorId, event_id: change.eventId, kind: 'coordinator_assigned',
    message: `You are now the Event Coordinator for ${event}.`
  }];
  if (change.previousCoordinatorId) {
    notices.push({
      recipient_id: change.previousCoordinatorId, event_id: change.eventId, kind: 'coordinator_removed',
      message: `${event} has been reassigned to ${coordinator ?? 'another coordinator'}. You are no longer its Event Coordinator.`
    });
  }
  notices.push({
    recipient_id: change.organiserId, event_id: change.eventId, kind: 'event_coordinator_changed',
    message: coordinator
      ? `${coordinator} is now the Event Coordinator for ${event}.`
      : `A new Event Coordinator has been assigned to ${event}.`
  });
  return notices;
}

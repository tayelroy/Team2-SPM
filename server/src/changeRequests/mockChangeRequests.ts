// In-memory fixture source for loopback change-request workflows. The
// application defaults to the database-backed source; e2e and integration
// harnesses create isolated factory instances that can be reset.
import {
  CHANGE_FIELD_LABELS,
  type ChangeRequestChange,
  type ChangeableField
} from '../events/changeImpact';

/** A request to change an event, as SG2-66 consumes it. */
export interface ChangeRequest {
  id: string;
  requested_at: string;
  reason: string;
  status: 'pending';
  changes: ChangeRequestChange[];
}

/** The event fields the mock derives its sample requests from. */
export interface ChangeRequestEvent {
  event_id: number;
  expected_attendance: number | null;
  proposed_date: string | null;
  description: string | null;
}

/** The seam SG2-64/SG2-65 implement with a real store. */
export interface ChangeRequestSource {
  /** Pending change requests for the event, oldest first. */
  list(event: ChangeRequestEvent): Promise<ChangeRequest[]>;
  /** One pending change request, or null when unknown or already accepted. */
  get(event: ChangeRequestEvent, id: string): Promise<ChangeRequest | null>;
  /** Records that the request was accepted, so it is no longer pending. */
  markAccepted(event: ChangeRequestEvent, id: string): Promise<void>;
}

export interface MockChangeRequestSource extends ChangeRequestSource {
  /** Forgets every seeded and accepted request (loopback test reset). */
  reset(): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function change(field: ChangeableField, from: string | number | null, to: string | number | null): ChangeRequestChange {
  return { field, label: CHANGE_FIELD_LABELS[field], from, to };
}

/**
 * SG2-64/SG2-65 STAND-IN. Per process and in memory: each event's sample
 * requests are seeded from the event on first read and then frozen, so their
 * "from" and "to" values do not drift as the event changes:
 * 1. `mock-<id>-attendance`: attendance up by max(20, 50%), or 100 when unknown;
 * 2. `mock-<id>-date` (only when the event has a date): one week later;
 * 3. `mock-<id>-description`: an agenda wording update (not significant).
 * Accepted requests are hidden from list and get.
 */
export function createMockChangeRequestSource(now: () => Date = () => new Date()): MockChangeRequestSource {
  const seeded = new Map<number, ChangeRequest[]>();
  const accepted = new Set<string>();

  const requestsFor = (event: ChangeRequestEvent): ChangeRequest[] => {
    let requests = seeded.get(event.event_id);
    if (!requests) {
      const requestedAt = now().toISOString();
      const id = event.event_id;
      const attendance = event.expected_attendance;
      requests = [{
        id: `mock-${id}-attendance`, requested_at: requestedAt, reason: 'More guests have confirmed than planned.',
        status: 'pending',
        changes: [change('expected_attendance', attendance,
          attendance === null ? 100 : attendance + Math.max(20, Math.ceil(attendance * 0.5)))]
      }];
      if (event.proposed_date !== null) {
        requests.push({
          id: `mock-${id}-date`, requested_at: requestedAt, reason: 'The keynote speaker can only attend a week later.',
          status: 'pending',
          changes: [change('proposed_date', event.proposed_date,
            new Date(new Date(event.proposed_date).getTime() + 7 * DAY_MS).toISOString())]
        });
      }
      requests.push({
        id: `mock-${id}-description`, requested_at: requestedAt, reason: 'Agenda wording update.', status: 'pending',
        changes: [change('description', event.description, `${event.description ?? ''} (updated agenda)`.trim())]
      });
      seeded.set(event.event_id, requests);
    }
    return requests.filter(request => !accepted.has(request.id));
  };

  return {
    async list(event) {
      return structuredClone(requestsFor(event));
    },
    async get(event, id) {
      const found = requestsFor(event).find(request => request.id === id);
      return found ? structuredClone(found) : null;
    },
    async markAccepted(_event, id) {
      accepted.add(id);
    },
    reset() {
      seeded.clear();
      accepted.clear();
    }
  };
}

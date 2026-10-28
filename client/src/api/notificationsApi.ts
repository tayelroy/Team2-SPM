/** The signed-in person's own notices (SG2-49): Venue Staff decisions on their
 * venue requests, and since SG2-68 the steps of their event's request
 * lifecycle. Mirrors server/src/db/notifications.ts. */
export interface Notification {
  notification_id: number;
  event_id: number | null;
  request_id: number | null;
  kind: 'venue_request_approved' | 'venue_request_rejected' | 'venue_booking_released' | 'equipment_reserved' | 'venue_booking_clash'
    | 'venue_unavailable' | 'event_confirmed' | 'event_submitted' | 'coordinator_assigned' | 'clarification_requested' | 'event_approved' | 'event_rejected'
    | 'event_returned_to_planning' | 'safety_decision' | 'outstanding_arrangements' | 'registration_opened'
    | 'registration_closed' | 'venue_booking_cancelled' | 'venue_change_requested'
    | 'cancellation_requested' | 'event_cancelled' | 'registration_confirmed' | 'change_requested'
    | 'registration_withdrawn'
    | 'change_accepted' | 'change_refused'
    | 'registration_full' | 'waiting_list_offer' | 'waiting_list_offer_lapsed';
  message: string;
  created_at: string;
}

export type NotificationsOutcome =
  | { ok: true; notifications: Notification[] }
  | { ok: false; message: string };

const UNAVAILABLE: NotificationsOutcome = { ok: false, message: 'Could not load notifications. Please try again.' };

const KINDS: Record<Notification['kind'], true> = {
  venue_request_approved: true, venue_request_rejected: true, venue_booking_released: true, equipment_reserved: true,
  venue_booking_clash: true, venue_unavailable: true, event_confirmed: true, event_submitted: true, coordinator_assigned: true,
  clarification_requested: true, event_approved: true, event_rejected: true, event_returned_to_planning: true,
  safety_decision: true, outstanding_arrangements: true, registration_opened: true, registration_closed: true,
  // SG2-83 AC4: Venue Staff hear of a cancelled or changed venue booking.
  venue_booking_cancelled: true, venue_change_requested: true,
  cancellation_requested: true, event_cancelled: true,
  // SG2-60: an attendee's registration is confirmed.
  registration_confirmed: true,
  // SG2-64 AC2: the organiser asked for a change to the coordinator's event.
  change_requested: true,
  // SG2-62 AC5: an attendee withdrew, giving a place back.
  registration_withdrawn: true,
  // SG2-65 AC1/AC2: the coordinator accepted or refused the organiser's change.
  change_accepted: true, change_refused: true,
  // SG2-61 AC3: the event is full; SG2-62 AC6: a waiting-list place is offered, or the offer lapsed.
  registration_full: true, waiting_list_offer: true, waiting_list_offer_lapsed: true
};

function isNotification(value: unknown): value is Notification {
  const entry = value as Notification | null;
  return typeof entry?.notification_id === 'number'
    && KINDS[entry.kind] === true
    && typeof entry.message === 'string' && typeof entry.created_at === 'string' && Number.isFinite(Date.parse(entry.created_at));
}

/** GET /api/notifications — the server limits these to the caller. */
export async function loadNotifications(accessToken: string): Promise<NotificationsOutcome> {
  try {
    const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    if (response.status === 401) return { ok: false, message: 'Your session has expired. Sign in again to view notifications.' };
    if (!response.ok) return UNAVAILABLE;
    const body = await response.json() as { notifications?: unknown } | null;
    if (!Array.isArray(body?.notifications) || !body.notifications.every(isNotification)) return UNAVAILABLE;
    return { ok: true, notifications: body.notifications };
  } catch {
    return UNAVAILABLE;
  }
}

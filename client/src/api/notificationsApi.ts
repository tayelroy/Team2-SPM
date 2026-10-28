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
    | 'event_changed'
    // SG2-61 AC3: the event is full; SG2-62 AC6: a waiting-list place is offered, or the offer lapsed.
    | 'registration_full' | 'waiting_list_offer' | 'waiting_list_offer_lapsed';
  message: string;
  created_at: string;
}

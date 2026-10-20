import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '../auth/policy';

/** The event fields the relationship rule reads. */
export interface RelatedEvent {
  event_id: number;
  organiser_id: string;
  coordinator_id?: string | null;
  status: string;
}

export type RelationshipResult = { ok: true; related: boolean } | { ok: false };

/** Statuses at or past the operational safety check (Week 7 change #6). */
const SAFETY_STATUSES = ['awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed', 'completed'];

async function anyRow(admin: SupabaseClient, tables: string[], eventId: number): Promise<RelationshipResult> {
  for (const table of tables) {
    const { data, error } = await admin.from(table).select('event_id').eq('event_id', eventId).limit(1);
    if (error) return { ok: false };
    if ((data ?? []).length > 0) return { ok: true, related: true };
  }
  return { ok: true, related: false };
}

/**
 * SG2-104 AC6: whether the caller, acting as `role`, has a relationship to the
 * event and may read its stage and change history. Mirrored by
 * private.event_relationship_exists() (202610180004); the two change together.
 * The coordinator check reads the event's current coordinator, so a
 * reassigned coordinator loses access immediately.
 *
 * Venue Staff and Technical Support are each one shared team: no account is
 * assigned to particular venues or equipment, and any Venue Staff member may
 * decide any venue's request (decide_venue_booking_request()). So they relate
 * to every event that has a venue (or equipment) request or booking, the same
 * events their queues show; scoping per venue would need a staff assignment
 * the system does not have.
 */
export async function hasEventRelationship(
  admin: SupabaseClient,
  role: Role,
  userId: string,
  event: RelatedEvent
): Promise<RelationshipResult> {
  switch (role) {
    case 'event_organiser': return { ok: true, related: event.organiser_id === userId };
    case 'event_coordinator': return { ok: true, related: (event.coordinator_id ?? null) === userId };
    case 'event_coordinator_lead': return { ok: true, related: event.status !== 'draft' };
    case 'safety_officer': return { ok: true, related: SAFETY_STATUSES.includes(event.status) };
    case 'venue_staff': return anyRow(admin, ['venue_booking_requests', 'venue_bookings'], event.event_id);
    case 'technical_support_staff': return anyRow(admin, ['equipment_requests', 'equipment_reservations'], event.event_id);
    case 'attendee': return { ok: true, related: false };
  }
}

import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

/** A venue an event awaiting its safety check is booked into (SG2-91 AC3). */
export interface SafetyCheckVenue {
  request_id: number;
  venue_id: number;
  venue_name: string;
  location: string | null;
  capacity: number | null;
  layout: string | null;
  starts_at: string | null;
  ends_at: string | null;
  accessibility_features: string | null;
  emergency_access: string | null;
  known_restrictions: string | null;
}

/** A piece of equipment and where it will be placed (SG2-91 AC3). */
export interface SafetyCheckEquipment {
  request_id: number;
  equipment_name: string;
  quantity: number;
  placement_venue_name: string | null;
  placement_position: string | null;
  arrangement_notes: string | null;
}

/** One event on the Safety Officer's list (SG2-91 AC2/AC3). */
export interface SafetyCheckEvent {
  event_id: number;
  /** Changes whenever what this review shows changes; SG2-92's decision
   * sends it back so a review of since-changed details can be refused. */
  safety_check_revision: number;
  name: string;
  organisation: string | null;
  proposed_date: string | null;
  awaiting_since: string | null;
  expected_attendance: number | null;
  accessibility_needs: string | null;
  expected_crowd_movement: string | null;
  venues: SafetyCheckVenue[];
  equipment: SafetyCheckEquipment[];
}

export interface SafetyChecksStore {
  list(): Promise<SafetyCheckEvent[]>;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number | null => (Number.isSafeInteger(value) ? value as number : null);
const rows = (value: unknown): Row[] =>
  (Array.isArray(value) ? value.filter((row): row is Row => typeof row === 'object' && row !== null) : []);

function venue(row: Row): SafetyCheckVenue {
  return {
    request_id: Number(row.request_id),
    venue_id: Number(row.venue_id),
    venue_name: text(row.venue_name) ?? 'Venue no longer listed',
    location: text(row.location),
    capacity: count(row.capacity),
    layout: text(row.layout),
    starts_at: text(row.starts_at),
    ends_at: text(row.ends_at),
    accessibility_features: text(row.accessibility_features),
    emergency_access: text(row.emergency_access),
    known_restrictions: text(row.known_restrictions)
  };
}

function equipment(row: Row): SafetyCheckEquipment {
  return {
    request_id: Number(row.request_id),
    equipment_name: text(row.equipment_name) ?? 'Equipment no longer listed',
    quantity: Number(row.quantity),
    placement_venue_name: text(row.placement_venue_name),
    placement_position: text(row.placement_position),
    arrangement_notes: text(row.arrangement_notes)
  };
}

function event(row: Row): SafetyCheckEvent {
  return {
    event_id: Number(row.event_id),
    safety_check_revision: Number(row.safety_check_revision),
    name: text(row.name) ?? '',
    organisation: text(row.organisation),
    proposed_date: text(row.proposed_date),
    awaiting_since: text(row.awaiting_since),
    expected_attendance: count(row.expected_attendance),
    accessibility_needs: text(row.accessibility_needs),
    expected_crowd_movement: text(row.expected_crowd_movement),
    venues: rows(row.venues).map(venue),
    equipment: rows(row.equipment).map(equipment)
  };
}

/**
 * Reads the list through `public.safety_check_queue` with the caller's JWT,
 * so the stored role is checked by the database as well as by the route
 * (SG2-91 AC4): a Safety Officer whose role has since changed is refused.
 */
export function createSafetyChecksStore(token: string, makeClient = createUserScopedClient): SafetyChecksStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async list() {
      const { data, error, status } = await client.rpc('safety_check_queue');
      if (error) throw new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
      if (!Array.isArray(data)) throw new AccessError(503);
      return rows(data).map(event);
    }
  };
}

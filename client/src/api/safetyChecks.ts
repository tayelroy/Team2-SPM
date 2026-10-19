/** A venue an event awaiting its safety check is booked into (SG2-91 AC3). */
export interface SafetyCheckVenue {
  requestId: number;
  name: string;
  location: string | null;
  capacity: number | null;
  layout: string | null;
  startsAt: string | null;
  endsAt: string | null;
  accessibilityFeatures: string | null;
  emergencyAccess: string | null;
  knownRestrictions: string | null;
}

/** A piece of equipment and where it will be placed (SG2-91 AC3). */
export interface SafetyCheckEquipment {
  requestId: number;
  name: string;
  quantity: number;
  placementVenue: string | null;
  placementPosition: string | null;
  arrangementNotes: string | null;
}

/** One event on the Safety Officer's list (SG2-91 AC2/AC3). */
export interface SafetyCheckEvent {
  eventId: number;
  /** Sent back with SG2-92's decision so a review of since-changed details is refused. */
  revision: number;
  name: string;
  organisation: string | null;
  proposedDate: string | null;
  awaitingSince: string | null;
  expectedAttendance: number | null;
  accessibilityNeeds: string | null;
  expectedCrowdMovement: string | null;
  venues: SafetyCheckVenue[];
  equipment: SafetyCheckEquipment[];
}

export type FetchSafetyChecksResult =
  | { ok: true; events: SafetyCheckEvent[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' };

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const count = (value: unknown) => (typeof value === 'number' ? value : null);
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value as Raw[] : []);

/** GET /api/safety-checks — Safety Officers only (SG2-91 AC4). */
export async function fetchSafetyChecks(token: string): Promise<FetchSafetyChecksResult> {
  let response: Response;
  try {
    response = await fetch('/api/safety-checks', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  if (!response.ok) return { ok: false, kind: 'unavailable' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (!Array.isArray(data.events)) return { ok: false, kind: 'unavailable' };
  return {
    ok: true,
    events: (data.events as Raw[]).map((raw) => ({
      eventId: Number(raw.event_id) || 0,
      revision: Number(raw.safety_check_revision) || 0,
      name: text(raw.name) ?? '',
      organisation: text(raw.organisation),
      proposedDate: text(raw.proposed_date),
      awaitingSince: text(raw.awaiting_since),
      expectedAttendance: count(raw.expected_attendance),
      accessibilityNeeds: text(raw.accessibility_needs),
      expectedCrowdMovement: text(raw.expected_crowd_movement),
      venues: list(raw.venues).map((venue) => ({
        requestId: Number(venue.request_id) || 0,
        name: text(venue.venue_name) ?? '',
        location: text(venue.location),
        capacity: count(venue.capacity),
        layout: text(venue.layout),
        startsAt: text(venue.starts_at),
        endsAt: text(venue.ends_at),
        accessibilityFeatures: text(venue.accessibility_features),
        emergencyAccess: text(venue.emergency_access),
        knownRestrictions: text(venue.known_restrictions),
      })),
      equipment: list(raw.equipment).map((item) => ({
        requestId: Number(item.request_id) || 0,
        name: text(item.equipment_name) ?? '',
        quantity: Number(item.quantity) || 0,
        placementVenue: text(item.placement_venue_name),
        placementPosition: text(item.placement_position),
        arrangementNotes: text(item.arrangement_notes),
      })),
    })),
  };
}

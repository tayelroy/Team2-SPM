import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError, type Role } from '../../server/src/auth/policy';
import { currentActingRole, orderRoles, selectActingRole } from '../../server/src/auth/actingRole';
import { DRAFT_FIELDS, validateDraftInput } from '../../server/src/events/fields';

// Synthetic fixtures only. This adapter deliberately does not emulate Postgres
// constraints or RLS: the independent database-policy CI job owns that evidence.
export const TEST_PASSWORD = 'Regression123!';
export const accounts = [
  { key: 'organiser', email: 'organiser@example.test', role: 'event_organiser' },
  { key: 'organiser2', email: 'organiser2@example.test', role: 'event_organiser' },
  { key: 'colleague', email: 'colleague@example.test', role: 'event_organiser' },
  { key: 'unassigned', email: 'unassigned@example.test', role: 'event_organiser' },
  { key: 'coordinator', email: 'coordinator@example.test', role: 'event_coordinator' },
  { key: 'venue', email: 'venue@example.test', role: 'venue_staff' },
  { key: 'support', email: 'support@example.test', role: 'technical_support_staff' },
  { key: 'attendee', email: 'attendee@example.test', role: 'attendee' },
  // SG2-86: Week 7 customer changes — new internal roles alongside the five.
  { key: 'lead', email: 'lead@example.test', role: 'event_coordinator_lead' },
  { key: 'safety', email: 'safety@example.test', role: 'safety_officer' }
] as const;

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: null; status: number };

/** A small stateful adapter at the external database boundary. Unsupported
 * query operations fail rather than silently ignoring query constraints. */
export class MemoryDatabase {
  tables: Record<string, Row[]> = {};
  sessions = new Map<string, string>();
  venueHoldNow: () => number = Date.now;
  private sessionSequence = 0;
  /** SG2-89: sign-in accounts a seed adds for one test, cleared on reset. */
  private seededAccounts: { key: string; email: string; role: string }[] = [];

  constructor() { this.reset(); }

  reset() {
    this.sessions.clear();
    this.sessionSequence = 0;
    this.seededAccounts = [];
    const draft = {
      name: 'Planning workshop', purpose: 'Team planning', description: 'A planning workshop.',
      proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 20,
      venue_requirements: 'A room with seating', preferred_layout: 'Classroom', accessibility_needs: 'None',
      equipment_requirements: 'Projector', registration_needed: false,
      // SG2-70: every seeded event has a category, as every live one does.
      category: 'workshop',
      organisation: 'Regression Organisation', status: 'draft', coordinator_id: null
    };
    const venue = {
      venue_id: 1, name: 'Regression Hall', location: 'Level 1', capacity: 100,
      facilities: 'Projector and seating', accessibility_features: 'Step-free access',
      operating_information: '08:00–22:00'
    };
    this.tables = {
      users: accounts.map(account => ({
        user_id: `user-${account.key}`, name: `Regression ${account.key}`,
        organisation: account.key === 'unassigned' ? null : account.key === 'organiser2' ? 'Other Organisation' : 'Regression Organisation',
        phone: '+6581234567', communication_preferences: ['email'], department: 'Operations'
      })),
      account_roles: accounts.map(account => ({ user_id: `user-${account.key}`, role: account.role })),
      venue_booking_requests: [],
      venue_capacity_exceptions: [],
      venue_holds: [],
      venue_hold_notifications: [],
      notifications: [],
      notification_reminder_preferences: [],
      equipment_requests: [],
      equipment_reservations: [],
      // SG2-66: attendee registrations, counted when a change is assessed.
      registrations: [],
      // SG2-92: the Safety Officer's decisions, append-only.
      event_safety_decisions: [],
      // SG2-93: requests a Request Changes decision sent back to staff.
      safety_rereviews: [],
      equipment: [{ equipment_id: 1, name: 'Wireless microphones', description: 'Handheld wireless microphones',
        quantity_total: 20, location: 'Technical store', operational_status: 'operational', version: 1 }],
      events: [
        { ...draft, event_id: 1, organiser_id: 'user-organiser' },
        { ...draft, event_id: 2, organiser_id: 'user-organiser2', name: 'Other organisation draft', organisation: 'Other Organisation' }
      ],
      venues: [venue, { ...venue, venue_id: 2, name: 'Quiet Room', capacity: 20 }],
      venue_bookings: [
        { booking_id: 1, venue_id: 1, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z', status: 'confirmed', event_id: 1 },
        { booking_id: 2, venue_id: 1, starts_at: '2026-09-15T02:00:00.000Z', ends_at: '2026-09-15T04:00:00.000Z', status: 'confirmed', event_id: 1 }
      ],
      venue_unavailability: [
        { unavailability_id: 1, venue_id: 1, starts_at: '2030-06-16T02:00:00.000Z', ends_at: '2030-06-16T04:00:00.000Z', category: 'maintenance', reason: 'Scheduled maintenance', created_by: 'user-venue', created_at: '2026-09-26T01:00:00.000Z' }
      ],
      venue_layouts: [],
      venue_operations: [],
      venue_booking_clashes: [],
      // SG2-81: bookings a venue's unavailability affects; the browser journeys flag none.
      venue_booking_disruptions: [],
      event_clarifications: [],
      event_audit_logs: []
    };
  }

  seedWorkQueue() {
    const base = this.tables.events[0];
    this.tables.events.push(
      { ...base, event_id: 41, name: 'Sustainability Leadership Forum', status: 'submitted', purpose: 'Bring partners together to plan sustainable events', description: 'Keynotes, workshops and an evening reception.', expected_attendance: 80 },
      { ...base, event_id: 42, name: 'Partner Innovation Summit', status: 'planning', coordinator_id: 'user-coordinator' },
      { ...base, event_id: 43, name: 'Another coordinator’s event', status: 'under_review', coordinator_id: 'user-another' },
      { ...base, event_id: 44, name: 'Completed event', status: 'completed', coordinator_id: 'user-coordinator' },
    );
    const request = { request_id: 11, event_id: 41, starts_at: '2030-06-15T02:00:00Z', ends_at: '2030-06-15T10:00:00Z', status: 'pending', notes: 'Set up before guests arrive.' };
    this.tables.venue_booking_requests.push({ ...request, venue_id: 1 }, { ...request, request_id: 12, venue_id: 2, status: 'approved' });
    this.tables.equipment_requests.push({ ...request, equipment_id: 1, quantity: 4 }, { ...request, request_id: 12, equipment_id: 1, quantity: 1, status: 'rejected' });
  }

  /** SG2-35: a submitted request already assigned to the signed-in coordinator.
   * Seeded separately from seedWorkQueue so its queue counts stay unchanged. */
  /** SG2-37: a request this coordinator is already reviewing, ready to decide. */
  seedUnderReview() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 52, name: 'Decision Forum', status: 'under_review',
      coordinator_id: 'user-coordinator', purpose: 'Decide whether the forum proceeds',
      decided_by: null, decided_at: null, decision_reason: null,
    });
  }

  /** SG2-47: an approved event for 150 people needing a stage, a projector and
   * a hearing loop. Grand Ballroom fits; Lecture Theatre is only too small
   * (request 21 needs a capacity exception); Regression Hall also lacks a
   * stage (request 22 is blocked). Booking requests are seeded directly
   * because coordinators cannot raise them until SG2-48. */
  seedVenueSuitability() {
    const facilities = { location: 'Level 2', operating_information: '08:00–22:00', accessibility_features: 'Step-free, hearing loop' };
    this.tables.venues.push(
      { ...facilities, venue_id: 3, name: 'Lecture Theatre', capacity: 120, facilities: 'Stage, projector' },
      { ...facilities, venue_id: 4, name: 'Grand Ballroom', capacity: 300, facilities: 'Stage, projector, PA' }
    );
    this.tables.events.push({
      ...this.tables.events[0], event_id: 61, name: 'Suitability Forum', status: 'approved', coordinator_id: 'user-coordinator',
      expected_attendance: 150, venue_requirements: 'A stage and a projector', accessibility_needs: 'Needs a hearing loop'
    });
    const request = { event_id: 61, starts_at: '2030-06-17T02:00:00Z', ends_at: '2030-06-17T10:00:00Z', status: 'pending', notes: null };
    this.tables.venue_booking_requests.push({ ...request, request_id: 21, venue_id: 3 }, { ...request, request_id: 22, venue_id: 1 });
  }

  /** Capacity discovery lists pending requests, and booked ones whose live
   * event outgrew the venue (SG2-66 AC2), that still need a Venue Staff
   * exception. The colleague shares an organisation but is a different owner;
   * their request carries only an approval Technical Support recorded before
   * SG2-66, which no longer counts (SG2-66 AC5). */
  seedCapacityExceptions() {
    this.seedVenueSuitability();
    const event = this.tables.events.find(row => row.event_id === 61)!;
    const request = this.tables.venue_booking_requests.find(row => row.request_id === 21)!;
    this.tables.events.push(
      { ...event, event_id: 62, name: 'Colleague Capacity Forum', organiser_id: 'user-colleague' },
      { ...event, event_id: 63, name: 'Covered Capacity Forum' },
      { ...event, event_id: 64, name: 'Withdrawn Capacity Forum' },
      { ...event, event_id: 65, name: 'Adequate Capacity Forum', expected_attendance: 100 },
      { ...event, event_id: 66, name: 'Unknown Attendance Forum', expected_attendance: null },
      { ...event, event_id: 67, name: 'Booked Capacity Forum', status: 'confirmed', venue_booking_id: 67 }
    );
    this.tables.venue_bookings.push({ booking_id: 67, venue_id: 3, event_id: 67,
      starts_at: '2030-06-19T02:00:00Z', ends_at: '2030-06-19T10:00:00Z', status: 'confirmed' });
    this.tables.venue_booking_requests.push(
      { ...request, request_id: 23, event_id: 62, starts_at: '2030-06-18T02:00:00Z', ends_at: '2030-06-18T10:00:00Z' },
      { ...request, request_id: 24, event_id: 63 },
      { ...request, request_id: 25, event_id: 64, status: 'cancelled' },
      { ...request, request_id: 26, event_id: 65 },
      { ...request, request_id: 27, event_id: 66 },
      { ...request, request_id: 28, event_id: 67, status: 'approved', venue_booking_id: 67,
        starts_at: '2030-06-19T02:00:00Z', ends_at: '2030-06-19T10:00:00Z' }
    );
    this.tables.venue_capacity_exceptions.push(
      { exception_id: 1, request_id: 24, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 150,
        venue_capacity: 120, approved_at: '2026-10-01T02:00:00Z' },
      { exception_id: 2, request_id: 23, approved_by: 'user-support', approver_role: 'technical_support_staff', expected_attendance: 150,
        venue_capacity: 120, approved_at: '2026-10-01T03:00:00Z' },
      // Booked for 130 people; attendance has since risen to 150.
      { exception_id: 3, request_id: 28, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 130,
        venue_capacity: 120, approved_at: '2026-10-01T04:00:00Z' }
    );
  }

  /** SG2-33/34: an unassigned submitted request, plus a second coordinator
   * (no sign-in account needed) so a real reassignment can be made. */
  seedCoordinatorAssignment() {
    this.tables.users.push({
      user_id: 'user-coordinator2', name: 'Regression second coordinator', organisation: 'Regression Organisation',
      phone: null, communication_preferences: [], department: 'Operations'
    });
    this.tables.account_roles.push({ user_id: 'user-coordinator2', role: 'event_coordinator' });
    this.tables.events.push({
      ...this.tables.events[0], event_id: 71, name: 'Assignment Forum', status: 'submitted', coordinator_id: null
    });
  }

  /** SG2-89: two Leads and two coordinators. The signed-in Lead supervises
   * 201 (awaiting the organiser's clarification) and 202 (planning) and once
   * supervised 205 (completed, so no longer active); a second Lead, who can
   * sign in, supervises 203; 204 waits unassigned in the queue both share. */
  seedCoordinatorOversight() {
    this.seededAccounts.push({ key: 'lead2', email: 'lead2@example.test', role: 'event_coordinator_lead' });
    for (const [user_id, name, role] of [
      ['user-lead2', 'Regression second lead', 'event_coordinator_lead'],
      ['user-coordinator2', 'Regression second coordinator', 'event_coordinator']
    ]) {
      this.tables.users.push({ user_id, name, organisation: 'Regression Organisation', phone: null,
        communication_preferences: [], department: 'Operations' });
      this.tables.account_roles.push({ user_id, role });
    }
    const base = { ...this.tables.events[0], expected_attendance: 60 };
    const rows: [number, string, string, string | null, string | null, string][] = [
      [201, 'Clarification Forum', 'needs_clarification', 'user-coordinator', 'user-lead', '2030-07-01T02:00:00.000Z'],
      [202, 'Planning Forum', 'planning', 'user-coordinator2', 'user-lead', '2030-07-02T02:00:00.000Z'],
      [203, 'Other Lead Forum', 'approved', 'user-coordinator', 'user-lead2', '2030-07-03T02:00:00.000Z'],
      [204, 'Queued Forum', 'unassigned', null, null, '2030-07-04T02:00:00.000Z'],
      [205, 'Finished Forum', 'completed', 'user-coordinator', 'user-lead', '2030-05-01T02:00:00.000Z']
    ];
    for (const [event_id, name, status, coordinator_id, coordinator_assigned_by, proposed_date] of rows) {
      this.tables.events.push({ ...base, event_id, name, status, coordinator_id, coordinator_assigned_by, proposed_date,
        submitted_at: '2026-10-20T02:00:00.000Z' });
    }
  }

  /** SG2-90: events in every state a coordinator can act on, for each
   * assignment state they can meet. Status matters: review and decision also
   * guard on status, so each assignment guard needs an event that is otherwise
   * actionable. Ids: 81 approved, 88/90 submitted, 89/91 under review are the
   * signed-in coordinator's own; 82-87 are approved/submitted/under review
   * pairs assigned to a second coordinator (no sign-in account) and unassigned. */
  seedCoordinatorAccess() {
    this.tables.users.push({
      user_id: 'user-coordinator2', name: 'Regression second coordinator', organisation: 'Regression Organisation',
      phone: null, communication_preferences: [], department: 'Operations'
    });
    this.tables.account_roles.push({ user_id: 'user-coordinator2', role: 'event_coordinator' });
    const base = { ...this.tables.events[0], proposed_date: '2030-06-20T02:00:00.000Z',
      expected_attendance: 80, venue_requirements: 'A projector' };
    const own = 'user-coordinator', other = 'user-coordinator2';
    const rows: [number, string, string, string | null][] = [
      [81, 'Own Forum', 'approved', own], [82, 'Colleague Forum', 'approved', other], [83, 'Queued Forum', 'approved', null],
      [84, 'Colleague Review', 'submitted', other], [85, 'Queued Review', 'submitted', null],
      [86, 'Colleague Decision', 'under_review', other], [87, 'Queued Decision', 'under_review', null],
      [88, 'Own Review', 'submitted', own], [89, 'Own Decision', 'under_review', own],
      [90, 'Handover Review', 'submitted', own], [91, 'Handover Decision', 'under_review', own]
    ];
    for (const [event_id, name, status, coordinator_id] of rows) {
      this.tables.events.push({ ...base, event_id, name, status, coordinator_id });
    }
    this.tables.venue_layouts.push({ venue_id: 1, layout: 'theatre', other_description: null });
  }

  /** SG2-97: an approved event whose coordinator was assigned by Technical
   * Support Staff before assignment moved to the Event Coordinator Lead, with
   * the history row that assignment wrote. */
  seedLegacyAssignment() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 95, name: 'Legacy Forum', status: 'approved', coordinator_id: 'user-coordinator'
    });
    this.tables.event_audit_logs.push({
      log_id: 1, event_id: 95, actor_id: 'user-support', field_name: 'coordinator_id',
      old_value: null, new_value: 'Regression coordinator', created_at: '2026-10-01T02:00:00.000Z'
    });
  }

  /** SG2-48: an approved event assigned to the coordinator, for 80 people
   * needing a projector on 20 June 2030, when both venues are free. Regression
   * Hall offers theatre and classroom layouts; Quiet Room a boardroom. */
  seedVenueRequest() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 91, name: 'Venue Request Forum', status: 'approved', coordinator_id: 'user-coordinator',
      proposed_date: '2030-06-20T02:00:00.000Z', expected_attendance: 80, venue_requirements: 'A projector'
    });
    this.tables.venue_layouts.push(
      { venue_id: 1, layout: 'theatre', other_description: null },
      { venue_id: 1, layout: 'classroom', other_description: null },
      { venue_id: 2, layout: 'boardroom', other_description: null }
    );
  }

  /** SG2-82: on top of seedVenueRequest, a third venue that fits event 91
   * (80 guests, a projector), so the event can need several venues at once:
   * Regression Hall and Breakout Studio fit; Quiet Room is too small. */
  seedVenueMultiple() {
    this.seedVenueRequest();
    this.tables.venues.push({ venue_id: 5, name: 'Breakout Studio', location: 'Level 3', capacity: 100, facilities: 'Projector, whiteboards',
      operating_information: '08:00–22:00', accessibility_features: 'Step-free' });
    this.tables.venue_layouts.push({ venue_id: 5, layout: 'classroom', other_description: null });
  }

  /** SG2-51: on top of seedVenueRequest, event 91 holds both venues on 20 June
   * 2030, 10:00-12:00 SGT (Week 7 change #3: one event, several venues). */
  /** SG2-78: setup plus turnaround (SG2-77) that bookings at the venue keep
   * between them; 0 when the venue has no times recorded. */
  preparationGapMinutes(venueId: unknown): number {
    const times = this.tables.venue_operations.find(row => row.venue_id === venueId);
    return times ? Number(times.setup_minutes) + Number(times.turnaround_minutes) : 0;
  }

  /** SG2-79: test equivalent of refresh_venue_booking_clashes(). Flags pairs
   * of confirmed bookings closer together than setup plus turnaround, clears
   * pairs that no longer clash, and tells each affected event's coordinator
   * about a new flag. The SQL suite carries the trigger and locking evidence. */
  refreshVenueClashes(venueId: unknown) {
    const gap = this.preparationGapMinutes(venueId) * 60_000;
    const confirmed = this.tables.venue_bookings.filter(row => row.venue_id === venueId && row.status === 'confirmed');
    const clash = (a: Row, b: Row) => Date.parse(String(a.starts_at)) < Date.parse(String(b.ends_at)) + gap
      && Date.parse(String(a.ends_at)) > Date.parse(String(b.starts_at)) - gap;
    const pairs: [Row, Row][] = [];
    for (const a of confirmed) {
      for (const b of confirmed) if (Number(a.booking_id) < Number(b.booking_id) && clash(a, b)) pairs.push([a, b]);
    }
    const flagged = (a: Row, b: Row) => (row: Row) => row.booking_id === a.booking_id && row.other_booking_id === b.booking_id;
    this.tables.venue_booking_clashes = this.tables.venue_booking_clashes
      .filter(row => row.venue_id !== venueId || pairs.some(([a, b]) => flagged(a, b)(row)));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sgt = (iso: unknown) => {
      const at = new Date(Date.parse(String(iso)) + 8 * 3600_000);
      return `${String(at.getUTCDate()).padStart(2, '0')} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()} ${at.toISOString().slice(11, 16)}`;
    };
    const venue = this.tables.venues.find(row => row.venue_id === venueId);
    for (const [a, b] of pairs) {
      if (this.tables.venue_booking_clashes.some(flagged(a, b))) continue;
      const now = new Date().toISOString();
      this.tables.venue_booking_clashes.push({ booking_id: a.booking_id, other_booking_id: b.booking_id, venue_id: venueId, flagged_at: now });
      for (const [own, other] of [[a, b], [b, a]]) {
        const event = this.tables.events.find(row => row.event_id === own.event_id);
        if (!event?.coordinator_id) continue;
        const otherEvent = this.tables.events.find(row => row.event_id === other.event_id);
        const otherName = otherEvent?.coordinator_id === event.coordinator_id ? otherEvent.name || 'Untitled event' : 'another event';
        this.tables.notifications.push({ notification_id: Math.max(0, ...this.tables.notifications.map(row => Number(row.notification_id))) + 1,
          recipient_id: event.coordinator_id, event_id: event.event_id, request_id: null, kind: 'venue_booking_clash',
          message: `${venue?.name}: ${event.name || 'Untitled event'} (${sgt(own.starts_at)} – ${sgt(own.ends_at)} SGT) now clashes with ${otherName} `
            + `(${sgt(other.starts_at)} – ${sgt(other.ends_at)} SGT) once setup and turnaround time are included. Neither booking has been changed.`,
          created_at: now });
      }
    }
  }

  /** SG2-83: test equivalent of the venue_change_requested() trigger. The
   * change and its reason go in the history, Venue Staff are told, and a
   * Confirmed or Preparation event returns to Planning (AC4/AC7). */
  recordVenueChange(request: Row) {
    const event = this.tables.events.find(row => row.event_id === request.event_id)!;
    const booking = this.tables.venue_bookings.find(row => row.booking_id === request.replaces_booking_id)!;
    const name = (venueId: unknown) => this.tables.venues.find(row => row.venue_id === venueId)?.name;
    const now = new Date().toISOString();
    const log = (field: string, oldValue: string, newValue: string) => this.tables.event_audit_logs.push({
      log_id: Math.max(0, ...this.tables.event_audit_logs.map(row => Number(row.log_id))) + 1, event_id: event.event_id,
      actor_id: request.requested_by, field_name: field, old_value: oldValue, new_value: newValue, created_at: now });
    const reason = request.change_reason ? ` — ${request.change_reason}` : '';
    log('venue_booking', `Confirmed: ${name(booking.venue_id)} (booking ${booking.booking_id})`,
      `Change requested: ${name(booking.venue_id)} (booking ${booking.booking_id}) to ${name(request.venue_id)} (request ${request.request_id})${reason}`);
    for (const staff of this.tables.account_roles.filter(row => row.role === 'venue_staff' && row.user_id !== request.requested_by)) {
      this.tables.notifications.push({ notification_id: Math.max(0, ...this.tables.notifications.map(row => Number(row.notification_id))) + 1,
        recipient_id: staff.user_id, event_id: event.event_id, request_id: null, kind: 'venue_change_requested',
        message: `A change is requested for ${event.name || 'Untitled event'}: ${name(booking.venue_id)} (booking ${booking.booking_id}) to `
          + `${name(request.venue_id)}${request.change_reason ? `: ${request.change_reason}` : ''}. The current booking stays until the change is approved.`,
        created_at: now });
    }
    if (event.status === 'confirmed' || event.status === 'preparation') {
      log('status', String(event.status), 'planning');
      Object.assign(event, { status: 'planning', confirmed_by: null, confirmed_at: null });
    }
  }

  /** SG2-79: on top of seedVenueRequest, event 91 holds Regression Hall from
   * 12:30 to 13:30 SGT on 15 Jun 2030, 30 minutes after booking #1 ends. */
  seedVenueClash() {
    this.seedVenueRequest();
    this.tables.venue_bookings.push(
      { booking_id: 31, venue_id: 1, event_id: 91, starts_at: '2030-06-15T04:30:00.000Z', ends_at: '2030-06-15T05:30:00.000Z', status: 'confirmed' }
    );
  }

  seedVenueRelease() {
    this.seedVenueRequest();
    this.tables.venue_bookings.push(
      { booking_id: 21, venue_id: 1, event_id: 91, starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T04:00:00.000Z', status: 'confirmed' },
      { booking_id: 22, venue_id: 2, event_id: 91, starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T04:00:00.000Z', status: 'confirmed' }
    );
    this.tables.events.find(event => event.event_id === 91)!.venue_booking_id = 21;
    // The approved SG2-49 request that committed booking #21.
    this.tables.venue_booking_requests.push({ request_id: 31, event_id: 91, venue_id: 1, starts_at: '2030-06-20T02:00:00.000Z',
      ends_at: '2030-06-20T04:00:00.000Z', status: 'approved', layout: 'theatre', venue_requirements: 'A projector', notes: null,
      requested_by: 'user-coordinator', requested_at: '2030-01-01T00:00:00.000Z', decided_by: 'user-venue',
      decided_at: '2030-01-02T00:00:00.000Z', decision_reason: null, venue_booking_id: 21 });
  }

  /** SG2-83: on top of seedVenueRelease, Breakout Studio is free on 20 June,
   * so one of event 91's two venues can be changed to it. */
  seedVenueChange() {
    this.seedVenueRelease();
    this.tables.venues.push({ venue_id: 5, name: 'Breakout Studio', location: 'Level 3', capacity: 100, facilities: 'Projector, whiteboards',
      operating_information: '08:00–22:00', accessibility_features: 'Step-free' });
    this.tables.venue_layouts.push({ venue_id: 5, layout: 'theatre', other_description: null });
  }

  /** SG2-49: on top of seedVenueRequest, four pending requests from event 91's
   * coordinator. 101 is clear to approve and 102 to reject; Quiet Room (103)
   * is too small for 80 guests; 104 overlaps Regression Hall's confirmed
   * booking for the Planning workshop on 15 June. */
  seedVenueDecision() {
    this.seedVenueRequest();
    const request = { event_id: 91, status: 'pending', notes: null, venue_requirements: 'A projector', requested_by: 'user-coordinator',
      requested_at: '2030-01-01T00:00:00.000Z', decided_by: null, decided_at: null, decision_reason: null, venue_booking_id: null };
    this.tables.venue_booking_requests.push(
      { ...request, request_id: 101, venue_id: 1, layout: 'theatre', starts_at: '2030-06-20T01:00:00.000Z', ends_at: '2030-06-20T04:00:00.000Z' },
      { ...request, request_id: 102, venue_id: 1, layout: 'classroom', starts_at: '2030-06-21T01:00:00.000Z', ends_at: '2030-06-21T04:00:00.000Z' },
      { ...request, request_id: 103, venue_id: 2, layout: 'boardroom', starts_at: '2030-06-20T01:00:00.000Z', ends_at: '2030-06-20T04:00:00.000Z' },
      { ...request, request_id: 104, venue_id: 1, layout: 'theatre', starts_at: '2030-06-15T03:00:00.000Z', ends_at: '2030-06-15T05:00:00.000Z' }
    );
  }

  seedAssignedReview() {
    this.tables.events.push({
      ...this.tables.events[0], event_id: 51, name: 'Assigned Review Forum', status: 'submitted',
      coordinator_id: 'user-coordinator', purpose: 'Decide whether the forum proceeds',
    });
  }

  /** SG2-100 AC4/AC6/AC7: the two ends of the Week 7 lifecycle Mark Completed
   * acts on. 120 is confirmed, assigned to the signed-in coordinator, with
   * its only confirmed booking already in the past — ready to be marked
   * completed. 121 is the same shape but its booking is still ahead of the
   * fixture clock, which is what proves the action is withheld rather than
   * refused after the fact. */
  seedLifecycle() {
    this.tables.events.push(
      { ...this.tables.events[0], event_id: 120, name: 'Held Forum', status: 'confirmed', coordinator_id: 'user-coordinator' },
      { ...this.tables.events[0], event_id: 121, name: 'Future Forum', status: 'confirmed', coordinator_id: 'user-coordinator' },
    );
    this.tables.venue_bookings.push(
      { booking_id: 120, venue_id: 1, event_id: 120, starts_at: '2026-09-20T02:00:00.000Z', ends_at: '2026-09-20T10:00:00.000Z', status: 'confirmed' },
      { booking_id: 121, venue_id: 1, event_id: 121, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'confirmed' },
    );
  }

  /** Test equivalent of the SQL view; SQL policy tests exercise the real view.
   * SG2-100 widened both status lists: `unassigned` joins the review bucket
   * (submission now lands there, not `submitted`), and the awaiting-coordinator
   * bucket grows to `awaiting_safety_check`, `safety_rejected` and
   * `preparation` so an event does not vanish from its own coordinator's list
   * partway through the Week 7 lifecycle. `completed`/`cancelled` stay out of
   * both, same as the real view. */
  /** The view's event end time: the latest confirmed venue booking, or null. */
  private eventEndsAt(eventId: unknown): string | null {
    let latest: string | null = null;
    for (const booking of this.tables.venue_bookings) {
      if (booking.event_id !== eventId || booking.status !== 'confirmed') continue;
      if (latest === null || Date.parse(String(booking.ends_at)) > Date.parse(latest)) latest = String(booking.ends_at);
    }
    return latest;
  }

  private workItems(): Row[] {
    // SG2-89 AC6: an event awaiting clarification stays in its coordinator's queue.
    const REVIEW_STATUSES = ['unassigned', 'submitted', 'under_review', 'needs_clarification'];
    const ASSIGNED_STATUSES = ['approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'];
    const active = this.tables.events.filter(event => [...REVIEW_STATUSES, ...ASSIGNED_STATUSES].includes(String(event.status)));
    const items = active.filter(event => REVIEW_STATUSES.includes(String(event.status)) || event.coordinator_id !== null).map(event => ({
      kind: 'event', item_id: event.event_id, event_id: event.event_id, title: event.name || 'Untitled event', event_name: event.name || 'Untitled event',
      status: event.status, starts_at: event.proposed_date, ends_at: this.eventEndsAt(event.event_id), audience: 'event_coordinator', assigned_to: event.coordinator_id,
      category: REVIEW_STATUSES.includes(String(event.status)) ? 'review' : 'assigned',
      details: Object.fromEntries(['organisation', 'purpose', 'description', 'expected_attendance', 'venue_requirements', 'preferred_layout', 'accessibility_needs', 'equipment_requirements', 'registration_needed', 'registration_capacity', 'registration_opens_at', 'registration_closes_at', 'planning_notes', 'expected_crowd_movement'].map(key => [key, event[key]])),
    } as Row));
    for (const [table, kind, resourceTable, resourceKey, audience] of [
      ['venue_booking_requests', 'venue', 'venues', 'venue_id', 'venue_staff'],
      ['equipment_requests', 'equipment', 'equipment', 'equipment_id', 'technical_support_staff'],
    ]) {
      for (const request of this.tables[table]) {
        const event = active.find(event => event.event_id === request.event_id);
        const reservedRequest = kind === 'equipment' && request.status === 'approved'
          && this.tables.equipment_reservations.some(row => row.request_id === request.request_id);
        if ((request.status !== 'pending' && !reservedRequest) || !event) continue;
        const resource = this.tables[resourceTable].find(resource => resource[resourceKey] === request[resourceKey])!;
        items.push({ kind, item_id: request.request_id, event_id: event.event_id, title: resource.name,
          event_name: event.name || 'Untitled event', status: request.status, starts_at: request.starts_at ?? event.proposed_date, ends_at: request.ends_at,
          audience, assigned_to: null, category: kind, details: kind === 'venue'
            ? { location: resource.location, capacity: resource.capacity, expected_attendance: event.expected_attendance,
              venue_requirements: request.venue_requirements ?? event.venue_requirements, accessibility_needs: event.accessibility_needs, notes: request.notes,
              // SG2-48 AC2: the layout and requester, as the SQL view adds them.
              layout: request.layout ?? null, requested_by: this.tables.users.find(user => user.user_id === request.requested_by)?.name ?? null,
              // SG2-49: requests created by a tentative hold are decided through the hold.
              hold_id: this.tables.venue_holds.find(hold => hold.request_id === request.request_id)?.hold_id ?? null }
            : { quantity: request.quantity, equipment_requirements: event.equipment_requirements, notes: request.notes } });
      }
    }
    return items;
  }

  async principal(token: string) {
    const userId = this.sessions.get(token);
    if (!userId) throw new AccessError(401);
    // SG2-104: every role the account holds, and the one this request acts as
    // (like public.acting_role(): the header's role if held, else the default).
    const roles = orderRoles(this.tables.account_roles.filter(row => row.user_id === userId).map(row => row.role as Role));
    if (roles.length === 0) throw new AccessError(403);
    const acting = currentActingRole();
    const role = acting && roles.includes(acting) ? acting : selectActingRole(roles, []);
    return { userId, role, roles };
  }

  readonly client = {
    // Test equivalent of the atomic draft-save RPC. Native integration tests
    // exercise the real SQL lock, permissions and rollback independently.
    rpc: async (name: string, args: { p_event_id: number; p_actor_id: string; p_values: unknown }) => {
      if (name !== 'update_event_request_draft') throw new Error(`Unsupported fixture RPC: ${name}`);
      const result = (data: Row) => ({ data, error: null });
      const actor = this.tables.users.find(row => row.user_id === args.p_actor_id);
      const role = this.tables.account_roles.find(row => row.user_id === args.p_actor_id)?.role;
      const event = this.tables.events.find(row => row.event_id === args.p_event_id && row.organiser_id === args.p_actor_id);
      if (!actor || role !== 'event_organiser' || !event || !actor.organisation || actor.organisation !== event.organisation) {
        return result({ outcome: 'not_found' });
      }
      if (!['draft', 'needs_clarification'].includes(String(event.status))) return result({ outcome: 'not_editable' });
      const validated = validateDraftInput(args.p_values);
      if (!validated.valid) return result({ outcome: 'invalid' });
      const serialized = (key: string, value: unknown) => value === null || value === undefined ? null
        : key === 'proposed_date' ? new Date(String(value)).toISOString() : String(value);
      const changed = DRAFT_FIELDS.filter(key => serialized(key, event[key]) !== serialized(key, validated.values[key]));
      const createdAt = new Date().toISOString();
      let logId = Math.max(0, ...this.tables.event_audit_logs.map(row => Number(row.log_id)));
      const audit = changed.map(key => ({ log_id: ++logId, event_id: event.event_id, actor_id: args.p_actor_id,
        field_name: key, old_value: serialized(key, event[key]), new_value: serialized(key, validated.values[key]), created_at: createdAt }));
      Object.assign(event, validated.values);
      this.tables.event_audit_logs.push(...audit);
      const columns = ['event_id', 'organiser_id', 'organisation', 'status', ...DRAFT_FIELDS];
      return result({ outcome: 'updated', request: Object.fromEntries(columns.map(key => [key, event[key] ?? null])) });
    },
    from: (table: string) => {
      if (table === 'internal_work_items') this.tables[table] = this.workItems();
      if (table === 'venue_booking_occupancy') this.tables[table] = [
        // SG2-51: released bookings no longer occupy the venue.
        ...this.tables.venue_bookings.filter(booking => booking.status === 'held' || booking.status === 'confirmed'),
        ...this.tables.venue_holds.filter(hold => hold.status === 'tentative' && Date.parse(String(hold.expires_at)) > this.venueHoldNow())
          .map(hold => ({ venue_id: hold.venue_id, event_id: hold.event_id, starts_at: hold.starts_at, ends_at: hold.ends_at, status: 'tentative' })),
      ];
      // SG2-80: confirmed bookings inside a period the venue is marked unavailable for.
      if (table === 'venue_affected_bookings') this.tables[table] = this.tables.venue_bookings.filter(booking =>
        booking.status === 'confirmed' && this.tables.venue_unavailability.some(period => period.venue_id === booking.venue_id
          && String(period.starts_at) < String(booking.ends_at) && String(period.ends_at) > String(booking.starts_at)));
      if (!(table in this.tables)) throw new Error(`Unsupported fixture table: ${table}`);
      return new MemoryQuery(this, table);
    },
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const account = [...accounts, ...this.seededAccounts].find(account => account.email === email && password === TEST_PASSWORD);
        if (!account) return { data: null, error: { message: 'Invalid credentials' } };
        const token = `regression-${account.key}-${++this.sessionSequence}`;
        this.sessions.set(token, `user-${account.key}`);
        return { data: { session: { access_token: token }, user: { id: `user-${account.key}`, email } }, error: null };
      },
      admin: {
        signOut: async (token: string) => {
          this.sessions.delete(token);
          return { error: null };
        }
      }
    }
  } as unknown as SupabaseClient;
}

class MemoryQuery implements PromiseLike<QueryResult> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { key: string; ascending: boolean }[] = [];
  private columns = '*';
  private operation: 'read' | 'insert' | 'update' | 'delete' = 'read';
  private values: Row | Row[] = {};
  private single = false;
  private window?: [number, number];
  private execution?: Promise<QueryResult>;

  constructor(private database: MemoryDatabase, private table: string) {}
  select(columns = '*') { this.columns = columns; return this; }
  eq(key: string, value: unknown) {
    this.filters.push(row => {
      const [alias, field, extra] = key.split('.');
      if (field === undefined) return row[key] === value;
      if (extra !== undefined) throw new Error(`Unsupported fixture filter: ${key}`);
      const related = this.relation(row, alias, alias === 'event' ? 'events' : alias === 'venue' ? 'venues' : '');
      if (Array.isArray(related)) throw new Error(`Unsupported fixture array filter: ${key}`);
      return related?.[field] === value;
    });
    return this;
  }
  // A column a fixture row never set is undefined, not null — but Postgres
  // has no "undefined", so `.is(column, null)` has to match it too. A fresh
  // draft created through the API carries no coordinator_id key at all.
  is(key: string, value: null) { this.filters.push(row => (row[key] ?? null) === value); return this; }
  not(key: string, operator: 'is', value: null) { this.filters.push(row => (row[key] ?? null) !== value); return this; }
  range(start: number, end: number) { this.window = [start, end]; return this; }
  limit(count: number) { this.window = [0, count - 1]; return this; }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
  lt(key: string, value: string | number) { this.filters.push(row => (row[key] as string | number) < value); return this; }
  gt(key: string, value: string | number) { this.filters.push(row => (row[key] as string | number) > value); return this; }
  order(key: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ key, ascending: options.ascending !== false }); return this;
  }
  insert(values: Row | Row[]) { this.operation = 'insert'; this.values = values; return this; }
  update(values: Row) { this.operation = 'update'; this.values = values; return this; }
  delete() { this.operation = 'delete'; return this; }
  maybeSingle() { this.single = true; return this; }

  private columnsAtLevel(columns: string) {
    const result: string[] = [];
    let depth = 0, start = 0;
    for (let index = 0; index < columns.length; index++) {
      if (columns[index] === '(') depth++;
      else if (columns[index] === ')') depth--;
      else if (columns[index] === ',' && depth === 0) {
        result.push(columns.slice(start, index).trim()); start = index + 1;
      }
      if (depth < 0) throw new Error('Unbalanced fixture projection');
    }
    if (depth !== 0) throw new Error('Unbalanced fixture projection');
    result.push(columns.slice(start).trim());
    return result;
  }

  private relation(row: Row, alias: string, table: string): Row | Row[] | null {
    if (table === 'users' && ['coordinator', 'actor', 'sender', 'organiser'].includes(alias)) {
      return this.database.tables.users.find(user => user.user_id === row[`${alias}_id`]) ?? null;
    }
    if (this.table === 'venue_booking_requests') {
      if (alias === 'event' && table === 'events') return this.database.tables.events.find(event => event.event_id === row.event_id) ?? null;
      if (alias === 'venue' && table === 'venues') return this.database.tables.venues.find(venue => venue.venue_id === row.venue_id) ?? null;
      if (alias === 'exceptions' && table === 'venue_capacity_exceptions') {
        return this.database.tables.venue_capacity_exceptions.filter(exception => exception.request_id === row.request_id);
      }
      // SG2-66 AC2: the booking an approved request holds.
      if (alias === 'venue_booking' && table === 'venue_bookings') {
        return this.database.tables.venue_bookings.find(booking => booking.booking_id === row.venue_booking_id) ?? null;
      }
    }
    throw new Error(`Unsupported fixture relation: ${alias}:${table}`);
  }

  private embed(column: string) {
    return /^(\w+):(\w+)((?:!\w+)*)\((.*)\)$/.exec(column);
  }

  private project(row: Row, columns: string): Row {
    if (columns === '*') return structuredClone(row);
    return Object.fromEntries(this.columnsAtLevel(columns).map(column => {
      const embed = this.embed(column);
      if (embed) {
        const [, alias, table, , fields] = embed;
        const related = this.relation(row, alias, table);
        return [alias, Array.isArray(related) ? related.map(item => this.project(item, fields)) : related ? this.project(related, fields) : null];
      }
      if (column.includes(':')) throw new Error(`Unsupported fixture projection: ${column}`);
      return [column, structuredClone(row[column] ?? null)];
    }));
  }

  private execute(): QueryResult {
    const table = this.database.tables[this.table];
    const inner = this.columnsAtLevel(this.columns).flatMap(column => {
      const embed = this.embed(column);
      return embed?.[3].split('!').includes('inner') ? [embed] : [];
    });
    let rows = table.filter(row => this.filters.every(filter => filter(row)) && inner.every(([, alias, target]) => {
      const related = this.relation(row, alias, target);
      return Array.isArray(related) ? related.length > 0 : related !== null;
    }));
    if (this.operation === 'insert') {
      const incoming = Array.isArray(this.values) ? this.values : [this.values];
      const id = { events: 'event_id', venues: 'venue_id', venue_unavailability: 'unavailability_id',
        event_clarifications: 'clarification_id', event_audit_logs: 'log_id', venue_capacity_exceptions: 'exception_id',
        venue_booking_requests: 'request_id', notifications: 'notification_id' }[this.table];
      let nextId = id ? Math.max(0, ...table.map(row => Number(row[id]))) + 1 : 0;
      rows = incoming.map(value => {
        const row = structuredClone(value);
        if (id) row[id] = nextId++;
        if (['event_clarifications', 'event_audit_logs', 'notifications'].includes(this.table)) row.created_at ??= new Date().toISOString();
        if (this.table === 'venue_capacity_exceptions') row.approved_at ??= new Date().toISOString();
        // SG2-68: event notices carry no venue request.
        if (this.table === 'notifications') row.request_id ??= null;
        // SG2-48: the column defaults a new venue request takes.
        if (this.table === 'venue_booking_requests') { row.status ??= 'pending'; row.requested_at ??= new Date().toISOString(); }
        table.push(row);
        if (this.table === 'venue_booking_requests' && row.replaces_booking_id) this.database.recordVenueChange(row);
        return row;
      });
    } else if (this.operation === 'update') {
      rows.forEach(row => Object.assign(row, structuredClone(this.values as Row)));
    } else if (this.operation === 'delete') {
      this.database.tables[this.table] = table.filter(row => !rows.includes(row));
    }
    rows.sort((a, b) => {
      for (const { key, ascending } of this.orders) {
        const left = a[key] as string | number, right = b[key] as string | number;
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    const projected = rows.map(row => this.project(row, this.columns));
    if (this.single && projected.length > 1) throw new Error('Fixture query expected at most one row');
    return { data: this.single ? projected[0] ?? null : projected, error: null, status: 200 };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.execution ??= Promise.resolve().then(() => this.execute());
    return this.execution.then(onfulfilled, onrejected);
  }
}

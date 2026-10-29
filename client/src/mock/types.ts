/** Domain and navigation types shared across the mockup screens. */

export const ROLES = [
  'Event Organiser',
  'Event Coordinator',
  'Venue Staff',
  'Technical Support Staff',
  'Attendee',
  'Event Coordinator Lead',
  'Safety Officer',
] as const;

export type Role = (typeof ROLES)[number];

/** SG2-86: narrows an arbitrary server role string to the known client union. */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export type Screen =
  | 'landing'
  | 'login'
  | 'dashboard'
  | 'events'
  | 'detail'
  | 'notificationEvent'
  | 'notificationWork'
  | 'form'
  | 'venues'
  | 'calendar'
  | 'holds'
  | 'capacityExceptions'
  | 'equipment'
  | 'drafts'
  | 'editDraft'
  | 'profile'
  | 'assign'
  | 'queue'
  // SG2-89: the Lead's overview of the events they supervise.
  | 'overview'
  | 'safetyChecks'
  | 'search'
  // SG2-70: find an event across the system.
  | 'findEvent'
  // SG2-59: an attendee finds events open for registration.
  | 'findEvents'
  // SG2-62: an attendee sees and withdraws their registrations.
  | 'myRegistrations';

/** Signed-in screens other than the dashboard, which has its own headings. */
export type ContentScreen = Exclude<Screen, 'landing' | 'login' | 'dashboard'>;

export interface Stat {
  value: string;
  label: string;
}

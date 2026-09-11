/** Domain and navigation types shared across the mockup screens. */

export const ROLES = [
  'Event Organiser',
  'Event Coordinator',
  'Venue Staff',
  'Technical Support Staff',
  'Attendee',
] as const;

export type Role = (typeof ROLES)[number];

export type Screen =
  | 'landing'
  | 'login'
  | 'dashboard'
  | 'events'
  | 'detail'
  | 'form'
  | 'venues'
  | 'calendar'
  | 'booking'
  | 'equipment'
  | 'attendee'
  | 'change';

export type ProtectedScreen = Exclude<Screen, 'landing' | 'login'>;

/** Signed-in screens other than the dashboard, which has its own headings. */
export type ContentScreen = Exclude<Screen, 'landing' | 'login' | 'dashboard'>;

export type EventStatus =
  | 'Draft'
  | 'Under review'
  | 'Planning'
  | 'Approved'
  | 'Confirmed'
  | 'Rejected';

export interface EventRecord {
  ref: string;
  name: string;
  client: string;
  status: string;
  date: string;
  venue: string;
  attendance: number;
  coordinator: string;
  purpose: string;
}

/** An event decorated for display: badge colours plus role-specific copy. */
export interface EventCard extends EventRecord {
  badgeBg: string;
  badgeFg: string;
  meta: string;
  next: string;
}

export interface Venue {
  name: string;
  capacity: number;
  meta: string;
  tags: string[];
  fit: string;
  /** 1 = suitable, 0 = unsuitable, 2 = needs a check. */
  suitability: 0 | 1 | 2;
}

export interface EquipmentRequest {
  item: string;
  event: string;
  qty: string;
  window: string;
  avail: string;
  /** 1 = available, 0 = short, 2 = already reserved. */
  status: 0 | 1 | 2;
}

export interface Notification {
  title: string;
  body: string;
  when: string;
  dot: string;
}

export interface ActionItem {
  title: string;
  body: string;
  dot: string;
  screen: ProtectedScreen;
}

export interface Stat {
  value: string;
  label: string;
}

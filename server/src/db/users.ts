export const VALID_ROLE_NAMES = [
  'Event Organiser',
  'Event Coordinator',
  'Venue Staff',
  'Technical Support Staff',
  'Attendee',
  'Event Coordinator Lead',
  'Safety Officer'
] as const;

export type RoleName = (typeof VALID_ROLE_NAMES)[number];

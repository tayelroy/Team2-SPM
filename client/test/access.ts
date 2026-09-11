import type { Role } from '../src/mock/types';
import type { Access } from '../src/auth/access';

// Independent expected grants, shared by UI fixtures (not production policy).
const grants: Record<Role, string[]> = {
  'Event Organiser': ['page.dashboard', 'page.detail', 'page.change', 'event_request.create', 'event_request.change'],
  'Event Coordinator': ['page.dashboard', 'page.events', 'page.detail', 'page.venues', 'page.calendar', 'page.booking', 'page.equipment', 'page.change', 'event_request.review', 'venue_booking.request'],
  'Venue Staff': ['page.dashboard', 'page.venues', 'page.calendar', 'page.booking', 'venue_booking.decide'],
  'Technical Support Staff': ['page.dashboard', 'page.calendar', 'page.equipment', 'equipment.reserve', 'users.role.update'],
  Attendee: ['page.dashboard', 'page.attendee', 'event_registration.manage']
};
export function accessFor(role: Role): Access {
  return { userId: 'user-1', role: role.toLowerCase().replace(/ /g, '_'), permissions: [...grants[role]] };
}

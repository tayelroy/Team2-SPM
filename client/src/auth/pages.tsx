import { createContext, useContext } from 'react';
import type { Access } from './access';
import { can } from './access';
import type { Role, Screen } from '../mock/types';

export const PAGE_PERMISSIONS = {
  dashboard: 'page.dashboard', events: 'page.events', detail: 'page.detail',
  form: 'event_request.create', venues: 'page.venues', calendar: 'page.calendar',
  booking: 'page.booking', equipment: 'page.equipment', attendee: 'page.attendee',
  change: 'page.change'
} as const;
export type ProtectedScreen = keyof typeof PAGE_PERMISSIONS;

export function isProtectedScreen(value: string): value is ProtectedScreen {
  return Object.prototype.hasOwnProperty.call(PAGE_PERMISSIONS, value);
}

export function canOpen(access: Access | null, screen: Screen): boolean {
  return isProtectedScreen(screen) && can(access, PAGE_PERMISSIONS[screen]);
}

const ROLE_LABELS: Record<string, Role> = {
  event_organiser: 'Event Organiser', event_coordinator: 'Event Coordinator',
  venue_staff: 'Venue Staff', technical_support_staff: 'Technical Support Staff', attendee: 'Attendee'
};

export function roleLabel(role: string): Role | undefined {
  return Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role] : undefined;
}

export const PageAccess = createContext<{
  access: Access | null;
  run: (permission: string, action: () => void) => void;
} | null>(null);

export function usePageAccess() {
  const context = useContext(PageAccess);
  if (!context) throw new Error('Protected controls require PageAccess');
  return context;
}

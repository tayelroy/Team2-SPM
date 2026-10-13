import type { MemoryDatabase } from './memory-database';

/**
 * SG2-68 events, all organised by `organiser` and built from the complete
 * Planning workshop draft so they pass submission checks:
 * - 681 Notice Forum: a draft, ready to submit, with no coordinator.
 * - 682 Question Forum: under review by the signed-in coordinator.
 * - 683 Rejection Forum: under review by the signed-in coordinator.
 * Plus a second coordinator (no sign-in account) to assign and reassign to,
 * so the signed-in coordinator can be the unrelated one.
 */
export function seedEventNotifications(database: MemoryDatabase) {
  const { events, users, account_roles: roles } = database.tables;
  users.push({ user_id: 'user-coordinator2', name: 'Regression second coordinator', organisation: 'Regression Organisation',
    phone: null, communication_preferences: [], department: 'Operations' });
  roles.push({ user_id: 'user-coordinator2', role: 'event_coordinator' });
  const base = { ...events[0], decided_by: null, decided_at: null, decision_reason: null };
  events.push(
    { ...base, event_id: 681, name: 'Notice Forum', status: 'draft', coordinator_id: null },
    { ...base, event_id: 682, name: 'Question Forum', status: 'under_review', coordinator_id: 'user-coordinator' },
    { ...base, event_id: 683, name: 'Rejection Forum', status: 'under_review', coordinator_id: 'user-coordinator' },
  );
}

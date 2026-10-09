import type { SupabaseClient } from '@supabase/supabase-js';

/** The notice kinds an assignment writes (SG2-88 AC4). */
export type AssignmentNoticeKind = 'coordinator_assigned' | 'coordinator_removed' | 'event_coordinator_changed';

export interface AssignmentNotice {
  recipient_id: string;
  event_id: number;
  kind: AssignmentNoticeKind;
  message: string;
}

export type InsertAssignmentNotificationsResult = { ok: true } | { ok: false; message: string };

/** Stores the notices for one assignment in a single insert, so they are
 * written together or not at all. */
export async function insertAssignmentNotifications(
  admin: SupabaseClient,
  notices: AssignmentNotice[]
): Promise<InsertAssignmentNotificationsResult> {
  if (notices.length === 0) return { ok: true };
  const { error } = await admin.from('notifications').insert(notices);
  return error ? { ok: false, message: error.message } : { ok: true };
}

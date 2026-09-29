import type { SupabaseClient } from '@supabase/supabase-js';

export interface EventAuditLogRecord {
  log_id: number;
  event_id: number;
  actor_id: string;
  actor_name?: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface InsertAuditLogInput {
  event_id: number;
  actor_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
}

export type FetchEventAuditLogsResult =
  | { ok: true; logs: EventAuditLogRecord[] }
  | { ok: false; reason: 'unavailable'; message: string };

export type InsertAuditLogsResult =
  | { ok: true; logs: EventAuditLogRecord[] }
  | { ok: false; reason: 'unavailable'; message: string };

const AUDIT_SELECT_COLUMNS =
  'log_id, event_id, actor_id, field_name, old_value, new_value, created_at, actor:users!actor_id(name)';

const AUDIT_INSERT_COLUMNS =
  'log_id, event_id, actor_id, field_name, old_value, new_value, created_at';

function extractActorName(row: Record<string, unknown>): string | null {
  if ('actor' in row && row.actor) {
    if (Array.isArray(row.actor) && row.actor.length > 0) {
      const first = row.actor[0] as Record<string, unknown>;
      if (typeof first?.name === 'string') return first.name;
    } else if (typeof row.actor === 'object') {
      const actor = row.actor as Record<string, unknown>;
      if (typeof actor?.name === 'string') return actor.name;
    }
  }
  if (typeof row.actor_name === 'string') {
    return row.actor_name;
  }
  return null;
}

/**
 * Fetches audit logs for a specific event, ordered by creation time descending.
 */
export async function fetchEventAuditLogs(
  client: SupabaseClient,
  eventId: number
): Promise<FetchEventAuditLogsResult> {
  const { data, error } = await client
    .from('event_audit_logs')
    .select(AUDIT_SELECT_COLUMNS)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .order('log_id', { ascending: false });

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }

  const rows = (data as Record<string, unknown>[] | null) || [];
  const logs: EventAuditLogRecord[] = rows.map((row) => ({
    log_id: row.log_id as number,
    event_id: row.event_id as number,
    actor_id: row.actor_id as string,
    actor_name: extractActorName(row),
    field_name: row.field_name as string,
    old_value: typeof row.old_value === 'string' ? row.old_value : null,
    new_value: typeof row.new_value === 'string' ? row.new_value : null,
    created_at: row.created_at as string
  }));

  return { ok: true, logs };
}

/**
 * Inserts one or more audit log entries for event planning changes.
 */
export async function insertAuditLogs(
  admin: SupabaseClient,
  entries: InsertAuditLogInput[]
): Promise<InsertAuditLogsResult> {
  if (entries.length === 0) {
    return { ok: true, logs: [] };
  }

  const { data, error } = await admin
    .from('event_audit_logs')
    .insert(entries)
    .select(AUDIT_INSERT_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }

  const rows = (data as Record<string, unknown>[] | null) || [];
  const logs: EventAuditLogRecord[] = rows.map((row) => ({
    log_id: row.log_id as number,
    event_id: row.event_id as number,
    actor_id: row.actor_id as string,
    actor_name: null,
    field_name: row.field_name as string,
    old_value: typeof row.old_value === 'string' ? row.old_value : null,
    new_value: typeof row.new_value === 'string' ? row.new_value : null,
    created_at: row.created_at as string
  }));

  return { ok: true, logs };
}

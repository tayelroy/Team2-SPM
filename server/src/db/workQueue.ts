import type { SupabaseClient } from '@supabase/supabase-js';
import type { Principal } from '../auth/policy';

export interface WorkItem {
  kind: 'event' | 'venue' | 'equipment';
  item_id: number;
  event_id: number;
  title: string;
  event_name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  category: 'review' | 'assigned' | 'venue' | 'equipment';
  details: Record<string, string | number | boolean | null>;
}

export type WorkSelection = Pick<WorkItem, 'kind' | 'item_id'>;
const COLUMNS = 'kind,item_id,event_id,title,event_name,status,starts_at,ends_at,category,details';

/** Identity and role constraints also apply to a selected item. Separate
 * assignment queries avoid interpolating identity into PostgREST filter text. */
export async function fetchWorkQueue(admin: SupabaseClient, principal: Principal, selection?: WorkSelection): Promise<WorkItem[]> {
  async function read(assignedTo: string | null) {
    const items: WorkItem[] = [];
    // Supabase caps responses at 1,000 rows. Read every page so a busy queue
    // does not silently hide work, with stable ordering between pages.
    let hasMore: boolean;
    do {
      const offset = items.length;
      let query = admin.from('internal_work_items').select(COLUMNS).eq('audience', principal.role);
      query = assignedTo === null ? query.is('assigned_to', null) : query.eq('assigned_to', assignedTo);
      if (selection) query = query.eq('kind', selection.kind).eq('item_id', selection.item_id);
      const { data, error } = await query.order('kind').order('item_id').range(offset, offset + 999);
      if (error || !data) throw new Error('Work queue unavailable');
      items.push(...data as WorkItem[]);
      hasMore = data.length === 1000;
    } while (hasMore);
    return items;
  }
  const groups = await Promise.all(principal.role === 'event_coordinator'
    ? [read(null), read(principal.userId)] : [read(null)]);
  return groups.flat();
}

/** One active event the Event Coordinator Lead supervises (SG2-89 AC1). */
export interface SupervisedEvent {
  eventId: number;
  name: string;
  organisation: string | null;
  status: string;
  proposedDate: string | null;
  coordinatorId: string;
  coordinatorName: string | null;
}

/** A coordinator and how many of the Lead's active events they hold (AC2).
 * `assignable` is false for someone who has since lost the coordinator role. */
export interface CoordinatorWorkload { userId: string; name: string; activeEvents: number; assignable: boolean }

/** SG2-89 AC3: blank values leave a filter out. */
export interface OverviewFilters { coordinatorId: string; status: string }

export type FetchCoordinatorOverviewResult =
  | { ok: true; events: SupervisedEvent[]; coordinators: CoordinatorWorkload[]; statuses: string[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' }
  | { ok: false; kind: 'invalid'; message: string };

const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** GET /api/coordinator-overview — the Lead's supervised events, filtered on the server. */
export async function fetchCoordinatorOverview(token: string, filters: OverviewFilters): Promise<FetchCoordinatorOverviewResult> {
  const query = new URLSearchParams();
  if (filters.coordinatorId) query.set('coordinatorId', filters.coordinatorId);
  if (filters.status) query.set('status', filters.status);
  const suffix = query.toString() ? `?${query}` : '';
  let response: Response;
  try {
    response = await fetch(`/api/coordinator-overview${suffix}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 400) {
    return { ok: false, kind: 'invalid', message: text(data.error) ?? 'Those filters were not accepted.' };
  }
  if (!response.ok || !Array.isArray(data.events) || !Array.isArray(data.coordinators) || !Array.isArray(data.statuses)) {
    return { ok: false, kind: 'unavailable' };
  }
  return {
    ok: true,
    events: (data.events as Record<string, unknown>[]).map((raw) => ({
      eventId: Number(raw.event_id) || 0,
      name: text(raw.name) ?? '',
      organisation: text(raw.organisation),
      status: text(raw.status) ?? '',
      proposedDate: text(raw.proposed_date),
      coordinatorId: text(raw.coordinator_id) ?? '',
      coordinatorName: text(raw.coordinator_name),
    })),
    coordinators: (data.coordinators as Record<string, unknown>[]).map((raw) => ({
      userId: text(raw.user_id) ?? '',
      name: text(raw.name) ?? '',
      activeEvents: typeof raw.active_events === 'number' ? raw.active_events : 0,
      assignable: raw.assignable === true,
    })),
    statuses: (data.statuses as unknown[]).filter((status): status is string => typeof status === 'string'),
  };
}

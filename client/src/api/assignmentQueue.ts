/** A request waiting in the Event Coordinator Lead's unassigned queue (SG2-87). */
export interface QueueEntry {
  eventId: number;
  name: string;
  organiserName: string | null;
  proposedDate: string | null;
  expectedAttendance: number | null;
  submittedAt: string | null;
}

export type FetchAssignmentQueueResult =
  | { ok: true; entries: QueueEntry[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' };

const text = (value: unknown) => (typeof value === 'string' ? value : null);

export async function fetchAssignmentQueue(token: string): Promise<FetchAssignmentQueueResult> {
  let response: Response;
  try {
    response = await fetch('/api/assignment-queue', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  if (!response.ok) return { ok: false, kind: 'unavailable' };
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!Array.isArray(data.entries)) return { ok: false, kind: 'unavailable' };
  return {
    ok: true,
    entries: (data.entries as Record<string, unknown>[]).map((raw) => ({
      eventId: Number(raw.event_id) || 0,
      name: text(raw.name) ?? '',
      organiserName: text(raw.organiser_name),
      proposedDate: text(raw.proposed_date),
      expectedAttendance: typeof raw.expected_attendance === 'number' ? raw.expected_attendance : null,
      submittedAt: text(raw.submitted_at),
    })),
  };
}

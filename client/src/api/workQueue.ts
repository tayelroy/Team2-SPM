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
  /** Whether this item is assigned to the signed-in caller (SG2-35). */
  assigned_to_me: boolean;
}

export type StartReviewResult = { ok: true; status: string } | { ok: false; error: string };

export type Decision = 'approved' | 'rejected';
export type DecisionResult = { ok: true; status: string } | { ok: false; error: string };

/**
 * Approves or rejects a request this coordinator is reviewing (SG2-37). Maps
 * to `PATCH /api/event-requests/:eventId/decision`. A rejection must carry a
 * reason; the server rejects one without.
 */
export async function decideEventRequest(
  eventId: number,
  decision: Decision,
  reason: string,
  token: string | null | undefined,
): Promise<DecisionResult> {
  if (!token) return { ok: false, error: 'Sign in again to decide this request.' };
  try {
    const response = await fetch(`/api/event-requests/${eventId}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ decision, reason }),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'Your account cannot decide this request. Sign in again.' };
    }
    if (response.status === 404) {
      return { ok: false, error: 'This request is no longer under review by you.' };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: typeof body?.error === 'string' ? body.error : 'That decision was not accepted.' };
    }
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (typeof data?.request?.status !== 'string') throw new Error('Invalid response');
    return { ok: true, status: data.request.status };
  } catch {
    return { ok: false, error: 'Could not record the decision. Please try again.' };
  }
}

/**
 * Opens a request assigned to this coordinator for review (SG2-35), moving it
 * to `under_review` so the organiser can see it is being looked at. Maps to
 * `PATCH /api/event-requests/:eventId/review`.
 */
export async function startEventReview(
  eventId: number,
  token: string | null | undefined,
): Promise<StartReviewResult> {
  if (!token) return { ok: false, error: 'Sign in again to review this request.' };
  try {
    const response = await fetch(`/api/event-requests/${eventId}/review`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'Your account cannot review this request. Sign in again.' };
    }
    if (response.status === 404) {
      return { ok: false, error: 'This request is no longer assigned to you for review.' };
    }
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (typeof data?.request?.status !== 'string') throw new Error('Invalid response');
    return { ok: true, status: data.request.status };
  } catch {
    return { ok: false, error: 'Could not start the review. Please try again.' };
  }
}

export type WorkSelection = Pick<WorkItem, 'kind' | 'item_id'>;
export type QueueResult = { ok: true; items: WorkItem[] } | { ok: false; error: string };

export async function fetchWorkQueue(token: string | null | undefined, selection: WorkSelection | null): Promise<QueueResult> {
  if (!token) return { ok: false, error: 'Sign in again to view your work queue.' };
  const path = selection ? `/${selection.kind}/${selection.item_id}` : '';
  try {
    const response = await fetch(`/api/work-queue${path}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'Your account cannot view this work queue. Sign in again.' };
    }
    if (response.status === 404) {
      return { ok: false, error: 'This item is no longer in your work queue. Return to the queue to refresh it.' };
    }
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (!data || !Array.isArray(data.items) || (selection && data.items.length !== 1)) throw new Error('Invalid response');
    return { ok: true, items: data.items };
  } catch {
    return { ok: false, error: 'Your work queue is temporarily unavailable. Please try again.' };
  }
}

/**
 * Client-side API helpers for event request operations.
 *
 * Each function returns a discriminated union so callers can handle success
 * and every documented server error without relying on try/catch alone.
 */

export type SubmitResult =
  | { ok: true }
  | { ok: false; kind: 'missing'; missing: string[] }
  | { ok: false; kind: 'conflict' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'error'; message: string };

/**
 * Transitions an event request from `draft` (or `rejected`) → `submitted`.
 *
 * Maps to `PATCH /api/event-requests/:eventId/submit` (SG2-30 backend).
 *
 * @param eventId   UUID of the event request to submit.
 * @param token     Bearer access token from the signed-in session.
 */
export async function submitEventRequest(
  eventId: string,
  token: string,
): Promise<SubmitResult> {
  let response: Response;

  try {
    response = await fetch(`/api/event-requests/${eventId}/submit`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 400) {
    // Server returns { missing: string[] } listing which fields are incomplete.
    const data = await response.json().catch(() => ({}));
    return { ok: false, kind: 'missing', missing: Array.isArray(data.missing) ? data.missing : [] };
  }

  if (response.status === 409) {
    return { ok: false, kind: 'conflict' };
  }

  if (response.status === 503) {
    return { ok: false, kind: 'unavailable' };
  }

  const data = await response.json().catch(() => ({}));
  return { ok: false, kind: 'error', message: data.error ?? 'Submission failed. Please try again.' };
}

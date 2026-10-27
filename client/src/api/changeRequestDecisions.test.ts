import { afterEach, describe, expect, test, vi } from 'vitest';
import { acceptChangeRequest, refuseChangeRequest } from './changeRequests';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const JSON_HEADERS = { Authorization: 'Bearer coordinator-token', 'Content-Type': 'application/json' };

describe('change request decisions (SG2-65)', () => {
  test('[NORMAL] [SG2-65:AC2] refusing POSTs the reason to the escaped change request', async () => {
    const fetch = respond(() => Response.json({ event_id: 12, change_request_id: '41', status: 'refused' }));
    expect(await refuseChangeRequest(12, '41/x', 'No larger room is free.', 'coordinator-token')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/change-requests/41%2Fx/refuse', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ reason: 'No larger room is free.' }),
    });
  });

  test('[NORMAL] [SG2-65:AC4] accepting on a clarification request sends the chosen next step', async () => {
    const fetch = respond(() => Response.json({ event_id: 12, status: 'under_review' }));
    const result = await acceptChangeRequest(12, '41', 'coordinator-token', 'review');
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/change-requests/41/accept', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ next: 'review' }),
    });
  });

  test('[BOUNDARY] [SG2-65:AC2] a refused reason comes back as a validation failure', async () => {
    respond(() => Response.json({ error: 'Give a reason for refusing, up to 1000 characters.' }, { status: 400 }));
    expect(await refuseChangeRequest(12, '41', '', 't')).toEqual({
      ok: false, kind: 'validation', message: 'Give a reason for refusing, up to 1000 characters.',
    });
  });

  test('[CONFLICT] [SG2-65:AC2] a request decided in the meantime is a conflict', async () => {
    respond(() => Response.json({ error: 'This change request has already been decided.' }, { status: 409 }));
    expect(await refuseChangeRequest(12, '41', 'No.', 't')).toEqual({
      ok: false, kind: 'conflict', message: 'This change request has already been decided.',
    });
  });

  test('[FAILURE] [SG2-65:AC2] a network failure is reported as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await refuseChangeRequest(12, '41', 'No.', 't')).toEqual({
      ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.',
    });
  });
});

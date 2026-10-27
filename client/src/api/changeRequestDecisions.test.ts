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
  test('[NORMAL] [BOUNDARY] [CONFLICT] [FAILURE] [SG2-65:AC2] [SG2-65:AC4] refusing sends the reason and accepting the next step to the escaped request; validation, conflict and network failures come back typed', async () => {
    // NORMAL (AC2): the reason goes to the escaped change request.
    const refused = respond(() => Response.json({ event_id: 12, change_request_id: '41', status: 'refused' }));
    expect(await refuseChangeRequest(12, '41/x', 'No larger room is free.', 'coordinator-token')).toEqual({ ok: true });
    expect(refused).toHaveBeenCalledWith('/api/event-requests/12/change-requests/41%2Fx/refuse', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ reason: 'No larger room is free.' }),
    });

    // NORMAL (AC4): accepting on a clarification request sends the chosen next step.
    const accepted = respond(() => Response.json({ event_id: 12, status: 'under_review' }));
    expect((await acceptChangeRequest(12, '41', 'coordinator-token', 'review')).ok).toBe(true);
    expect(accepted).toHaveBeenCalledWith('/api/event-requests/12/change-requests/41/accept', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ next: 'review' }),
    });

    // BOUNDARY (AC2): a reason the server refuses is a validation failure.
    respond(() => Response.json({ error: 'Give a reason for refusing, up to 1000 characters.' }, { status: 400 }));
    expect(await refuseChangeRequest(12, '41', '', 't')).toEqual({
      ok: false, kind: 'validation', message: 'Give a reason for refusing, up to 1000 characters.',
    });

    // CONFLICT (AC2): decided in the meantime.
    respond(() => Response.json({ error: 'This change request has already been decided.' }, { status: 409 }));
    expect(await refuseChangeRequest(12, '41', 'No.', 't')).toEqual({
      ok: false, kind: 'conflict', message: 'This change request has already been decided.',
    });

    // FAILURE (AC2): the network is down.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await refuseChangeRequest(12, '41', 'No.', 't')).toEqual({
      ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.',
    });
  });
});

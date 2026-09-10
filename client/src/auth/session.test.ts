import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';
import type { StoredSession } from './session';

const session: StoredSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: { userId: 'user-1', email: 'ada@example.com', role: 'Attendee' }
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('saveSession / loadSession / clearSession', () => {
  test('round-trips a session through storage', () => {
    saveSession(session);
    expect(loadSession()).toEqual(session);
  });

  test('loadSession returns null when nothing is stored', () => {
    expect(loadSession()).toBeNull();
  });

  test('clearSession removes a stored session', () => {
    saveSession(session);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  test('saveSession does not throw if storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveSession(session)).not.toThrow();
  });

  test('loadSession returns null if storage throws or holds malformed JSON', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(loadSession()).toBeNull();
  });

  test('clearSession does not throw if storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => clearSession()).not.toThrow();
  });
});

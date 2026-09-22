import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';
import type { StoredSession } from './session';

const session: StoredSession = {
  accessToken: 'access-1',
  user: { userId: 'user-1', email: 'ada@example.com', role: 'Attendee' }
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('saveSession / loadSession / clearSession', () => {
  test('round-trips a session through tab-scoped storage without persisting it in localStorage', () => {
    const persistentWrite = vi.spyOn(localStorage, 'setItem');
    saveSession(session);
    expect(JSON.parse(sessionStorage.getItem('connectsphere.session')!)).toEqual(session);
    expect(persistentWrite).not.toHaveBeenCalled();
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

  test('loadSession returns null if storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(loadSession()).toBeNull();
  });

  test('loadSession returns null for malformed stored JSON', () => {
    sessionStorage.setItem('connectsphere.session', '{not-json');
    expect(loadSession()).toBeNull();
  });

  test('clearSession does not throw if storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => clearSession()).not.toThrow();
  });
});

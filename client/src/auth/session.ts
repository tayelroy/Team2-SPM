export interface StoredUser {
  userId: string;
  email: string;
  role: string;
}

// No refreshToken: the server never sends one (see auth/login.ts) — nothing
// client-side used it, and an unused long-lived credential sitting in
// sessionStorage was exactly the exposure an AI security review flagged.
export interface StoredSession {
  accessToken: string;
  user: StoredUser;
}

const STORAGE_KEY = 'connectsphere.session';

/**
 * sessionStorage, not localStorage: a signed-in session shouldn't silently
 * persist forever across browser restarts on a shared device, matching the
 * "not accessible to whoever next uses my device" intent behind SG2-23.
 */
export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private browsing, quota) — the session
    // still works for the current page load via in-memory state.
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

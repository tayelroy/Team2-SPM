import { useEffect, useState } from 'react';
import type { Role, Screen } from './mock/types';
import { clearSession, loadSession, saveSession } from './auth/session';
import type { StoredSession } from './auth/session';
import AppShell from './screens/AppShell';
import AttendeeEvent from './screens/AttendeeEvent';
import AvailabilityCalendar from './screens/AvailabilityCalendar';
import BookingApproval from './screens/BookingApproval';
import ChangeRequest from './screens/ChangeRequest';
import Dashboard from './screens/Dashboard';
import EquipmentDesk from './screens/EquipmentDesk';
import EventDetail from './screens/EventDetail';
import EventsTable from './screens/EventsTable';
import Landing from './screens/Landing';
import Login from './screens/Login';
import RequestForm from './screens/RequestForm';
import Venues from './screens/Venues';

/** The screen a signed-in user of a given role opens on. */
function landingScreenFor(role: Role): Screen {
  return role === 'Attendee' ? 'attendee' : 'dashboard';
}

/**
 * A persisted session takes priority — someone with a live session landing
 * on "/" or "/?screen=login" resumes where they left off rather than seeing
 * sign-in again. Without one, "/?screen=login" is real pages elsewhere in
 * the app (e.g. /register) linking back in here.
 */
function initialScreen(session: StoredSession | null): Screen {
  if (session) return landingScreenFor(session.user.role as Role);
  return new URLSearchParams(window.location.search).get('screen') === 'login' ? 'login' : 'landing';
}

/**
 * ConnectSphere app shell.
 *
 * Navigation is a plain screen state machine rather than a router: screens
 * reached from within the shell have no shareable URLs, which keeps the
 * dependency surface at zero. The one deliberate exception is the initial
 * screen, resolved once at mount from a persisted session or `?screen=`,
 * since real pages outside the shell need somewhere to land a signed-in (or
 * about-to-sign-in) user. Swap in a router once more screens need to be
 * deep-linked.
 */
export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [screen, setScreen] = useState<Screen>(() => initialScreen(loadSession()));

  // Best-effort background check that a persisted session is still valid.
  // Trusts the cached session for the current render (no loading flash);
  // a network hiccup doesn't kick the user out, only a confirmed 401/403 does.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => {
        if (cancelled || response.ok) return;
        clearSession();
        setSession(null);
        setScreen('landing');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Re-check only when the signed-in identity actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  function handleSignIn(newSession: StoredSession) {
    saveSession(newSession);
    setSession(newSession);
    setScreen(landingScreenFor(newSession.user.role as Role));
  }

  function handleSignOut() {
    // Only wired to AppShell's sign-out control, which renders solely in the
    // signed-in tree — session is non-null by construction whenever this runs.
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session!.accessToken}` },
      body: JSON.stringify({ refreshToken: session!.refreshToken })
    }).catch(() => {});
    clearSession();
    setSession(null);
    setScreen('landing');
  }

  if (screen === 'landing') {
    return <Landing onOpenApp={() => setScreen('login')} />;
  }

  if (screen === 'login') {
    return <Login onSignIn={handleSignIn} onBack={() => setScreen('landing')} />;
  }

  // Every other screen requires a session. `session` is non-null here by
  // construction: `screen` only reaches a protected value via handleSignIn
  // (which sets both together) or a persisted session restored at mount
  // (same). The assertion documents that invariant rather than adding an
  // unreachable branch just to satisfy the type checker.
  const role = session!.user.role as Role;

  const body = {
    dashboard: <Dashboard role={role} onNavigate={setScreen} />,
    events: <EventsTable role={role} onOpenEvent={() => setScreen('detail')} />,
    detail: <EventDetail role={role} onNavigate={setScreen} />,
    form: <RequestForm onSubmit={() => setScreen('detail')} />,
    venues: <Venues onBook={() => setScreen('booking')} />,
    calendar: <AvailabilityCalendar />,
    booking: <BookingApproval />,
    equipment: <EquipmentDesk />,
    attendee: <AttendeeEvent />,
    change: <ChangeRequest />
  }[screen];

  return (
    <AppShell role={role} screen={screen} onNavigate={setScreen} onSignOut={handleSignOut}>
      {body}
    </AppShell>
  );
}

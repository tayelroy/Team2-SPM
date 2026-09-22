import { useEffect, useState } from 'react';
import type { Role, Screen } from './mock/types';
import { clearSession, loadSession, saveSession } from './auth/session';
import type { StoredSession } from './auth/session';
import type { EventRequestDraft } from './api/eventRequests';
import AppShell from './screens/AppShell';
import AttendeeEvent from './screens/AttendeeEvent';
import AvailabilityCalendar from './screens/AvailabilityCalendar';
import BookingApproval from './screens/BookingApproval';
import ChangeRequest from './screens/ChangeRequest';
import Dashboard from './screens/Dashboard';
import DraftRequests from './screens/DraftRequests';
import EquipmentDesk from './screens/EquipmentDesk';
import EventDetail from './screens/EventDetail';
import EventsTable from './screens/EventsTable';
import Landing from './screens/Landing';
import Login from './screens/Login';
import Profile from './screens/Profile';
import RequestForm from './screens/RequestForm';
import Venues from './screens/Venues';
import { GhostButton } from './ui';

/** The screen a signed-in user of a given role opens on. */
function landingScreenFor(role: Role): Screen {
  return role === 'Attendee' ? 'attendee' : 'dashboard';
}

/**
 * A persisted session takes priority — someone with a live session landing
 * on "/" or "/?screen=login" resumes where they left off rather than seeing
 * sign-in again. Without one, "/?screen=login" is a deep link straight to
 * sign-in for anything outside the shell that needs one.
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
  const [logoutState, setLogoutState] = useState<'pending' | 'failed' | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | undefined>(undefined);
  // The draft "My drafts" → Edit currently has open, if any (SG2-29).
  const [editingRequest, setEditingRequest] = useState<EventRequestDraft | null>(null);

  // Best-effort background check that a persisted session is still valid.
  // Trusts the cached session for the current render (no loading flash);
  // a network hiccup doesn't kick the user out, only a confirmed 401/403 does.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => {
        if (cancelled || (response.status !== 401 && response.status !== 403)) return;
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

  async function handleSignOut() {
    const token = session!.accessToken;
    // Remove local access immediately, even if the network is unavailable.
    clearSession();
    setSession(null);
    setScreen('landing');
    setLogoutState('pending');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
        signal: AbortSignal.timeout(10000),
      });
      setLogoutState(response.ok ? null : 'failed');
    } catch {
      setLogoutState('failed');
    }
  }

  if (logoutState) {
    return <main style={{ padding: '48px 28px', maxWidth: '640px', margin: '0 auto' }}>
      {logoutState === 'pending' ? <p role="status">Signing out…</p> : <>
        <p role="alert">You are signed out on this device, but we could not confirm server sign-out. Sign in again and retry Logout when your connection is available.</p>
        <GhostButton onClick={() => { setLogoutState(null); setScreen('login'); }}>Return to sign in</GhostButton>
      </>}
    </main>;
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
    dashboard: (
      <Dashboard
        role={role}
        accessToken={session!.accessToken}
        onNavigate={(nextScreen, id) => {
          if (id !== undefined) setSelectedEventId(id);
          setScreen(nextScreen);
        }}
      />
    ),
    events: (
      <EventsTable
        key={session!.accessToken}
        role={role}
        accessToken={session!.accessToken}
        onOpenEvent={(id) => {
          setSelectedEventId(id);
          setScreen('detail');
        }}
      />
    ),
    detail: (
      <EventDetail
        key={`${session!.accessToken}:${selectedEventId}`}
        role={role}
        onNavigate={setScreen}
        selectedEventId={selectedEventId}
        accessToken={session!.accessToken}
      />
    ),
    form: (
      <RequestForm
        accessToken={session!.accessToken}
        onSuccess={(eventId) => {
          setSelectedEventId(eventId);
          setScreen('detail');
        }}
      />
    ),
    venues: <Venues accessToken={session!.accessToken} onBook={() => setScreen('booking')} />,
    drafts: (
      <DraftRequests
        accessToken={session!.accessToken}
        onEdit={(request) => {
          setEditingRequest(request);
          setScreen('editDraft');
        }}
      />
    ),
    editDraft: editingRequest && (
      <RequestForm
        key={editingRequest.event_id}
        eventId={String(editingRequest.event_id)}
        initialValues={editingRequest}
        accessToken={session!.accessToken}
        onSuccess={() => {
          setEditingRequest(null);
          setScreen('drafts');
        }}
      />
    ),
    calendar: <AvailabilityCalendar />,
    booking: <BookingApproval />,
    equipment: <EquipmentDesk />,
    attendee: <AttendeeEvent />,
    change: <ChangeRequest />,
    profile: <Profile />
  }[screen];

  return (
    <AppShell role={role} screen={screen} onNavigate={setScreen} onSignOut={handleSignOut}>
      {body}
    </AppShell>
  );
}

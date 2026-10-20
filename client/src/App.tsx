import { useEffect, useState } from 'react';
import { isRole, type Role, type Screen } from './mock/types';
import { clearSession, loadSession, saveSession } from './auth/session';
import type { StoredSession } from './auth/session';
import { loadAccess, type Access } from './auth/access';
import type { EventRequestDraft } from './api/eventRequests';
import AppShell from './screens/AppShell';
import AttendeeEvent from './screens/AttendeeEvent';
import AvailabilityCalendar from './screens/AvailabilityCalendar';
import CoordinatorAssignment from './screens/CoordinatorAssignment';
import AssignmentQueue from './screens/AssignmentQueue';
import CapacityExceptions from './screens/CapacityExceptions';
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
import SafetyChecks from './screens/SafetyChecks';
import Venues from './screens/Venues';
import VenueSearch from './screens/VenueSearch';
import VenueHolds from './screens/VenueHolds';
import type { VenueSearchPrefill } from './venues/searchPrefill';
import { GhostButton } from './ui';

/** The screen a signed-in user of a given role opens on. */
function landingScreenFor(role: Role): Screen {
  return role === 'Attendee' ? 'attendee' : 'dashboard';
}

/**
 * SG2-86: a server role absent from the client's Role union (stale deploy,
 * unexpected value) would otherwise reach HEAD[role] as undefined and crash
 * the shell. Falls back to the least-privileged role; the server enforces
 * access regardless, so a mislabelled shell cannot grant anything.
 */
function toRole(value: string): Role {
  return isRole(value) ? value : 'Attendee';
}

/**
 * A persisted session takes priority — someone with a live session landing
 * on "/" or "/?screen=login" resumes where they left off rather than seeing
 * sign-in again. Without one, "/?screen=login" is a deep link straight to
 * sign-in for anything outside the shell that needs one.
 */
function initialScreen(session: StoredSession | null): Screen {
  if (session) return landingScreenFor(toRole(session.user.role));
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
  // The approved event venue search was opened from, if any (SG2-46).
  const [venuePrefill, setVenuePrefill] = useState<VenueSearchPrefill | null>(null);
  // SG2-91: the awaiting event a Safety desk card opened, if any.
  const [safetyFocus, setSafetyFocus] = useState<number | undefined>(undefined);
  // The server's permissions for the signed-in account (SG2-86 AC2), tagged
  // with the token they were loaded for so a previous session's never leak
  // into the next one's navigation.
  const [loadedAccess, setLoadedAccess] = useState<{ token: string; access: Access | null } | null>(null);
  // SG2-30 AC1: the request just submitted, confirmed on its detail page.
  // Cleared as soon as the user leaves that page.
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  useEffect(() => {
    if (screen !== 'detail') setSubmittedName(null);
  }, [screen]);

  // Best-effort background check that a persisted session is still valid,
  // which also loads the permissions the navigation is gated on. Trusts the
  // cached session for the current render (no loading flash); a network
  // hiccup doesn't kick the user out, only a confirmed 401/403 does.
  useEffect(() => {
    if (!session) return;
    const token = session.accessToken;
    const controller = new AbortController();
    const settle = (apply: () => void) => {
      if (!controller.signal.aborted) apply();
    };
    loadAccess(token, controller.signal).then(
      (access) => settle(() => {
        if (access) {
          setLoadedAccess({ token, access });
          return;
        }
        clearSession();
        setSession(null);
        setScreen('landing');
      }),
      // Unknown permissions gate like none: ungated items stay, gated ones wait.
      () => settle(() => setLoadedAccess({ token, access: null })),
    );
    return () => controller.abort();
    // Re-check when the signed-in identity or the role it acts as changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, session?.user.role]);

  // SG2-104: switch the role the account acts as. Every screen starts again
  // at that role's home, and the next requests carry the new role.
  function handleSwitchRole(nextRole: Role) {
    const next = { ...session!, user: { ...session!.user, role: nextRole } };
    saveSession(next);
    setSession(next);
    setLoadedAccess(null);
    setSelectedEventId(undefined);
    setEditingRequest(null);
    setVenuePrefill(null);
    setScreen(landingScreenFor(nextRole));
  }

  function handleSignIn(newSession: StoredSession) {
    saveSession(newSession);
    setSession(newSession);
    setScreen(landingScreenFor(toRole(newSession.user.role)));
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
  const role = toRole(session!.user.role);
  // SG2-104: every role the account holds (just its role for older sessions).
  const roles = (session!.user.roles ?? [role]).filter(isRole);
  // `undefined` while this session's permissions are still loading.
  const access = loadedAccess?.token === session!.accessToken ? loadedAccess.access : undefined;

  const body = {
    dashboard: (
      <Dashboard
        role={role}
        accessToken={session!.accessToken}
        onNavigate={(nextScreen, id) => {
          if (nextScreen === 'safetyChecks') setSafetyFocus(id);
          else if (id !== undefined) setSelectedEventId(id);
          setScreen(nextScreen);
        }}
        onFindVenues={(prefill) => {
          setVenuePrefill(prefill);
          setScreen('search');
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
      <>
        {submittedName ? (
          <p role="status" className="organisation-detail-notice" style={{ marginBottom: '20px' }}>
            {submittedName} has been submitted for review.
          </p>
        ) : null}
        <EventDetail
          key={`${session!.accessToken}:${selectedEventId}`}
          role={role}
          onNavigate={setScreen}
          selectedEventId={selectedEventId}
          accessToken={session!.accessToken}
        />
      </>
    ),
    form: (
      <RequestForm
        accessToken={session!.accessToken}
        onSuccess={(eventId, name) => {
          setSelectedEventId(eventId);
          setSubmittedName(name);
          setScreen('detail');
        }}
      />
    ),
    venues: <Venues accessToken={session!.accessToken} />,
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
        onSuccess={(eventId, name) => {
          setEditingRequest(null);
          setSelectedEventId(eventId);
          setSubmittedName(name);
          setScreen('detail');
        }}
      />
    ),
    calendar: <AvailabilityCalendar />,
    holds: <VenueHolds key={session!.accessToken} role={role} accessToken={session!.accessToken} />,
    capacityExceptions: <CapacityExceptions key={session!.accessToken} accessToken={session!.accessToken} />,
    equipment: <EquipmentDesk accessToken={session!.accessToken} />,
    attendee: <AttendeeEvent />,
    change: <ChangeRequest />,
    profile: <Profile role={role} roles={roles} />,
    assign: <CoordinatorAssignment accessToken={session!.accessToken} />,
    queue: <AssignmentQueue accessToken={session!.accessToken} />,
    safetyChecks: <SafetyChecks key={session!.accessToken} accessToken={session!.accessToken} focusEventId={safetyFocus} />,
    search: <VenueSearch key={`${session!.accessToken}:${venuePrefill?.eventId ?? 'manual'}`}
      accessToken={session!.accessToken} prefill={venuePrefill} />
  }[screen];

  return (
    <AppShell key={`${session!.accessToken}:${role}`} accessToken={session!.accessToken} role={role} roles={roles} onSwitchRole={handleSwitchRole}
      access={access} screen={screen} onSignOut={handleSignOut} onNavigate={(nextScreen) => {
      // Menu navigation opens venue search blank, not for the last event,
      // and the safety check list at the top (SG2-91).
      setVenuePrefill(null);
      setSafetyFocus(undefined);
      setScreen(nextScreen);
    }}>
      {body}
    </AppShell>
  );
}

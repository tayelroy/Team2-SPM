import { useEffect, useRef, useState } from 'react';
import type { Screen, ProtectedScreen } from './mock/types';
import { clearSession, loadSession, saveSession } from './auth/session';
import type { StoredSession } from './auth/session';
import { can, loadAccess } from './auth/access';
import type { Access } from './auth/access';
import { canOpen, isProtectedScreen, PAGE_PERMISSIONS, PageAccess, roleLabel } from './auth/pages';
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
import { Card, GhostButton } from './ui';

/** Protected deep links are checked against the server, including on reload. */
function initialScreen(): Screen | null {
  const requested = new URLSearchParams(window.location.search).get('screen') ?? '';
  if (isProtectedScreen(requested)) return requested;
  return requested === 'login' ? 'login' : null;
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [screen, setScreen] = useState<Screen | null>(initialScreen);
  const [access, setAccess] = useState<Access | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [denied, setDenied] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const token = typeof session?.accessToken === 'string' ? session.accessToken : null;

  function forgetSession() {
    pending.current?.abort();
    clearSession();
    setSession(null);
    setAccess(null);
    setScreen('landing');
  }

  // Every navigation/action and window-focus check reads current server grants.
  // Abort and identity checks prevent an older response restoring stale access.
  async function verify(permission?: string, action?: () => void) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStatus('checking');
    try {
      const current = await loadAccess(token, controller.signal);
      if (controller.signal.aborted) return;
      if (!current) { forgetSession(); return; }
      if (!roleLabel(current.role)) throw new Error('Unknown role');
      setAccess(current);
      setStatus('ready');
      const allowed = !permission || can(current, permission);
      setDenied(!allowed);
      if (allowed) action?.();
    } catch {
      if (controller.signal.aborted) return;
      setAccess(null);
      setStatus('error');
    }
  }

  useEffect(() => {
    if (!token) return;
    void verify();
    const recheck = () => { void verify(); };
    window.addEventListener('focus', recheck);
    return () => {
      pending.current?.abort();
      window.removeEventListener('focus', recheck);
    };
    // The checker captures only the token; permission and action are arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function handleSignIn(newSession: StoredSession) {
    saveSession(newSession);
    setSession(newSession);
    setAccess(null);
    setStatus('checking');
    setScreen(null);
  }

  function handleSignOut() {
    fetch('/api/auth/logout', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
    forgetSession();
  }

  if (!token) {
    return screen === 'login' || (screen !== null && isProtectedScreen(screen))
      ? <Login onSignIn={handleSignIn} onBack={() => setScreen('landing')} />
      : <Landing onOpenApp={() => setScreen('login')} />;
  }

  const navigate = (next: ProtectedScreen) => {
    void verify(PAGE_PERMISSIONS[next], () => setScreen(next));
  };
  const role = access ? roleLabel(access.role) : undefined;
  const currentScreen = screen && isProtectedScreen(screen) ? screen : access?.role === 'attendee' ? 'attendee' : 'dashboard';
  const permitted = access && canOpen(access, currentScreen);
  const body = role && permitted ? {
    dashboard: <Dashboard role={role} onNavigate={navigate} />,
    events: <EventsTable role={role} onOpenEvent={() => navigate('detail')} />,
    detail: <EventDetail role={role} onNavigate={navigate} />,
    form: <RequestForm onSubmit={() => navigate('detail')} />,
    venues: <Venues onBook={() => navigate('booking')} />,
    calendar: <AvailabilityCalendar />,
    booking: <BookingApproval />,
    equipment: <EquipmentDesk />,
    attendee: <AttendeeEvent />,
    change: <ChangeRequest />
  }[currentScreen] : null;

  return <>
    {status !== 'ready' ? <main style={{ padding: '64px 28px' }}>
      <Card>
        <p role={status === 'error' ? 'alert' : 'status'}>
          {status === 'error' ? 'Unable to verify access. Please try again.' : 'Checking access…'}
        </p>
        {status === 'error' ? <GhostButton onClick={() => { void verify(); }}>Try again</GhostButton> : null}
        <GhostButton onClick={handleSignOut}>Sign out</GhostButton>
      </Card>
    </main> : null}
    {role && access ? <div hidden={status !== 'ready'}>
      <PageAccess.Provider value={{ access, run: (permission, action) => { void verify(permission, action); } }}>
        <AppShell key={`${access.userId}:${access.role}`} role={role} screen={currentScreen} onNavigate={navigate} onSignOut={handleSignOut}>
          {denied || !permitted ? <Card>
            <p role="alert">Access denied. Your role does not permit this page or action.</p>
            <GhostButton onClick={() => navigate('dashboard')}>Back to dashboard</GhostButton>
          </Card> : body}
        </AppShell>
      </PageAccess.Provider>
    </div> : null}
  </>;
}

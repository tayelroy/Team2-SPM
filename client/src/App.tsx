import { useState } from 'react';
import type { Role, Screen } from './mock/types';
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

const DEFAULT_ROLE: Role = 'Event Coordinator';

/**
 * ConnectSphere prototype shell.
 *
 * Navigation is a plain screen state machine rather than a router: the
 * mockups are a clickable walkthrough with no shareable URLs, so this keeps
 * the dependency surface at zero. Swap in a router once screens need to be
 * deep-linked or the API is wired up.
 */
export default function App() {
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [screen, setScreen] = useState<Screen>('landing');

  /** Picking a role also decides the landing screen for that role. */
  const enterAs = (next: Role) => {
    setRole(next);
    setScreen(next === 'Attendee' ? 'attendee' : 'dashboard');
  };

  if (screen === 'landing') {
    return <Landing onOpenApp={() => setScreen('login')} />;
  }

  if (screen === 'login') {
    return (
      <Login
        role={role}
        onPickRole={enterAs}
        onSignIn={() => enterAs(role)}
        onBack={() => setScreen('landing')}
      />
    );
  }

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
    change: <ChangeRequest />,
  }[screen];

  return (
    <AppShell
      role={role}
      screen={screen}
      onNavigate={setScreen}
      onChangeRole={enterAs}
      onSignOut={() => setScreen('landing')}
    >
      {body}
    </AppShell>
  );
}

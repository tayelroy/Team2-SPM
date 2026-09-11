import React from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from '../../client/src/screens/AppShell';
import Venues from '../../client/src/screens/Venues';
import '../../client/src/index.css';

// Supply a test identity at the same token boundary that login will integrate.
const coordinator = new URLSearchParams(window.location.search).get('actor') === 'coordinator';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell role={coordinator ? 'Event Coordinator' : 'Venue Staff'} screen="venues"
      onNavigate={() => {}} onChangeRole={() => {}} onSignOut={() => {}}>
      <Venues accessToken={coordinator ? 'test-coordinator' : 'test-staff'} onBook={() => {}} />
    </AppShell>
  </React.StrictMode>
);

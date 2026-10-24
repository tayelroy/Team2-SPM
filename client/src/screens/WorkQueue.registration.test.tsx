import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import Dashboard from './Dashboard';

// Coordinators open events from the work queue, so SG2-63's registration
// picture is wired here too. It has its own suite; this stub shows what the
// pane hands it.
vi.mock('../components/RegistrationPanel', () => ({
  default: ({ eventId, accessToken }: { eventId: number; accessToken: string }) => (
    <section data-testid="registration-panel">Registration for event {eventId} with {accessToken}</section>
  ),
}));
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));
vi.mock('../components/ChangeRequestsPanel', () => ({ default: () => null }));
vi.mock('../components/ArrangementRechecks', () => ({ default: () => null }));
vi.mock('../components/EquipmentRequirements', () => ({ default: () => null }));
vi.mock('../components/EventArrangements', () => ({ default: () => null }));
vi.mock('../venues/BookingClashes', () => ({ BookingClashes: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const confirmed: WorkItem = {
  kind: 'event', item_id: 63, event_id: 63, title: 'Registration Forum', event_name: 'Registration Forum',
  status: 'confirmed', starts_at: '2030-06-15T02:00:00Z', ends_at: null, category: 'assigned', assigned_to_me: true,
  details: { organisation: 'Harbour Trust', expected_attendance: 120, registration_needed: true, registration_capacity: 100 },
};

async function open(item: WorkItem) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [item] })));
  render(<Dashboard role="Event Coordinator" accessToken="coordinator-token" onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Registration Forum/ }));
  return screen.findByRole('article', { name: 'Event request' });
}

describe('work queue registration picture (SG2-63)', () => {
  test.each(['approved', 'confirmed', 'completed'])('[NORMAL] [SG2-63:AC1] [SG2-63:AC8] the assigned coordinator sees the registration picture of a %s event', async (status) => {
    const pane = await open({ ...confirmed, status });
    expect(within(pane).getByTestId('registration-panel')).toHaveTextContent('Registration for event 63 with coordinator-token');
  });

  test.each([
    ['not assigned to them', { assigned_to_me: false }],
    ['that takes no registrations', { details: { ...confirmed.details, registration_needed: false } }],
    ['still under review', { status: 'under_review' }],
  ])('[BOUNDARY] [SG2-63:AC3] an event %s shows no registration picture', async (_label, override) => {
    const pane = await open({ ...confirmed, ...override });
    expect(within(pane).queryByTestId('registration-panel')).not.toBeInTheDocument();
  });
});

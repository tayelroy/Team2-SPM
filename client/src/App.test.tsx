import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import App from './App';
import { NOTIFICATIONS } from './mock/data';
import { ROLES } from './mock/types';
import type { Role } from './mock/types';
import EventDetail from './screens/EventDetail';
import RequestForm from './screens/RequestForm';

// Auto-cleanup only registers when vitest runs with globals enabled, which
// this project does not, so unmount between tests explicitly.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

// jsdom has no canvas implementation; the orb hook is written to no-op when
// there is no 2D context, and stubbing this keeps the console clean.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function mockLoginResponse(role: Role) {
  const permissions = role === 'Venue Staff' ? ['venues.read', 'venues.create', 'venues.update']
    : role === 'Event Coordinator' ? ['venues.read'] : [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return Response.json({ userId: 'user-1', role: role.toLowerCase().replace(/ /g, '_'), permissions });
      if (url === '/api/venues') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-access-token' });
        return Response.json({ venues: [{ venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
          facilities: 'Stage', accessibility_features: 'Lift', operating_information: 'Weekdays' }] });
      }
      if (url === '/api/event-requests') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-access-token' });
        return Response.json({ requests: [{ event_id: 9, status: 'draft', name: 'Draft Forum' }] });
      }
      if (url === '/api/event-requests/9') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-access-token' });
        return Response.json({
          request: {
            event_id: 9,
            organiser_id: 'user-1',
            organisation: 'ConnectSphere Test',
            status: 'draft',
            name: 'Draft Forum',
            purpose: null,
            description: null,
            proposed_date: null,
            expected_attendance: null,
            venue_requirements: null,
            accessibility_needs: null,
            equipment_requirements: null,
            registration_needed: null
          }
        });
      }
      if (url === '/api/profile') {
        return Response.json({ profile: { user_id: 'user-1', name: 'Test User', organisation: 'ConnectSphere Test',
          phone: null, communication_preferences: [] } });
      }
      return Response.json({ accessToken: 'test-access-token', user: { userId: 'user-1', email: 'test@example.com', role } });
    })
  );
}

/** Walk landing -> login -> signed in as `role`, via a mocked real login call. */
async function signInAs(role: Role) {
  mockLoginResponse(role);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('banner');
}

const header = () => screen.getByRole('banner');

test('the landing page leads into sign-in', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', {
      name: /Exceptional Events Begin with the Perfect Space/,
    }),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

test('the wordmark returns from sign-in to the landing page', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  fireEvent.click(screen.getByRole('button', { name: /ConnectSphere/ }));
  expect(screen.getByRole('button', { name: 'Open app' })).toBeInTheDocument();
});

test('invalid credentials show a generic error and keep you on sign-in', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid email or password.' }), { status: 401 }))
  );
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'wrong@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

test('an attendee lands on the event page rather than a dashboard', async () => {
  await signInAs('Attendee');
  expect(screen.getByRole('heading', { name: 'Event page' })).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Northbridge Investor Forum' }),
  ).toBeInTheDocument();
});

describe('every role can reach every screen in its navigation', () => {
  // Keep expected destinations independent of the navigation data under test.
  // A wrong destination or a removed menu item must fail this contract.
  const destinations: Record<Role, [string, string][]> = {
    'Event Organiser': [
      ['My events', 'Your events'], ['New request', 'Event request'],
      ['My drafts', 'My draft requests'],
      ['Event detail', 'Event detail'], ['Change request', 'Change request'],
    ],
    'Event Coordinator': [
      ['Dashboard', 'Coordination desk'], ['All events', 'All events'],
      ['Review', 'Event detail'], ['Venues', 'Venue catalogue'],
      ['Venue Availability', 'Venue availability'], ['Equipment', 'Equipment requests'],
    ],
    'Venue Staff': [
      ['Dashboard', 'Venue desk'], ['Booking requests', 'Booking approval'],
      ['Venue Availability', 'Venue availability'], ['Catalogue', 'Venue catalogue'],
    ],
    'Technical Support Staff': [
      ['Dashboard', 'Equipment desk'], ['Equipment requests', 'Equipment requests'],
      ['Venue Availability', 'Venue availability'],
    ],
    Attendee: [['My registrations', 'My registrations'], ['Event page', 'Event page']],
  };
  test.each(ROLES)('%s', async (role) => {
    await signInAs(role);
    for (const [navLabel, heading] of destinations[role]) {
      fireEvent.click(within(header()).getByRole('button', { name: navLabel }));
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.getByRole('main')).not.toBeEmptyDOMElement();
    }
  });
});

test('the role shown in the header is a read-only label, not a selector', async () => {
  await signInAs('Event Coordinator');
  const roleLabel = screen.getByLabelText('Your role');
  expect(roleLabel).toHaveTextContent('Event Coordinator');
  // Only Technical Support Staff can change a role (SG2-24) — not the user
  // themselves, so this must not be an interactive control.
  expect(roleLabel.tagName).not.toBe('SELECT');
});

test('a persisted session resumes straight into the app on the next visit', async () => {
  await signInAs('Venue Staff');
  cleanup();

  // Re-render as a fresh page load would: reads the session already saved
  // in sessionStorage, without going through landing/login again.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Venue desk' })).toBeInTheDocument();
});

test.each([401, 403])('a %s validation denial clears the session and returns to landing', async (status) => {
  await signInAs('Venue Staff');
  cleanup();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Open app' })).toBeInTheDocument();
  expect(sessionStorage.getItem('connectsphere.session')).toBeNull();
});

test.each([500, 503, 'offline'] as const)('a %s validation failure preserves the session after the check finishes', async (failure) => {
  await signInAs('Venue Staff');
  cleanup();
  const saved = sessionStorage.getItem('connectsphere.session');
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (failure === 'offline') throw new Error('network down');
    return new Response(null, { status: failure });
  }));
  await act(async () => { render(<App />); });
  expect(screen.getByRole('heading', { name: 'Venue desk' })).toBeInTheDocument();
  expect(sessionStorage.getItem('connectsphere.session')).toBe(saved);
});

test.each([
  ['Venue Staff', 'Catalogue', 'Venue desk'],
  ['Attendee', 'My registrations', 'Event page'],
] as const)('the %s wordmark returns home without signing out, including after reload', async (role, destination, home) => {
  await signInAs(role);
  fireEvent.click(within(header()).getByRole('button', { name: destination }));
  const saved = sessionStorage.getItem('connectsphere.session');
  fireEvent.click(within(header()).getByRole('button', { name: /ConnectSphere/ }));
  expect(screen.getByRole('heading', { level: 1, name: home })).toBeInTheDocument();
  expect(sessionStorage.getItem('connectsphere.session')).toBe(saved);
  expect(fetch).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
  cleanup();
  await act(async () => { render(<App />); });
  expect(screen.getByRole('heading', { level: 1, name: home })).toBeInTheDocument();
});

test('the profile options open, toggle and dismiss with Escape, outside clicks or focus', async () => {
  await signInAs('Event Coordinator');
  const profile = screen.getByRole('button', { name: 'Profile' });
  expect(profile).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  fireEvent.click(profile);
  expect(profile).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerDown(screen.getByRole('group', { name: 'Profile options' }));
  const logout = screen.getByRole('button', { name: 'Logout' });
  act(() => logout.focus());
  expect(logout).toHaveFocus();
  fireEvent.keyDown(logout, { key: 'Tab' });
  expect(logout).toBeInTheDocument();
  fireEvent.keyDown(logout, { key: 'Escape' });
  expect(profile).toHaveFocus();
  expect(profile).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(profile);
  fireEvent.click(profile);
  expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  fireEvent.click(profile);
  fireEvent.pointerDown(screen.getByRole('main'));
  expect(profile).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(profile);
  act(() => screen.getByRole('button', { name: 'Dashboard' }).focus());
  expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  expect(sessionStorage.getItem('connectsphere.session')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
});

test('My Profile navigates to the profile screen and closes the dropdown', async () => {
  await signInAs('Event Coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
  fireEvent.click(screen.getByRole('button', { name: 'My Profile' }));
  expect(screen.getByRole('heading', { level: 1, name: 'My profile' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  await screen.findByLabelText('Name');
});

test('profile Logout immediately removes local access and waits for server confirmation', async () => {
  await signInAs('Event Coordinator');
  let complete!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
  fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  expect(sessionStorage.getItem('connectsphere.session')).toBeNull();
  expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Signing out');
  expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
    method: 'POST', headers: { Authorization: 'Bearer test-access-token' },
    keepalive: true, signal: expect.any(AbortSignal),
  });
  await act(async () => { complete(new Response(null, { status: 200 })); });
  expect(screen.getByRole('button', { name: 'Open app' })).toBeInTheDocument();
  cleanup();
  render(<App />);
  expect(screen.getByRole('button', { name: 'Open app' })).toBeInTheDocument();
});

test.each(['offline', 'server failure'])('Logout clears local access and reports unconfirmed revocation on %s', async failure => {
  await signInAs('Event Coordinator');
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (failure === 'server failure') return new Response(null, { status: 503 });
    throw new Error('network down');
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  expect(sessionStorage.getItem('connectsphere.session')).toBeNull();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm server sign-out');
  expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Return to sign in' }));
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

test('the notification drawer opens and closes', async () => {
  await signInAs('Event Coordinator');
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', { name: `Notifications (${NOTIFICATIONS.length})` }),
  );
  const drawer = screen.getByRole('complementary', { name: 'Notifications' });
  expect(
    within(drawer).getByText('Clarification requested on E-201'),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});

test('the dashboard primary action opens the venue catalogue', async () => {
  await signInAs('Event Coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'Search venues' }));
  expect(screen.getByRole('heading', { name: 'Venue catalogue' })).toBeInTheDocument();
  // The primary CTA belongs to the dashboard only.
  expect(screen.queryByRole('button', { name: 'Search venues' })).not.toBeInTheDocument();
});

test('an attention item jumps straight to the screen that resolves it', async () => {
  await signInAs('Event Coordinator');
  fireEvent.click(
    screen.getByRole('button', { name: 'Open: Atrium Hall booking overlaps E-190' }),
  );
  expect(screen.getByRole('heading', { name: 'Booking approval' })).toBeInTheDocument();
  expect(screen.getByText('Overlaps an existing hold')).toBeInTheDocument();
});

test('dashboard links open the event list and the selected event detail', async () => {
  await signInAs('Event Coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'See all events' }));
  expect(screen.getByRole('heading', { name: 'All events' })).toBeInTheDocument();
  fireEvent.click(within(header()).getByRole('button', { name: 'Dashboard' }));
  fireEvent.click(
    screen.getByRole('button', { name: /Northbridge Investor Forum/ }),
  );
  expect(screen.getByRole('heading', { name: 'Event detail' })).toBeInTheDocument();
});

describe('the events table', () => {
  const openTable = async () => {
    await signInAs('Event Coordinator');
    fireEvent.click(within(header()).getByRole('button', { name: 'All events' }));
  };

  test('filters rows by status', async () => {
    await openTable();
    expect(screen.getByText('Product Launch — Tideline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    expect(screen.getByText('Quarterly Partner Dinner')).toBeInTheDocument();
    expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Product Launch — Tideline')).toBeInTheDocument();
  });

  test('a row opens the event detail', async () => {
    await openTable();
    fireEvent.click(screen.getByRole('button', { name: /Board Strategy Offsite/ }));
    expect(screen.getByRole('heading', { name: 'Event detail' })).toBeInTheDocument();
  });

  test('an organiser can see their events list and drill down into details from dashboard or nav', async () => {
    mockLoginResponse('Event Organiser');
    const prevFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/event-requests/101')) {
          return Response.json({
            request: {
              event_id: 101,
              organiser_id: 'user-1',
              organisation: 'Meridian Capital',
              status: 'draft',
              name: 'Annual General Meeting',
              purpose: 'AGM 2026',
              description: 'Yearly shareholder meeting',
              proposed_date: '2026-10-25T10:00:00.000Z',
              expected_attendance: 120,
              venue_requirements: 'Auditorium',
              accessibility_needs: 'Wheelchair ramp',
              equipment_requirements: 'Wireless mics',
              registration_needed: true,
              coordinator_id: null,
              coordinator_name: null,
            },
          });
        }
        if (url.startsWith('/api/event-requests')) {
          return Response.json({
            requests: [
              {
                event_id: 101,
                name: 'Annual General Meeting',
                proposed_date: '2026-10-25T10:00:00.000Z',
                status: 'draft',
                coordinator_id: null,
                coordinator_name: null,
              },
            ],
          });
        }
        return prevFetch(url, init);
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'org@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const seeAllBtn = await screen.findByRole('button', { name: 'See all events' });
    fireEvent.click(seeAllBtn);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your events' })).toBeInTheDocument();
    expect(await screen.findByText('Annual General Meeting')).toBeInTheDocument();

    const eventRow = screen.getByRole('button', { name: /Annual General Meeting/ });
    fireEvent.click(eventRow);

    expect(await screen.findByRole('heading', { level: 1, name: 'Event detail' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Annual General Meeting' })).toBeInTheDocument();
    expect(screen.getByText('AGM 2026')).toBeInTheDocument();
    expect(screen.getByText('Yearly shareholder meeting')).toBeInTheDocument();

    fireEvent.click(within(header()).getByRole('button', { name: 'My events' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your events' })).toBeInTheDocument();
  });
});

describe('the event detail action panel', () => {
  test('an attendee detail view hides the internal capacity warning and approval control', () => {
    render(<EventDetail role="Attendee" onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Quarterly Partner Dinner' })).toBeInTheDocument();
    expect(screen.queryByText(/Capacity check/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
  });

  test('a coordinator gets decision actions, and approving goes to venues', async () => {
    await signInAs('Event Coordinator');
    fireEvent.click(within(header()).getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Review actions')).toBeInTheDocument();
    expect(screen.getByText(/Capacity check/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve request' }));
    expect(screen.getByRole('heading', { name: 'Venue catalogue' })).toBeInTheDocument();
  });

  test('an organiser gets amendment actions instead', async () => {
    await signInAs('Event Organiser');
    fireEvent.click(within(header()).getByRole('button', { name: 'Event detail' }));
    expect(screen.getByText('Your options')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(screen.getByRole('heading', { name: 'Change request' })).toBeInTheDocument();
  });
});

describe('the request form', () => {
  const openForm = async () => {
    await signInAs('Event Organiser');
    fireEvent.click(within(header()).getByRole('button', { name: 'New request' }));
  };

  test('requirement chips toggle when no suitability conflict is reported', () => {
    render(<RequestForm onSubmit={vi.fn()} showConflicts={false} />);
    expect(screen.queryByText(/180 expected attendance rules out/)).not.toBeInTheDocument();
    const chip = screen.getByRole('button', { name: 'Hearing loop' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    const unselected = screen.getByRole('button', { name: 'Parking' });
    expect(unselected).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(unselected);
    expect(unselected).toHaveAttribute('aria-pressed', 'true');
  });

  test('saving a draft creates it and reports what is still outstanding', async () => {
    await openForm();
    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();

    // Save draft now calls POST /api/event-requests (SG2-28) rather than just
    // flipping local state, so the response drives the confirmation copy.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            request: { event_id: 7, status: 'draft' },
            missingForSubmission: ['name', 'purpose'],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText(
        'Draft 7 saved. Still needed to submit: Event name, Purpose.',
      ),
    ).toBeInTheDocument();
  });

  test('submitting goes to the event detail', async () => {
    await openForm();
    // AC2: fill all required fields before submit is enabled.
    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Investor Forum 2026' } });
    fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Partner briefing' } });
    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '12 Oct 2026' } });
    fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText(/Venue requirements/i), { target: { value: 'Stage + loop' } });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'A half-day forum with two keynotes and a panel.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(screen.getByRole('heading', { name: 'Event detail' })).toBeInTheDocument();
  });

  test('saving a draft and submitting sends the accessToken to the submit endpoint', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Investor Forum 2026' } });
    fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Partner briefing' } });
    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '12 Oct 2026' } });
    fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText(/Venue requirements/i), { target: { value: 'Stage + loop' } });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'A half-day forum with two keynotes and a panel.' },
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/event-requests') {
        return new Response(
          JSON.stringify({
            request: { event_id: 42, status: 'draft' },
            missingForSubmission: [],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/event-requests/42/submit') {
        return new Response(
          JSON.stringify({ request: { event_id: 42, status: 'submitted' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Draft 42 saved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('heading', { name: 'Event detail' })).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/42/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-access-token' },
    });
  });
});

describe('editing a draft (SG2-29)', () => {
  test('Edit opens the form pre-filled, and a successful submit returns to My drafts', async () => {
    await signInAs('Event Organiser');
    fireEvent.click(within(header()).getByRole('button', { name: 'My drafts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('heading', { name: 'Edit draft request' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Event name/i)).toHaveValue('Draft Forum');

    // AC2: fill the remaining required fields before submit is enabled.
    fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Partner briefing' } });
    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '12 Oct 2026' } });
    fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText(/Venue requirements/i), { target: { value: 'Stage + loop' } });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'A half-day forum with two keynotes and a panel.' },
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByRole('heading', { name: 'My draft requests' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/9/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-access-token' },
    });
  });
});

test('requesting a venue opens the booking approval screen', async () => {
  await signInAs('Event Coordinator');
  fireEvent.click(within(header()).getByRole('button', { name: 'Venues' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request Atrium Hall' }));
  expect(screen.getByRole('heading', { name: 'Booking approval' })).toBeInTheDocument();
});

test('signed-in Venue Staff navigate to the catalogue and open an editor populated from the API', async () => {
  await signInAs('Venue Staff');
  fireEvent.click(within(header()).getByRole('button', { name: 'Catalogue' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Atrium Hall' }));
  expect(screen.getByLabelText('Venue name')).toHaveValue('Atrium Hall');
  expect(screen.getByLabelText('Capacity')).toHaveValue(100);
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('reserving equipment settles the row', async () => {
  await signInAs('Technical Support Staff');
  fireEvent.click(within(header()).getByRole('button', { name: 'Equipment requests' }));

  const reserveButtons = screen.getAllByRole('button', { name: 'Reserve' });
  expect(reserveButtons.length).toBeGreaterThan(0);
  fireEvent.click(reserveButtons[0]);

  expect(screen.getAllByRole('button', { name: 'Reserve' })).toHaveLength(
    reserveButtons.length - 1,
  );
  // Rows that are already settled cannot be reserved again.
  for (const button of screen.getAllByRole('button', { name: 'Reserved' })) {
    expect(button).toBeDisabled();
  }
});

test('the calendar shows the month grid with real venue availability', async () => {
  await signInAs('Venue Staff');
  const now = new Date();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        from: now.toISOString(),
        to: now.toISOString(),
        venues: [
          {
            venueId: 1,
            name: 'Atrium Hall',
            entries: [
              { start: now.toISOString(), end: new Date(now.getTime() + 3_600_000).toISOString(), kind: 'booking', label: 'confirmed' },
            ],
          },
        ],
      }),
    ),
  );

  fireEvent.click(within(header()).getByRole('button', { name: 'Venue Availability' }));
  expect(await screen.findByText('Atrium Hall · confirmed')).toBeInTheDocument();
  expect(screen.getByText('Booked')).toBeInTheDocument();
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
});

test('an attendee can withdraw and re-register', async () => {
  await signInAs('Attendee');
  expect(
    screen.getByText("You're registered — confirmation sent to your email."),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' }));
  expect(
    screen.getByText('Places are held as soon as you register.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Not registered')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Register' }));
  expect(
    screen.getByText("You're registered — confirmation sent to your email."),
  ).toBeInTheDocument();
});

test('change-request categories toggle', async () => {
  await signInAs('Event Organiser');
  fireEvent.click(within(header()).getByRole('button', { name: 'Change request' }));

  const selected = screen.getByRole('button', { name: 'Expected attendance' });
  expect(selected).toHaveAttribute('aria-pressed', 'true');

  const other = screen.getByRole('button', { name: 'Date or time' });
  expect(other).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(other);
  expect(other).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(other);
  expect(other).toHaveAttribute('aria-pressed', 'false');
});

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import App from './App';
import { NAV, NOTIFICATIONS } from './mock/data';
import { ROLES } from './mock/types';
import type { Role } from './mock/types';

// Auto-cleanup only registers when vitest runs with globals enabled, which
// this project does not, so unmount between tests explicitly.
afterEach(cleanup);

// jsdom has no canvas implementation; the orb hook is written to no-op when
// there is no 2D context, and stubbing this keeps the console clean.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});


/** Walk landing -> login -> signed in as `role`. */
function signInAs(role: Role) {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  fireEvent.click(screen.getByRole('button', { name: role }));
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

test('the sign-in button enters as the selected role', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  // Event Coordinator is the default role.
  expect(screen.getByRole('heading', { name: 'Coordination desk' })).toBeInTheDocument();
});

test('an attendee lands on the event page rather than a dashboard', () => {
  signInAs('Attendee');
  expect(screen.getByRole('heading', { name: 'Event page' })).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Northbridge Investor Forum' }),
  ).toBeInTheDocument();
});

describe('every role can reach every screen in its navigation', () => {
  test.each(ROLES)('%s', (role) => {
    signInAs(role);
    for (const [, navLabel] of NAV[role]) {
      fireEvent.click(within(header()).getByRole('button', { name: navLabel }));
      // Each screen renders its own page heading, so the app is never blank.
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('main')).not.toBeEmptyDOMElement();
    }
  });
});

test('the header role switch re-scopes the whole app', () => {
  signInAs('Event Coordinator');
  expect(screen.getByRole('heading', { name: 'Coordination desk' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Switch role'), {
    target: { value: 'Venue Staff' },
  });
  expect(screen.getByRole('heading', { name: 'Venue desk' })).toBeInTheDocument();
  // Navigation is scoped too — "All events" belongs to the coordinator only.
  expect(
    within(header()).queryByRole('button', { name: 'All events' }),
  ).not.toBeInTheDocument();
});

test('the wordmark signs out back to the landing page', () => {
  signInAs('Event Coordinator');
  fireEvent.click(within(header()).getByRole('button', { name: /ConnectSphere/ }));
  expect(screen.getByRole('button', { name: 'Open app' })).toBeInTheDocument();
});

test('the notification drawer opens and closes', () => {
  signInAs('Event Coordinator');
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

test('the dashboard primary action opens the venue catalogue', () => {
  signInAs('Event Coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'Search venues' }));
  expect(screen.getByRole('heading', { name: 'Venue catalogue' })).toBeInTheDocument();
  // The primary CTA belongs to the dashboard only.
  expect(screen.queryByRole('button', { name: 'Search venues' })).not.toBeInTheDocument();
});

test('an attention item jumps straight to the screen that resolves it', () => {
  signInAs('Event Coordinator');
  fireEvent.click(
    screen.getByRole('button', { name: 'Open: Atrium Hall booking overlaps E-190' }),
  );
  expect(screen.getByRole('heading', { name: 'Booking approval' })).toBeInTheDocument();
  expect(screen.getByText('Overlaps an existing hold')).toBeInTheDocument();
});

test('a dashboard event tile opens the detail screen', () => {
  signInAs('Event Coordinator');
  fireEvent.click(
    screen.getByRole('button', { name: /Northbridge Investor Forum/ }),
  );
  expect(screen.getByRole('heading', { name: 'Event detail' })).toBeInTheDocument();
});

describe('the events table', () => {
  const openTable = () => {
    signInAs('Event Coordinator');
    fireEvent.click(within(header()).getByRole('button', { name: 'All events' }));
  };

  test('filters rows by status', () => {
    openTable();
    expect(screen.getByText('Product Launch — Tideline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    expect(screen.getByText('Quarterly Partner Dinner')).toBeInTheDocument();
    expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Product Launch — Tideline')).toBeInTheDocument();
  });

  test('a row opens the event detail', () => {
    openTable();
    fireEvent.click(screen.getByRole('button', { name: /Board Strategy Offsite/ }));
    expect(screen.getByRole('heading', { name: 'Event detail' })).toBeInTheDocument();
  });
});

describe('the event detail action panel', () => {
  test('a coordinator gets decision actions, and approving goes to venues', () => {
    signInAs('Event Coordinator');
    fireEvent.click(within(header()).getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Review actions')).toBeInTheDocument();
    expect(screen.getByText(/Capacity check/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve request' }));
    expect(screen.getByRole('heading', { name: 'Venue catalogue' })).toBeInTheDocument();
  });

  test('an organiser gets amendment actions instead', () => {
    signInAs('Event Organiser');
    fireEvent.click(within(header()).getByRole('button', { name: 'Event detail' }));
    expect(screen.getByText('Your options')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(screen.getByRole('heading', { name: 'Change request' })).toBeInTheDocument();
  });
});

describe('the request form', () => {
  const openForm = () => {
    signInAs('Event Organiser');
    fireEvent.click(within(header()).getByRole('button', { name: 'New request' }));
  };

  test('requirement chips toggle', () => {
    openForm();
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

  test('saving a draft confirms it was kept', () => {
    openForm();
    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      screen.getByText('Draft saved — you can come back to it any time.'),
    ).toBeInTheDocument();
  });

  test('submitting goes to the event detail', () => {
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(screen.getByRole('heading', { name: 'Event detail' })).toBeInTheDocument();
  });
});

test('requesting a venue opens the booking approval screen', () => {
  signInAs('Event Coordinator');
  fireEvent.click(within(header()).getByRole('button', { name: 'Venues' }));
  fireEvent.click(screen.getByRole('button', { name: 'Request Atrium Hall' }));
  expect(screen.getByRole('heading', { name: 'Booking approval' })).toBeInTheDocument();
});

test('reserving equipment settles the row', () => {
  signInAs('Technical Support');
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

test('the calendar shows the month grid with its legend', () => {
  signInAs('Venue Staff');
  fireEvent.click(within(header()).getByRole('button', { name: 'Availability' }));
  expect(
    screen.getByRole('heading', { name: 'Atrium Hall · October 2026' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Confirmed · E-186')).toBeInTheDocument();
  expect(screen.getByText('Blocked')).toBeInTheDocument();
});

test('an attendee can withdraw and re-register', () => {
  signInAs('Attendee');
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

test('change-request categories toggle', () => {
  signInAs('Event Organiser');
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

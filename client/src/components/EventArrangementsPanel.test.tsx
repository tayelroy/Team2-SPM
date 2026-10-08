import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import EventArrangementsPanel from './EventArrangementsPanel';
import type { EventArrangementsResult } from '../api/eventRequests';

afterEach(() => {
  cleanup();
});

const READY: EventArrangementsResult = {
  event_id: 101,
  arrangements: [
    { key: 'venue', label: 'Venue booking', state: 'ready', detail: '1 venue booking approved.' },
    { key: 'equipment', label: 'Equipment', state: 'ready', detail: '2 equipment requests arranged.' },
    {
      key: 'registration',
      label: 'Registration',
      state: 'ready',
      detail: 'Registration capacity and opening and closing times set.'
    }
  ],
  outstanding: [],
  ready_for_confirmation: true
};

const OUTSTANDING: EventArrangementsResult = {
  event_id: 101,
  arrangements: [
    { key: 'venue', label: 'Venue booking', state: 'outstanding', detail: '1 venue booking still awaiting approval.' },
    { key: 'equipment', label: 'Equipment', state: 'not_required', detail: 'No equipment requested.' },
    { key: 'registration', label: 'Registration', state: 'not_required', detail: 'Registration not required.' }
  ],
  outstanding: ['venue'],
  ready_for_confirmation: false
};

describe('EventArrangementsPanel (SG2-57)', () => {
  test('[NORMAL] [SG2-57:AC1] [SG2-57:AC2] lists each arrangement with its state and detail', () => {
    render(<EventArrangementsPanel arrangements={READY} />);

    for (const arrangement of READY.arrangements) {
      const row = screen.getByTestId(`arrangement-${arrangement.key}`);
      expect(within(row).getByText(arrangement.label)).toBeInTheDocument();
      expect(within(row).getByText(arrangement.detail)).toBeInTheDocument();
    }
  });

  test('[NORMAL] [SG2-57:AC3] shows "Ready for confirmation" when every required arrangement is ready', () => {
    render(<EventArrangementsPanel arrangements={READY} />);

    expect(within(screen.getByTestId('readiness-badge')).getByText(/ready for confirmation/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('arrangement-venue-state')).getByText(/ready/i)).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-57:AC2] [SG2-57:AC3] labels outstanding and not-required arrangements and withholds readiness', () => {
    render(<EventArrangementsPanel arrangements={OUTSTANDING} />);

    expect(within(screen.getByTestId('readiness-badge')).getByText(/outstanding/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('arrangement-venue-state')).getByText(/outstanding/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('arrangement-equipment-state')).getByText(/not required/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('arrangement-registration-state')).getByText(/not required/i)).toBeInTheDocument();
  });
});

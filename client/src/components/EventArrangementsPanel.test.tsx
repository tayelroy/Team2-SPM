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
    { key: 'equipment', label: 'Equipment', state: 'ready', detail: '2 equipment requests reserved and placed.' },
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

describe('EventArrangementsPanel once confirmed (SG2-58)', () => {
  test('[NORMAL] [SG2-58:AC1] a confirmed event says Confirmed, not "Ready for confirmation"', () => {
    render(<EventArrangementsPanel arrangements={READY} confirmed />);
    expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Confirmed');
    expect(screen.queryByText(/ready for confirmation/i)).not.toBeInTheDocument();
  });
});

describe('EventArrangementsPanel safety check (SG2-94)', () => {
  test('[NORMAL] [SG2-94:AC4] [SG2-100:AC3] the safety check is a step: outstanding with its reason, holding the event back', () => {
    const detail = "Awaiting the Safety Officer's operational safety check.";
    render(<EventArrangementsPanel arrangements={{
      ...READY,
      arrangements: [...READY.arrangements, { key: 'safety', label: 'Safety check', state: 'outstanding', detail }],
      outstanding: ['safety'],
      ready_for_confirmation: false
    }} />);
    const row = screen.getByTestId('arrangement-safety');
    expect(within(row).getByText('Safety check')).toBeInTheDocument();
    expect(within(row).getByText(detail)).toBeInTheDocument();
    expect(screen.getByTestId('arrangement-safety-state')).toHaveTextContent('Outstanding');
    expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Arrangements outstanding');
  });
});

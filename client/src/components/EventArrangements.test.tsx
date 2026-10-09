import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import EventArrangements from './EventArrangements';
import * as api from '../api/eventRequests';
import type { EventArrangementsResult } from '../api/eventRequests';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RESULT: EventArrangementsResult = {
  event_id: 101,
  arrangements: [
    { key: 'venue', label: 'Venue booking', state: 'ready', detail: '1 venue booking approved.' },
    { key: 'equipment', label: 'Equipment', state: 'not_required', detail: 'No equipment requested.' },
    { key: 'registration', label: 'Registration', state: 'not_required', detail: 'Registration not required.' }
  ],
  outstanding: [],
  ready_for_confirmation: true
};

describe('EventArrangements (SG2-57)', () => {
  test('[NORMAL] [SG2-57:AC1] [SG2-57:AC3] renders the panel once the readiness loads', async () => {
    vi.spyOn(api, 'getEventArrangements').mockResolvedValue({ ok: true, arrangements: RESULT });

    render(<EventArrangements eventId={101} accessToken="token-1" />);

    await waitFor(() => expect(screen.getByTestId('arrangements-panel')).toBeInTheDocument());
    expect(api.getEventArrangements).toHaveBeenCalledWith(101, 'token-1');
  });

  test('[FAILURE] [SG2-57:AC1] stays silent when the readiness read fails', async () => {
    const spy = vi
      .spyOn(api, 'getEventArrangements')
      .mockResolvedValue({ ok: false, kind: 'unavailable', message: 'down' });

    const { container } = render(<EventArrangements eventId={101} accessToken="token-1" />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="arrangements-panel"]')).toBeNull();
  });

  test('[BOUNDARY] [SG2-57:AC1] does not fetch without an access token', () => {
    const spy = vi.spyOn(api, 'getEventArrangements');

    render(<EventArrangements eventId={101} accessToken={null} />);

    expect(spy).not.toHaveBeenCalled();
  });
});

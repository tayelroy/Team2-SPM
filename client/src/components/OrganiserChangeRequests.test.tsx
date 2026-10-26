import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/changeRequests';
import OrganiserChangeRequests, { formatChangeValue } from './OrganiserChangeRequests';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const REQUEST: api.OwnChangeRequest = {
  id: '41', requested_at: '2026-10-24T02:00:00.000Z', reason: 'More guests confirmed.', status: 'pending',
  changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }],
};

function listing(requests: api.OwnChangeRequest[] = []) {
  return vi.spyOn(api, 'fetchOwnChangeRequests').mockResolvedValue({ ok: true, requests });
}

function fill(field: string, value: string, reason: string) {
  fireEvent.change(screen.getByLabelText('What should change'), { target: { value: field } });
  if (field) fireEvent.change(screen.getByLabelText(/^New /), { target: { value } });
  fireEvent.change(screen.getByLabelText('Why it should change'), { target: { value: reason } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask for this change' }));
}

describe('OrganiserChangeRequests: outstanding requests (SG2-64 AC3)', () => {
  test('[NORMAL] [BOUNDARY] [FAILURE] [SG2-64:AC1] [SG2-64:AC3] outstanding requests list what, from, to and why; none says so, a failed load says why, and a late reply is ignored', async () => {
    {
      const list = listing([REQUEST, {
        ...REQUEST, id: '42', reason: 'Speaker moved.',
        changes: [{ field: 'proposed_date', label: 'Event date and time', from: null, to: '2030-06-27T02:00:00.000Z' }],
      }]);
      render(<OrganiserChangeRequests eventId={12} accessToken="token-12" />);
      const items = within(await screen.findByRole('list', { name: 'Outstanding change requests' })).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Expected attendance: 120 → 180. Reason: More guests confirmed.');
      expect(items[0]).toHaveTextContent('Asked 24 Oct 2026, 10:00 SGT, waiting for your coordinator.');
      expect(items[1]).toHaveTextContent('Event date and time: Not set → 27 Jun 2030, 10:00 SGT.');
      expect(list).toHaveBeenCalledWith(12, 'token-12');
    }
    {
      cleanup(); vi.restoreAllMocks();
      listing();
      render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      expect(await screen.findByText('You have no outstanding change requests on this event.')).toBeVisible();
    }
    {
      cleanup(); vi.restoreAllMocks();
      vi.spyOn(api, 'fetchOwnChangeRequests').mockResolvedValue({ ok: false, kind: 'unavailable', message: 'Could not reach the server.' });
      render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    }
    {
      cleanup(); vi.restoreAllMocks();
      let resolve!: (value: api.FetchOwnChangeRequestsResult) => void;
      vi.spyOn(api, 'fetchOwnChangeRequests').mockReturnValue(new Promise((done) => { resolve = done; }));
      const { unmount } = render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      unmount();
      await act(async () => resolve({ ok: true, requests: [REQUEST] }));
      expect(screen.queryByRole('list', { name: 'Outstanding change requests' })).not.toBeInTheDocument();
    }
    {
      cleanup(); vi.restoreAllMocks();
      expect(formatChangeValue('name', 'Gala')).toBe('Gala');
      expect(formatChangeValue('description', '')).toBe('Not set');
      expect(formatChangeValue('proposed_date', 'not a date')).toBe('Date not available');
    }
  });
});

describe('OrganiserChangeRequests: asking for a change (SG2-64 AC1/AC2)', () => {
  test("[NORMAL] [BOUNDARY] [CONFLICT] [FAILURE] [SG2-64:AC1] [SG2-64:AC2] [SG2-64:AC4] asking sends a number, a date or text and confirms; incomplete or over-long asks are stopped, and the server's refusal keeps the form", async () => {
    {
      const list = listing();
      const raise = vi.spyOn(api, 'raiseChangeRequest').mockResolvedValue({ ok: true, request: REQUEST, coordinatorNotified: true });
      render(<OrganiserChangeRequests eventId={12} accessToken="token-12" />);
      await screen.findByText('You have no outstanding change requests on this event.');
      fill('expected_attendance', '180', '  More guests confirmed.  ');
      expect(await screen.findByRole('status')).toHaveTextContent('Your change request was sent to your coordinator.');
      expect(raise).toHaveBeenCalledWith(12, { field: 'expected_attendance', to: 180, reason: 'More guests confirmed.' }, 'token-12');
      expect(screen.getByLabelText('What should change')).toHaveValue('');
      expect(screen.getByLabelText('Why it should change')).toHaveValue('');
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    }
    {
      cleanup(); vi.restoreAllMocks();
      listing();
      const raise = vi.spyOn(api, 'raiseChangeRequest').mockResolvedValue({ ok: true, request: REQUEST, coordinatorNotified: false });
      render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      fill('proposed_date', '2030-06-27T10:00', 'Speaker moved');
      expect(await screen.findByRole('status')).toHaveTextContent('Your coordinator will see it once one is assigned.');
      expect(raise).toHaveBeenLastCalledWith(12,
        { field: 'proposed_date', to: new Date('2030-06-27T10:00').toISOString(), reason: 'Speaker moved' }, 't');
      fill('description', 'A longer agenda', 'More sessions');
      await vi.waitFor(() => expect(raise).toHaveBeenLastCalledWith(12,
        { field: 'description', to: 'A longer agenda', reason: 'More sessions' }, 't'));
    }
    {
      cleanup(); vi.restoreAllMocks();
      listing();
      const raise = vi.spyOn(api, 'raiseChangeRequest').mockResolvedValue({ ok: true, request: REQUEST, coordinatorNotified: true });
      render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      const message = 'Choose what to change, give the new value, and a reason up to 1000 characters.';
      fill('', '', 'Why');
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      fill('name', '   ', 'Why');
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      fill('name', 'Gala', 'r'.repeat(1001));
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(raise).not.toHaveBeenCalled();
      fill('name', 'Gala', 'r'.repeat(1000));
      await vi.waitFor(() => expect(raise).toHaveBeenCalledTimes(1));
    }
    {
      cleanup(); vi.restoreAllMocks();
      listing();
      const raise = vi.spyOn(api, 'raiseChangeRequest');
      render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      fireEvent.change(screen.getByLabelText('What should change'), { target: { value: 'proposed_date' } });
      const input = screen.getByLabelText('New event date and time');
      // jsdom keeps a datetime-local value it cannot parse only when set directly.
      Object.defineProperty(input, 'value', { configurable: true, get: () => 'soon', set: () => {} });
      fireEvent.change(input, { target: { value: 'soon' } });
      fireEvent.change(screen.getByLabelText('Why it should change'), { target: { value: 'Why' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask for this change' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Give a valid date and time.');
      expect(raise).not.toHaveBeenCalled();
    }
    {
      cleanup(); vi.restoreAllMocks();
      listing();
      const raise = vi.spyOn(api, 'raiseChangeRequest')
        .mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'A change cannot be requested on a draft, cancelled, rejected or completed event.' })
        .mockResolvedValueOnce({ ok: false, kind: 'validation', message: 'Invalid change request', details: ['expected_attendance must be at least 1.'] });
      render(<OrganiserChangeRequests eventId={12} accessToken="t" />);
      fill('expected_attendance', '180', 'Why');
      expect(await screen.findByRole('alert')).toHaveTextContent('A change cannot be requested on a draft, cancelled, rejected or completed event.');
      expect(screen.getByLabelText('New expected attendance')).toHaveValue(180);
      fireEvent.click(screen.getByRole('button', { name: 'Ask for this change' }));
      await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('expected_attendance must be at least 1.'));
      expect(raise).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  });
});

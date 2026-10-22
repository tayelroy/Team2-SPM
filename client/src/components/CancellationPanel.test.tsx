import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/eventCancellation';
import CancellationPanel, { type CancellationPanelProps } from './CancellationPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base: CancellationPanelProps = {
  eventId: 7, accessToken: 'token-7', mode: 'organiser', status: 'planning',
  requestedAt: null, reason: null, cancelledAt: null, onChanged: () => {}
};
const ASKED = { requestedAt: '2026-10-21T01:00:00.000Z', reason: 'The keynote speaker withdrew' };

describe('CancellationPanel: the organiser asks (SG2-67 AC1)', () => {
  test('[NORMAL] [SG2-67:AC1] the organiser asks with a trimmed reason and the event reloads', async () => {
    const onChanged = vi.fn();
    const ask = vi.spyOn(api, 'requestCancellation').mockResolvedValue({ ok: true, value: { requestedAt: 'x', coordinatorNotified: true } });
    render(<CancellationPanel {...base} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: '  Speaker withdrew  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask to cancel' }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(ask).toHaveBeenCalledWith(7, 'Speaker withdrew', 'token-7');
  });

  test('[BOUNDARY] [SG2-67:AC1] a blank reason or one of 501 characters is stopped before sending; 500 is sent', async () => {
    const ask = vi.spyOn(api, 'requestCancellation').mockResolvedValue({ ok: true, value: { requestedAt: 'x', coordinatorNotified: false } });
    render(<CancellationPanel {...base} />);
    const field = screen.getByLabelText('Reason for cancelling');
    for (const value of ['   ', 'x'.repeat(501)]) {
      fireEvent.change(field, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask to cancel' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason for the cancellation, up to 500 characters.');
    }
    expect(ask).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'y'.repeat(500) } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask to cancel' }));
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith(7, 'y'.repeat(500), 'token-7'));
  });

  test('[CONFLICT] [SG2-67:AC1] a refused request shows the server\'s reason and keeps the draft', async () => {
    const onChanged = vi.fn();
    vi.spyOn(api, 'requestCancellation').mockResolvedValue({ ok: false, message: 'A cancellation has already been requested for this event.' });
    render(<CancellationPanel {...base} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask to cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A cancellation has already been requested for this event.');
    expect(screen.getByLabelText('Reason for cancelling')).toHaveValue('Again');
    expect(onChanged).not.toHaveBeenCalled();
  });

  test('[NORMAL] [SG2-67:AC1] once asked, the organiser sees the request waiting for the coordinator', () => {
    render(<CancellationPanel {...base} {...ASKED} />);
    expect(screen.getByRole('region', { name: 'Cancellation' })).toHaveTextContent(
      'You asked to cancel this event on 21 Oct 2026, 09:00 SGT. Reason: The keynote speaker withdrew');
    expect(screen.getByText('Your coordinator will carry out the cancellation.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('CancellationPanel: the coordinator cancels (SG2-67 AC1, AC5)', () => {
  test('[NORMAL] [SG2-67:AC1] the coordinator confirms, the event is cancelled and reloads', async () => {
    const onChanged = vi.fn();
    const cancel = vi.spyOn(api, 'cancelEvent').mockResolvedValue({
      ok: true, value: { cancelledAt: 'x', bookingsReleased: 1, attendeesNotified: 2 }
    });
    render(<CancellationPanel {...base} mode="coordinator" {...ASKED} onChanged={onChanged} />);
    expect(screen.getByRole('region', { name: 'Cancellation' })).toHaveTextContent('The organiser asked to cancel this event on');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    expect(screen.getByText(/It cannot be undone\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel event' }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith(7, 'token-7');
  });

  test('[CONFLICT] [SG2-67:AC1] keeping the event sends nothing, and a refusal returns to the first step with the reason', async () => {
    const cancel = vi.spyOn(api, 'cancelEvent').mockResolvedValue({ ok: false, message: 'Only the assigned Event Coordinator can cancel this event.' });
    render(<CancellationPanel {...base} mode="coordinator" {...ASKED} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep event' }));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the assigned Event Coordinator can cancel this event.');
    expect(screen.getByRole('button', { name: 'Cancel event' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-67:AC1] until the organiser asks, the coordinator sees no cancellation panel', () => {
    const { container } = render(<CancellationPanel {...base} mode="coordinator" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('[NORMAL] [SG2-67:AC4] [SG2-67:AC5] a cancelled event says when and why, offers nothing, and points to a new request', () => {
    render(<CancellationPanel {...base} mode="coordinator" status="cancelled" {...ASKED} cancelledAt="2026-10-21T02:30:00.000Z" />);
    expect(screen.getByRole('region', { name: 'Cancellation' })).toHaveTextContent(
      'This event was cancelled on 21 Oct 2026, 10:30 SGT. Reason: The keynote speaker withdrew A similar event needs a new request.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('[FAILURE] [SG2-67:AC5] an older cancellation with no record still reads as final', () => {
    render(<CancellationPanel {...base} status="cancelled" />);
    expect(screen.getByRole('region', { name: 'Cancellation' })).toHaveTextContent(
      'This event was cancelled. A similar event needs a new request.');
    expect(screen.queryByLabelText('Reason for cancelling')).not.toBeInTheDocument();
  });
});

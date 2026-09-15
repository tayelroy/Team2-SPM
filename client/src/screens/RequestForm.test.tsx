/**
 * RequestForm — Vitest / React Testing Library tests for SG2-30 (Phase 4).
 *
 * AC1: Successful submission calls `PATCH /api/event-requests/:id/submit`
 *      with a Bearer token and fires `onSuccess`.
 * AC2: Submit button is disabled while mandatory fields are empty; inline
 *      errors appear after a failed submit attempt; server errors (400/409/503)
 *      surface as a visible alert banner.
 * AC3: EventDetail locks the organiser action panel when `eventStatus === 'submitted'`.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import EventDetail from './EventDetail';
import RequestForm from './RequestForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  eventId: 'evt-abc-123',
  accessToken: 'test-token',
  onSuccess: vi.fn(),
  onSaveDraft: vi.fn(),
};

/** Fill all mandatory fields so the submit button becomes enabled. */
function fillAllFields() {
  fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Forum 2026' } });
  fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Partner briefing' } });
  fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '12 Oct 2026' } });
  fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: '180' } });
  fireEvent.change(screen.getByLabelText(/Venue requirements/i), { target: { value: 'Stage + loop' } });
  fireEvent.change(screen.getByLabelText(/Description/i), {
    target: { value: 'A half-day forum with keynotes and a panel.' },
  });
}

// ─── AC2: Submit button disabled state ──────────────────────────────────────

describe('AC2 — submit button disabled until all fields are filled', () => {
  test('submit button is disabled when the form is empty', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: /Submit request/i })).toBeDisabled();
  });

  test('submit button is disabled when only some fields are filled', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Forum' } });
    expect(screen.getByRole('button', { name: /Submit request/i })).toBeDisabled();
  });

  test('submit button becomes enabled when all required fields are filled', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    expect(screen.getByRole('button', { name: /Submit request/i })).not.toBeDisabled();
  });

  test('shows a count of empty required fields after first interaction', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    // Initially shows the default hint (no interaction yet).
    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
    // After touching a field and clearing it, the count appears.
    const nameField = screen.getByLabelText(/Event name/i);
    fireEvent.change(nameField, { target: { value: 'x' } });
    fireEvent.change(nameField, { target: { value: '' } });
    expect(screen.getByText(/required field/i)).toBeInTheDocument();
  });

  test('inline error appears for a touched field left blank', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    // Touch and clear the event name field.
    const nameField = screen.getByLabelText(/Event name/i);
    fireEvent.change(nameField, { target: { value: 'x' } });
    fireEvent.change(nameField, { target: { value: '' } });
    expect(screen.getByText('Event name is required')).toBeInTheDocument();
  });
});

// ─── AC1: Successful submission ──────────────────────────────────────────────

describe('AC1 — successful submission', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
  });

  test('calls the submit endpoint with the correct method, URL, and token', async () => {
    const onSuccess = vi.fn();
    render(<RequestForm {...DEFAULT_PROPS} onSuccess={onSuccess} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/evt-abc-123/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  test('shows a loading label while the request is in flight', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((res) => { resolve = res; })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(screen.getByRole('button', { name: /Submitting…/i })).toBeInTheDocument();
    resolve(new Response(null, { status: 200 }));
  });

  test('button is disabled during submission to prevent double-click', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((res) => { resolve = res; })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    const btn = screen.getByRole('button', { name: /Submitting…/i });
    expect(btn).toBeDisabled();
    resolve(new Response(null, { status: 200 }));
  });
});

// ─── AC2: Server error banners ───────────────────────────────────────────────

describe('AC2 — server error banners', () => {
  test('shows a 400 banner listing the missing fields returned by the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ missing: ['name', 'description'] }),
          { status: 400 },
        ),
      ),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Event name.*Description/i),
    ).toBeInTheDocument();
  });

  test('shows a 409 conflict banner when the request is already submitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 409 })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/already been submitted/i),
    ).toBeInTheDocument();
  });

  test('shows a 503 unavailable banner when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Could not reach the server/i),
    ).toBeInTheDocument();
  });

  test('shows an unavailable banner when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Could not reach the server/i),
    ).toBeInTheDocument();
  });
});

// ─── AC3: EventDetail — submitted immutability ───────────────────────────────

describe('AC3 — EventDetail locks organiser actions when submitted', () => {
  const navigate = vi.fn();

  test('shows action buttons normally for an organiser when status is draft', () => {
    render(
      <EventDetail role="Event Organiser" onNavigate={navigate} eventStatus="draft" />,
    );
    expect(screen.getByRole('button', { name: 'Edit request' })).toBeInTheDocument();
  });

  test('replaces action buttons with a locked notice when status is submitted', () => {
    render(
      <EventDetail role="Event Organiser" onNavigate={navigate} eventStatus="submitted" />,
    );
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Editing disabled/i })).toBeInTheDocument();
    expect(screen.getByText(/has been submitted and is now with your coordinator/i)).toBeInTheDocument();
  });

  test('coordinator sees action buttons regardless of submitted status', () => {
    render(
      <EventDetail role="Event Coordinator" onNavigate={navigate} eventStatus="submitted" />,
    );
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeInTheDocument();
  });

  test('locking notice is case-insensitive to the status string', () => {
    render(
      <EventDetail role="Event Organiser" onNavigate={navigate} eventStatus="Submitted" />,
    );
    expect(screen.getByRole('status', { name: /Editing disabled/i })).toBeInTheDocument();
  });
});

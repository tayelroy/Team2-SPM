import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AssignmentQueue from './AssignmentQueue';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A fresh Response per call: React StrictMode runs effects twice. */
function api(reply: () => Response) {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('AssignmentQueue (SG2-87)', () => {
  test('[NORMAL] [SG2-87:AC3] each entry shows its name, organiser, proposed date and time, attendance and submitted date', async () => {
    api(() => Response.json({ entries: [{
      event_id: 1, name: 'Leadership Forum', organiser_name: 'Olivia Organiser',
      proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 120, submitted_at: '2026-10-06T01:30:00.000Z',
    }] }));
    render(<AssignmentQueue accessToken="tok" />);
    const entry = await screen.findByRole('article', { name: 'Leadership Forum' });
    expect(within(entry).getByText('Olivia Organiser')).toBeInTheDocument();
    expect(within(entry).getByText('15 Jun 2030, 10:00 am')).toBeInTheDocument();
    expect(within(entry).getByText('120')).toBeInTheDocument();
    expect(within(entry).getByText('6 Oct 2026, 9:30 am')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '1 request awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-87:AC3] missing details read Not recorded, an empty name reads Untitled request, and the count pluralises', async () => {
    api(() => Response.json({ entries: [
      { event_id: 2, name: '  ', organiser_name: null, proposed_date: null, expected_attendance: null, submitted_at: null },
      { event_id: 3, name: 'Second', organiser_name: 'Oscar', proposed_date: null, expected_attendance: 0, submitted_at: null },
    ] }));
    render(<AssignmentQueue accessToken="tok" />);
    const untitled = await screen.findByRole('article', { name: 'Untitled request' });
    expect(within(untitled).getAllByText('Not recorded')).toHaveLength(4);
    expect(within(screen.getByRole('article', { name: 'Second' })).getByText('0')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '2 requests awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-87:AC5] an empty queue says nothing is waiting', async () => {
    api(() => Response.json({ entries: [] }));
    render(<AssignmentQueue accessToken="tok" />);
    expect(await screen.findByRole('heading', { name: 'No requests awaiting a coordinator' })).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-87:AC2] an account that is not the Lead is told so', async () => {
    api(() => new Response(null, { status: 403 }));
    render(<AssignmentQueue accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the Event Coordinator Lead can see the unassigned queue.');
  });

  test('[FAILURE] [SG2-87:AC2] an unavailable queue can be retried', async () => {
    let healthy = false;
    api(() => (healthy ? Response.json({ entries: [] }) : new Response(null, { status: 503 })));
    render(<AssignmentQueue accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The unassigned queue is temporarily unavailable. Please try again.');
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No requests awaiting a coordinator' })).toBeInTheDocument();
  });
});

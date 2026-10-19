import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import SafetyChecks from './SafetyChecks';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const RAW = {
  event_id: 7, safety_check_revision: 3, name: 'Open Day', organisation: 'SMU', proposed_date: '2031-11-01T01:00:00.000Z',
  awaiting_since: '2031-10-01T02:00:00.000Z', expected_attendance: 120, accessibility_needs: 'Wheelchair seating',
  expected_crowd_movement: 'Enter by the east doors, leave by the west doors',
  venues: [{ request_id: 11, venue_id: 4, venue_name: 'Atrium Hall', location: 'Level 1', capacity: 300, layout: 'theatre',
    starts_at: '2031-11-01T01:00:00.000Z', ends_at: '2031-11-01T09:00:00.000Z', accessibility_features: 'Step-free entrance',
    emergency_access: 'Two exits onto the east concourse', known_restrictions: 'No open flames' }],
  equipment: [{ request_id: 21, equipment_name: 'Speakers', quantity: 2, placement_venue_name: 'Atrium Hall',
    placement_position: 'Stage left', arrangement_notes: 'Cable ramps' }],
};

/** A fresh Response per call: React StrictMode runs effects twice. */
function api(...replies: (() => Response)[]) {
  const fetch = vi.fn();
  for (const reply of replies) fetch.mockImplementationOnce(() => Promise.resolve(reply()));
  fetch.mockImplementation(() => Promise.resolve(replies.at(-1)!()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('SafetyChecks (SG2-91)', () => {
  test('[NORMAL] [SG2-91:AC2] [SG2-91:AC3] each event shows everything the safety review needs', async () => {
    const fetch = api(() => Response.json({ events: [RAW] }));
    render(<SafetyChecks accessToken="tok" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading events awaiting a safety check');
    const event = await screen.findByRole('article', { name: 'Open Day' });
    expect(screen.getByRole('heading', { level: 2, name: '1 event awaiting a safety check' })).toBeInTheDocument();
    expect(within(event).getByText('#7 · Awaiting since 1 Oct 2031, 10:00 am')).toBeInTheDocument();
    for (const value of ['SMU', '1 Nov 2031, 9:00 am', '120', 'Wheelchair seating', 'Enter by the east doors, leave by the west doors']) {
      expect(within(event).getByText(value)).toBeInTheDocument();
    }
    const venues = within(event).getByRole('region', { name: 'Venues for Open Day' });
    for (const value of ['Atrium Hall · Level 1', '300', 'Theatre', '1 Nov 2031, 9:00 am – 1 Nov 2031, 5:00 pm',
      'Step-free entrance', 'Two exits onto the east concourse', 'No open flames']) {
      expect(within(venues).getByText(value)).toBeInTheDocument();
    }
    const equipment = within(event).getByRole('region', { name: 'Equipment for Open Day' });
    for (const value of ['2 × Speakers', 'Atrium Hall — Stage left', 'Cable ramps']) {
      expect(within(equipment).getByText(value)).toBeInTheDocument();
    }
    expect(fetch).toHaveBeenCalledWith('/api/safety-checks', { method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  test('[BOUNDARY] [SG2-91:AC3] unrecorded details say so, a venue smaller than the attendance is called out, and no equipment is stated', async () => {
    api(() => Response.json({ events: [
      { event_id: 8, safety_check_revision: 1, name: '  ', expected_attendance: 120, accessibility_needs: '   ',
        venues: [{ request_id: 12, venue_name: '', capacity: 40, layout: 'other' },
          { request_id: 13, venue_name: 'Studio', capacity: 200, layout: 'unlisted' },
          { request_id: 14, venue_name: 'Annex' }],
        equipment: [] },
      { event_id: 9, safety_check_revision: 1, name: 'Bare', venues: [],
        equipment: [{ request_id: 31, equipment_name: '', quantity: 1, placement_position: 'Corner' },
          { request_id: 32, equipment_name: 'Lights', quantity: 4, placement_venue_name: 'Studio' }] },
    ] }));
    render(<SafetyChecks accessToken="tok" />);
    const untitled = await screen.findByRole('article', { name: 'Untitled event' });
    expect(within(untitled).getByText('#8')).toBeInTheDocument();
    expect(within(untitled).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(6);
    expect(within(untitled).getByText('40 (below expected attendance of 120)')).toBeInTheDocument();
    expect(within(untitled).getByText('Venue no longer listed')).toBeInTheDocument();
    expect(within(untitled).getByText('Other')).toBeInTheDocument();
    expect(within(untitled).getByText('unlisted')).toBeInTheDocument();
    expect(within(untitled).getByText('200')).toBeInTheDocument();
    expect(within(untitled).getByText('No equipment requested.')).toBeInTheDocument();
    const bare = screen.getByRole('article', { name: 'Bare' });
    expect(within(bare).getByText('1 × Equipment no longer listed')).toBeInTheDocument();
    // A position without a placement venue is not a placement.
    const bareEquipment = within(bare).getByRole('region', { name: 'Equipment for Bare' });
    expect(within(bareEquipment).getAllByText('Not recorded')).toHaveLength(3);
    expect(within(bareEquipment).getByText('Studio')).toBeInTheDocument();
    expect(within(bareEquipment).queryByText(/Corner/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '2 events awaiting a safety check' })).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-91:AC2] an empty list explains when events appear', async () => {
    api(() => Response.json({ events: [] }));
    render(<SafetyChecks accessToken="tok" />);
    expect(await screen.findByRole('heading', { level: 2, name: 'No events awaiting a safety check' })).toBeInTheDocument();
    expect(screen.getByText(/once all of its venue bookings are approved and its equipment is reserved/)).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-91:AC1] refreshing drops an event whose arrangements changed since the list was opened', async () => {
    const fetch = api(() => Response.json({ events: [RAW, { ...RAW, event_id: 8, name: 'Gala' }] }),
      () => Response.json({ events: [{ ...RAW, event_id: 8, name: 'Gala' }] }));
    render(<SafetyChecks accessToken="tok" />);
    expect(await screen.findByRole('article', { name: 'Open Day' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('heading', { level: 2, name: '1 event awaiting a safety check' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Open Day' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Gala' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[CONFLICT] [SG2-91:AC2] an answer arriving after the screen closed is ignored', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((yes) => { resolve = yes; })));
    const { unmount } = render(<SafetyChecks accessToken="tok" />);
    unmount();
    await act(async () => resolve(Response.json({ events: [RAW] })));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  test.each([
    [403, 'Only Safety Officers can open the safety check list.'],
    [503, 'The safety check list is temporarily unavailable. Please try again.'],
  ])('[FAILURE] [SG2-91:AC4] a %i shows why the list is not shown, and Retry reloads it', async (status, message) => {
    const fetch = api(() => new Response(null, { status }), () => Response.json({ events: [] }));
    render(<SafetyChecks accessToken="tok" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'No events awaiting a safety check' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('[FAILURE] [SG2-91:AC2] an empty list can be refreshed', async () => {
    const fetch = api(() => Response.json({ events: [] }), () => Response.json({ events: [RAW] }));
    render(<SafetyChecks accessToken="tok" />);
    await screen.findByRole('heading', { level: 2, name: 'No events awaiting a safety check' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('article', { name: 'Open Day' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

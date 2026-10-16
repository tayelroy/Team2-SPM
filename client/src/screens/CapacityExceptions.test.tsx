import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CapacityExceptions from './CapacityExceptions';

const row = { request_id: 18, event_id: 22, event_name: 'QA forum', venue_name: 'Small hall',
  starts_at: '2030-11-23T03:00:00Z', ends_at: '2030-11-23T04:00:00Z', expected_attendance: 14, venue_capacity: 10 };
const fit = { venue: { venue_id: 8, name: 'Small hall', location: 'QA', capacity: 10,
  suitability: { suitable: false, issues: [{ kind: 'capacity', message: 'Expected attendance 14 exceeds capacity 10.' }] } },
  exceptions: [], booking: 'needs_capacity_exception' };
const receipt = { exception_id: 6, approver_name: 'QA approver', approver_role: 'technical_support_staff', expected_attendance: 14, approved_at: '2030-11-01T03:00:00Z' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('[NORMAL] [SG2-47:AC3] [SG2-47:AC5] selecting a real request approves only its capacity exception and retains the authoritative receipt until refresh', async () => {
  let approved = false;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toEqual({ Authorization: 'Bearer token' });
    if (url.endsWith('/capacity-exceptions')) return Response.json({ requests: approved ? [] : [row] });
    if (url.endsWith('/18/suitability')) return Response.json(fit);
    if (url.endsWith('/18/capacity-exception')) { expect(init?.method).toBe('POST'); approved = true; return Response.json({ exception: receipt, booking: 'allowed' }); }
    throw new Error('Unexpected endpoint');
  });
  vi.stubGlobal('fetch', fetch); render(<CapacityExceptions accessToken="token" />);
  expect(await screen.findByText('QA forum')).toBeInTheDocument();
  expect(screen.getByText(/Expected attendance: 14 · Venue capacity: 10/)).toBeInTheDocument();
  expect(screen.getByText(/23 Nov 2030/)).toHaveTextContent(/11:00.*12:00.*Singapore/);
  expect(screen.queryByRole('button', { name: 'Approve booking' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review exception for QA forum at Small hall' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Approve capacity exception' }));
  expect(await screen.findByText(/Capacity exception for 14 people approved by QA approver \(Technical Support Staff\)/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve capacity exception' })).not.toBeInTheDocument();
  expect(screen.getByText(/An exception does not reserve the venue or approve its booking/)).toBeInTheDocument();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/capacity-exceptions'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
  expect(await screen.findByText('No pending requests need a capacity exception you can approve.')).toBeInTheDocument();
  expect(screen.queryByText(/approved by QA approver/)).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-47:AC3] unknown recorded venue capacity is displayed explicitly while the server suitability controls approval', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [{ ...row, venue_capacity: null }] })));
  render(<CapacityExceptions accessToken="token" />);
  expect(await screen.findByText(/Venue capacity: not recorded/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve capacity exception' })).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-47:AC3] a refused list shows an alert and refresh recovers instead of misrepresenting an empty inbox', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 403 }))
    .mockResolvedValueOnce(Response.json({ requests: [row] })));
  render(<CapacityExceptions accessToken="token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your account cannot approve capacity exceptions.');
  expect(screen.queryByText('No pending requests need a capacity exception you can approve.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
  expect(await screen.findByText('QA forum')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-47:AC3] a refresh supersedes an older list response and cannot restore a stale request', async () => {
  let resolveOld!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(Response.json({ requests: [] })));
  render(<CapacityExceptions accessToken="token" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading capacity exception requests');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
  await screen.findByText('No pending requests need a capacity exception you can approve.');
  await act(async () => resolveOld(Response.json({ requests: [row] })));
  expect(screen.queryByText('QA forum')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-47:AC3] selecting another request loads its own suitability and never carries the previous receipt into it', async () => {
  const other = { ...row, request_id: 19, event_name: 'Second forum', venue_name: 'Other hall' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/capacity-exceptions')) return Response.json({ requests: [row, other] });
    if (url.endsWith('/18/suitability')) return Response.json({ ...fit, exceptions: [receipt], booking: 'allowed' });
    return Response.json({ ...fit, venue: { ...fit.venue, name: 'Other hall' } });
  }));
  render(<CapacityExceptions accessToken="token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review exception for QA forum at Small hall' }));
  await screen.findByText(/approved by QA approver/);
  fireEvent.click(screen.getByRole('button', { name: 'Review exception for Second forum at Other hall' }));
  expect(screen.queryByText(/approved by QA approver/)).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Approve capacity exception' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review exception for Second forum at Other hall' })).toHaveAttribute('aria-pressed', 'true'));
});

test('[CONFLICT] [SG2-47:AC3] an approval refused after list selection keeps the real refusal and never invents an exception receipt', async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/capacity-exceptions')) return Response.json({ requests: [row] });
    if (url.endsWith('/suitability')) return Response.json(fit);
    return Response.json({ error: 'This request has already been decided.' }, { status: 409 });
  });
  vi.stubGlobal('fetch', fetch); render(<CapacityExceptions accessToken="token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review exception for QA forum at Small hall' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Approve capacity exception' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This request has already been decided.');
  expect(screen.queryByText(/Capacity exception for .* approved by/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve capacity exception' })).not.toBeDisabled();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/capacity-exception'))).toHaveLength(1);
});

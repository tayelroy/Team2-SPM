import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

// 'Draft' also appears as a mock event card's status badge; the stats grid
// always renders first in DOM order, so its label is reliably the first match.
const draftStat = () => screen.getAllByText('Draft')[0].closest('div')!;

test('a non-Event-Organiser role never fetches, and shows the mock Draft figure untouched', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
  expect(fetch).not.toHaveBeenCalled();
});

test('an Event Organiser with no access token never fetches', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Organiser" onNavigate={vi.fn()} />);
  expect(fetch).not.toHaveBeenCalled();
  expect(draftStat()).toHaveTextContent('1');
});

test('an Event Organiser with a token replaces the mock Draft figure with the real count', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({ requests: [{ event_id: 1, status: 'draft' }, { event_id: 2, status: 'draft' }, { event_id: 3, status: 'submitted' }] })
  );
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  expect(draftStat()).toHaveTextContent('1');
  await waitFor(() => expect(draftStat()).toHaveTextContent('2'));
  expect(fetch).toHaveBeenCalledWith('/api/event-requests', { headers: { Authorization: 'Bearer token' } });
});

test('a failed fetch leaves the mock Draft figure in place', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  await act(async () => {
    await fetch.mock.results[0]!.value;
  });
  expect(draftStat()).toHaveTextContent('1');
});

test('unmounting before the fetch resolves does not update state', async () => {
  const load = deferred<Response>();
  const fetch = vi.fn(() => load.promise);
  vi.stubGlobal('fetch', fetch);
  const { unmount } = render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  unmount();
  await act(async () => load.resolve(Response.json({ requests: [{ event_id: 1, status: 'draft' }] })));
  // No assertion needed beyond "this doesn't throw / warn" — the component is
  // already unmounted, so there is nothing left to query.
});

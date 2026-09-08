import '@testing-library/jest-dom/vitest';
import { act, screen } from '@testing-library/react';
import ReactDOM from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const roots: Root[] = [];

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  const createRoot = ReactDOM.createRoot;
  vi.spyOn(ReactDOM, 'createRoot').mockImplementation((container, options) => {
    const root = createRoot(container, options);
    roots.push(root);
    return root;
  });
});

afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('the home route renders the application heading', async () => {
  window.history.replaceState(null, '', '/');
  await act(async () => { await import('./main'); });
  expect(screen.getByRole('heading', { name: 'ConnectSphere' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveTextContent('Event Planning');
});

test('the healthcheck route renders the API health result', async () => {
  window.history.replaceState(null, '', '/healthcheck');
  // StrictMode may fetch twice; each HTTP response needs its own consumable body.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"status":"ok"}')));
  await act(async () => { await import('./main'); });
  expect(await screen.findByText('{"status":"ok"}')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'ConnectSphere' })).not.toBeInTheDocument();
});

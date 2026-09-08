import '@testing-library/jest-dom/vitest';
import { act, screen } from '@testing-library/react';
import ReactDOM from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

const roots: Root[] = [];

// jsdom has no canvas implementation; the landing page's orb hook no-ops
// without a 2D context, and stubbing this keeps the console clean.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

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

test('the home route renders the landing hero', async () => {
  window.history.replaceState(null, '', '/');
  await act(async () => { await import('./main'); });
  expect(
    screen.getByRole('heading', { name: /Exceptional Events Begin with the Perfect Space/ })
  ).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveTextContent('Event planning & venue booking');
  expect(screen.getByRole('button', { name: 'Open app' })).toBeInTheDocument();
});

test('the healthcheck route renders the API health result', async () => {
  window.history.replaceState(null, '', '/healthcheck');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"status":"ok"}')));
  await act(async () => { await import('./main'); });
  expect(await screen.findByText('{"status":"ok"}')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open app' })).not.toBeInTheDocument();
});

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import HealthCheck from './HealthCheck';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('[NORMAL] [SG2-20:AC2] [SG2-20:AC3] shows loading until the API responds, then displays the health status', async () => {
  let respond!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<HealthCheck />);
  expect(screen.getByText('Checking...')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/health');

  respond(new Response(JSON.stringify({ status: 'ok', service: 'ConnectSphere Backend' })));
  expect(await screen.findByText('{"status":"ok","service":"ConnectSphere Backend"}')).toBeInTheDocument();
});

test('[FAILURE] [SG2-20:AC2] [SG2-20:AC3] shows an HTTP error when the backend is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503, statusText: 'Service Unavailable' })));
  render(<HealthCheck />);
  expect(await screen.findByText('Error: HTTP error: 503 Service Unavailable')).toBeInTheDocument();
});

test('[FAILURE] [SG2-20:AC2] [SG2-20:AC3] shows network errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
  render(<HealthCheck />);
  expect(await screen.findByText('Error: Network unavailable')).toBeInTheDocument();
});

test('[FAILURE] [SG2-20:AC2] [SG2-20:AC3] handles failures that are not Error objects', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue('unstructured rejection'));
  render(<HealthCheck />);
  expect(await screen.findByText('Error: Unknown connection error')).toBeInTheDocument();
});

test('[FAILURE] [SG2-20:AC2] [SG2-20:AC3] shows an error when the backend returns malformed JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json')));
  render(<HealthCheck />);
  expect(await screen.findByText(/^Error:/)).toBeInTheDocument();
  expect(screen.queryByText('Checking...')).not.toBeInTheDocument();
});

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Landing from './Landing';

// Scroll geometry and canvas rendering have their own public hook tests.
vi.mock('../hooks/useInertiaScroll', () => ({ useInertiaScroll: () => null }));
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('[NORMAL] [SG2-71:AC4] [VISUAL-QA-01] both landing entry actions open the real planning app', () => {
  const open = vi.fn();
  render(<Landing onOpenApp={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open app' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open planning app' }));
  expect(open).toHaveBeenCalledTimes(2);
});

test('[FAILURE] [SG2-71:AC4] [VISUAL-QA-01] the landing page does not advertise fake contact or social destinations', () => {
  render(<Landing onOpenApp={vi.fn()} />);
  const footer = within(screen.getByRole('contentinfo'));
  expect(footer.getByText('Event requests')).toBeInTheDocument();
  expect(footer.getByText('Venues')).toBeInTheDocument();
  expect(footer.getByText('Equipment')).toBeInTheDocument();
  expect(footer.getByText('Registrations')).toBeInTheDocument();
  expect(footer.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Get in touch/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Privacy policy')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Exceptional Events/ })).toBeInTheDocument();
});

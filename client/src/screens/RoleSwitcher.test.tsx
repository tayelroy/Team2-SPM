import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AppShell from './AppShell';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('[NORMAL] [SG2-104:AC1] an account with two roles switches the role it acts as from the header', () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notifications: [] }))));
  const onSwitchRole = vi.fn();
  render(<AppShell role="Event Coordinator" roles={['Event Coordinator', 'Venue Staff']} onSwitchRole={onSwitchRole}
    screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()} accessToken="token">Desk</AppShell>);
  const acting = screen.getByRole('combobox', { name: 'Acting as' });
  expect(acting).toHaveValue('Event Coordinator');
  expect([...acting.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Event Coordinator', 'Venue Staff']);
  fireEvent.change(acting, { target: { value: 'Venue Staff' } });
  expect(onSwitchRole).toHaveBeenCalledWith('Venue Staff');
});

test('[BOUNDARY] [SG2-104:AC4] a single-role account has no switcher, only its role', () => {
  render(<AppShell role="Attendee" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()}>Desk</AppShell>);
  expect(screen.queryByRole('combobox', { name: 'Acting as' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Your role')).toHaveTextContent('Attendee');
});

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import AppShell from './AppShell';
import RoleSwitcher from '../components/RoleSwitcher';

const roles = ['Event Organiser', 'Event Coordinator', 'Venue Staff'] as const;
const acting = () => screen.getByRole('combobox', { name: 'Acting as' });
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
let scrollIntoView = vi.fn();
function expectActive(trigger: HTMLElement, name: string) {
  const id = trigger.getAttribute('aria-activedescendant');
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)).toHaveAccessibleName(name);
}

beforeEach(() => {
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

test('[NORMAL] [SG2-104:AC1] an account with two roles switches the role it acts as from the header', () => {
  const onSwitchRole = vi.fn();
  render(<AppShell role="Event Coordinator" roles={['Event Coordinator', 'Venue Staff']} onSwitchRole={onSwitchRole}
    screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()}>Desk</AppShell>);
  expect(acting()).toHaveTextContent('Event Coordinator');
  expect(screen.getByRole('button', { name: 'Profile' })).toBeVisible();
  expect(screen.queryByLabelText('Your role')).not.toBeInTheDocument();
  expect(within(screen.getByRole('banner')).getAllByText('Event Coordinator', { exact: true })).toHaveLength(1);
  fireEvent.click(acting());
  const listbox = screen.getByRole('listbox', { name: 'Available roles' });
  expect(within(listbox).getAllByRole('option').map(option => option.textContent)).toEqual(['Event Coordinator', 'Venue Staff']);
  fireEvent.click(within(listbox).getByRole('option', { name: 'Venue Staff' }));
  expect(onSwitchRole).toHaveBeenCalledWith('Venue Staff');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-104:AC4] a single-role account has no switcher, only its role', () => {
  render(<AppShell role="Attendee" screen="dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()}>Desk</AppShell>);
  expect(screen.queryByRole('combobox', { name: 'Acting as' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Your role')).toHaveTextContent('Attendee');
});

test('[NORMAL] [SG2-104:AC1] the menu announces its current role and a pointer choice switches once, closes and returns focus', () => {
  const onSwitchRole = vi.fn();
  const { rerender } = render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  const listbox = screen.getByRole('listbox', { name: 'Available roles' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).toHaveAttribute('aria-controls', listbox.id);
  expectActive(trigger, 'Event Coordinator');
  for (const option of within(listbox).getAllByRole('option')) {
    expect(option).toHaveAttribute('tabindex', '-1');
    expect(option).toHaveAttribute('aria-selected', String(option.textContent === 'Event Coordinator'));
  }
  fireEvent.pointerMove(within(listbox).getByRole('option', { name: 'Venue Staff' }));
  expectActive(trigger, 'Venue Staff');
  expect(within(listbox).getByRole('option', { name: 'Event Coordinator' })).toHaveAttribute('aria-selected', 'true');
  expect(onSwitchRole).not.toHaveBeenCalled();
  fireEvent.click(within(listbox).getByRole('option', { name: 'Venue Staff' }));
  expect(onSwitchRole).toHaveBeenCalledExactlyOnceWith('Venue Staff');
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).not.toHaveAttribute('aria-activedescendant');
  rerender(<RoleSwitcher role="Venue Staff" roles={roles} onSwitchRole={onSwitchRole} />);
  expect(trigger).toHaveTextContent('Venue Staff');
  fireEvent.click(trigger);
  expect(screen.getByRole('option', { name: 'Venue Staff' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: 'Event Coordinator' })).toHaveAttribute('aria-selected', 'false');
});

test('[BOUNDARY] [SG2-104:AC1] arrow navigation opens at the actual role, wraps both ends and changes no role until committed', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expectActive(trigger, 'Venue Staff');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expectActive(trigger, 'Venue Staff');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'Escape' });
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expectActive(trigger, 'Event Organiser');
  expect(onSwitchRole).not.toHaveBeenCalled();
  expect(screen.getByRole('option', { name: 'Event Coordinator' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: 'Event Organiser' })).toHaveAttribute('aria-selected', 'false');
});

test('[NORMAL] [BOUNDARY] [SG2-104:AC1] Enter and Space activate the trigger and commit an open menu selection', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  // jsdom does not synthesize a native button click from a keyboard event.
  // The closed trigger must preserve that default activation; the click completes it.
  expect(fireEvent.keyDown(trigger, { key: 'Enter' })).toBe(true);
  fireEvent.click(trigger);
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'Home' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(onSwitchRole).toHaveBeenCalledExactlyOnceWith('Event Organiser');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(fireEvent.keyDown(trigger, { key: ' ' })).toBe(true);
  fireEvent.click(trigger);
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'End' });
  expectActive(trigger, 'Venue Staff');
  fireEvent.keyDown(trigger, { key: ' ' });
  expect(onSwitchRole).toHaveBeenLastCalledWith('Venue Staff');
  expect(onSwitchRole).toHaveBeenCalledTimes(2);
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('[CONFLICT] [SG2-104:AC1] cancelling or choosing the existing role never switches and reopening forgets the cancelled highlight', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  fireEvent.keyDown(trigger, { key: 'Tab' });
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: 'End' });
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expectActive(trigger, 'Event Coordinator');
  fireEvent.click(screen.getByRole('option', { name: 'Event Coordinator' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(onSwitchRole).not.toHaveBeenCalled();
});

test('[BOUNDARY] [SG2-104:AC1] Home and End open at the first or last role and keep the highlighted option in view', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  fireEvent.keyDown(trigger, { key: 'Home' });
  expectActive(trigger, 'Event Organiser');
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('option', { name: 'Event Organiser' }));
  fireEvent.keyDown(trigger, { key: 'Escape' });
  fireEvent.keyDown(trigger, { key: 'End' });
  expectActive(trigger, 'Venue Staff');
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('option', { name: 'Venue Staff' }));
  fireEvent.keyDown(trigger, { key: 'Home' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.pointerMove(screen.getByRole('option', { name: 'Event Coordinator' }));
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('option', { name: 'Event Coordinator' }));
  expect(onSwitchRole).not.toHaveBeenCalled();
});

test('[NORMAL] [SG2-104:AC1] Tab commits the highlighted role and preserves the browser default focus traversal', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: 'End' });
  expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(true);
  expect(onSwitchRole).toHaveBeenCalledExactlyOnceWith('Venue Staff');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(true);
  expect(onSwitchRole).toHaveBeenCalledTimes(1);
});

test('[NORMAL] [BOUNDARY] [SG2-104:AC1] typeahead finds a prefix and starts a new search after one second or navigation', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  expect(fireEvent.keyDown(trigger, { key: 'V', shiftKey: true })).toBe(false);
  expectActive(trigger, 'Venue Staff');
  fireEvent.keyDown(trigger, { key: 'e' });
  fireEvent.keyDown(trigger, { key: 'n' });
  expectActive(trigger, 'Venue Staff');
  vi.advanceTimersByTime(1000);
  fireEvent.keyDown(trigger, { key: 'e' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'v' });
  expectActive(trigger, 'Venue Staff');
  expect(onSwitchRole).not.toHaveBeenCalled();
  expect(screen.getByRole('option', { name: 'Event Coordinator' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(onSwitchRole).toHaveBeenCalledExactlyOnceWith('Venue Staff');
});

test('[BOUNDARY] [SG2-104:AC1] repeated letters cycle matching roles and an unmatched search preserves the current highlight', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  fireEvent.keyDown(trigger, { key: 'e' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.keyDown(trigger, { key: 'e' });
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'e' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.keyDown(trigger, { key: 'Escape' });
  fireEvent.keyDown(trigger, { key: 'z' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expectActive(trigger, 'Event Coordinator');
  fireEvent.keyDown(trigger, { key: 'q' });
  expectActive(trigger, 'Event Coordinator');
  expect(onSwitchRole).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-104:AC1] modified shortcuts and unrelated keys never start a role search or consume browser shortcuts', () => {
  const onSwitchRole = vi.fn();
  render(<RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} />);
  const trigger = acting();
  for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    expect(fireEvent.keyDown(trigger, { key: 'v', ...modifiers })).toBe(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  expect(fireEvent.keyDown(trigger, { key: 'F2' })).toBe(true);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(onSwitchRole).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-104:AC1] outside pointer or focus dismisses without switching while interaction inside preserves the menu', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  const onSwitchRole = vi.fn();
  render(<><RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={onSwitchRole} /><button>Outside</button></>);
  const trigger = acting();
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByRole('option', { name: 'Venue Staff' }));
  fireEvent.focusIn(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.focusIn(screen.getByRole('button', { name: 'Outside' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // Dismissal ends the old typeahead search even if another key arrives within its one-second buffer.
  fireEvent.keyDown(trigger, { key: 'v' });
  expectActive(trigger, 'Venue Staff');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(trigger, { key: 'e' });
  expectActive(trigger, 'Event Organiser');
  fireEvent.focusIn(screen.getByRole('button', { name: 'Outside' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(trigger, { key: 'v' });
  expectActive(trigger, 'Venue Staff');
  expect(onSwitchRole).not.toHaveBeenCalled();
});

test('[BOUNDARY] [SG2-104:AC1] two switchers keep separate accessible menu and active-option identities', () => {
  render(<>
    <RoleSwitcher role="Event Coordinator" roles={roles} onSwitchRole={vi.fn()} />
    <RoleSwitcher role="Venue Staff" roles={roles} onSwitchRole={vi.fn()} />
  </>);
  const [first, second] = screen.getAllByRole('combobox', { name: 'Acting as' });
  fireEvent.click(first);
  const firstListbox = screen.getByRole('listbox', { name: 'Available roles' });
  const firstActiveId = first.getAttribute('aria-activedescendant');
  expect(first).toHaveAttribute('aria-controls', firstListbox.id);
  fireEvent.pointerDown(second);
  fireEvent.click(second);
  const secondListbox = screen.getByRole('listbox', { name: 'Available roles' });
  expect(secondListbox.id).not.toBe(firstListbox.id);
  expect(second.getAttribute('aria-activedescendant')).not.toBe(firstActiveId);
  expect(second).toHaveAttribute('aria-controls', secondListbox.id);
  expectActive(second, 'Venue Staff');
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { blockNonDigitKeys, digitsOnly } from './digitsOnly';

// Auto-cleanup only registers when vitest runs with globals enabled, which
// this project does not, so unmount between tests explicitly.
afterEach(cleanup);

function keyAllowed(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  render(<input aria-label="Count" type="number" onKeyDown={blockNonDigitKeys} />);
  return fireEvent.keyDown(screen.getByLabelText('Count'), { key, ...modifiers });
}

test.each(['', '0', '42', '2147483648'])('[NORMAL] [SG2-53:AC3] digits-only text %s is accepted as typed', value => {
  expect(digitsOnly(value)).toBe(true);
});
test.each(['dasdd', '12a', '-1', '1.5', '1e3', ' 1'])('[FAILURE] [SG2-53:AC3] text %s with anything but digits is refused', value => {
  expect(digitsOnly(value)).toBe(false);
});
test.each(['0', '9'])('[BOUNDARY] [SG2-53:AC3] number fields accept digit key %s', key => {
  expect(keyAllowed(key)).toBe(true);
});
test.each(['e', 'E', '+', '-', '.', 'a'])('[FAILURE] [SG2-53:AC3] number fields drop the %s keystroke', key => {
  expect(keyAllowed(key)).toBe(false);
});
test.each([['Backspace', {}], ['ArrowUp', {}], ['v', { ctrlKey: true }], ['c', { metaKey: true }]] as const)('[CONFLICT] [SG2-53:AC3] editing key %s and copy-paste shortcuts still work in number fields', (key, modifiers) => {
  expect(keyAllowed(key, modifiers)).toBe(true);
});

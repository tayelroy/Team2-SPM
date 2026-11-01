import type { KeyboardEvent } from 'react';

// SG2-53: count fields take whole numbers only. A text field ignores any edit
// that is not all digits; a number field still lets e, +, - and . through, so
// those keystrokes are dropped before they reach it.
export const digitsOnly = (value: string) => /^\d*$/.test(value);

export function blockNonDigitKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key.length === 1 && !/\d/.test(event.key) && !event.ctrlKey && !event.metaKey) event.preventDefault();
}

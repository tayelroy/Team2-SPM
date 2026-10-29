/** Final event states and the registration wording shared by every event screen. */
export const TERMINAL_REGISTRATION_STATE = {
  cancelled: 'This event was cancelled. Registration is closed.',
  rejected: 'This event was rejected. Registration is unavailable.',
  completed: 'This event is completed. Registration is closed.',
} as const;

export function terminalEventStatus(status: string): keyof typeof TERMINAL_REGISTRATION_STATE | null {
  const normalized = status.toLowerCase();
  return Object.prototype.hasOwnProperty.call(TERMINAL_REGISTRATION_STATE, normalized)
    ? normalized as keyof typeof TERMINAL_REGISTRATION_STATE
    : null;
}

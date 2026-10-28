/** Recipient-scoped notifications for tentative venue holds. */
export interface HoldNotification {
  notification_id: number;
  event_id: number;
  hold_id: number;
  kind: 'placed' | 'warning' | 'expired' | 'expiry_changed';
  message: string;
  created_at: string;
}

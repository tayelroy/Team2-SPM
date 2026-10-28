import { useEffect, useState } from 'react';
import { loadNotificationEvent, type NotificationEventSummary, type NotificationSource } from '../api/notificationInboxApi';
import { statusLabel } from '../mock/viewModel';
import { color, rule } from '../theme';
import { GhostButton, Notice } from '../ui';
import { formatSgtTimestamp } from '../components/EventAuditDrawer';

/** Minimal event summary resolved from a recipient-owned notice, never an arbitrary event id. */
function NotificationEventSession({ accessToken, source, notificationId, onViewEvent, viewLabel = 'View event details' }: {
  accessToken: string; source: NotificationSource; notificationId: number; onViewEvent?: (eventId: number) => void; viewLabel?: string;
}) {
  const [event, setEvent] = useState<NotificationEventSummary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setError('');
    void loadNotificationEvent(accessToken, source, notificationId).then(result => {
      if (!current) return;
      if (result.ok) setEvent(result.value.event);
      else setError(result.message);
    });
    return () => { current = false; };
  }, [accessToken, source, notificationId, attempt]);
  if (error) return <Notice role="alert"><span>{error}</span><GhostButton onClick={() => setAttempt(value => value + 1)}>Retry event</GhostButton></Notice>;
  if (!event) return <p role="status">Loading notification event…</p>;
  return <section aria-label="Notification event" style={{ border: rule.faint, padding: '24px', borderRadius: '12px', overflowWrap: 'anywhere' }}>
    <p style={{ color: color.silver, fontSize: '12px' }}>E-{event.event_id}</p>
    <h2 style={{ color: color.platinum, margin: '12px 0' }}>{event.name}</h2>
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '16px', color: color.silver }}>
      <dt>Status</dt><dd style={{ margin: 0 }}>{statusLabel(event.status)}</dd>
      <dt>Event date</dt><dd style={{ margin: 0 }}>{event.proposed_date === null ? 'Date not set' : formatSgtTimestamp(event.proposed_date)}</dd>
    </dl>
    {onViewEvent ? <GhostButton onClick={() => onViewEvent(event.event_id)}>{viewLabel}</GhostButton> : null}
  </section>;
}

export default function NotificationEvent(props: { accessToken: string; source: NotificationSource; notificationId: number;
  onViewEvent?: (eventId: number) => void; viewLabel?: string }) {
  return <NotificationEventSession key={`${props.accessToken}:${props.source}:${props.notificationId}`} {...props} />;
}

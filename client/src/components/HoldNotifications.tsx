import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadHoldNotifications, type HoldNotification } from '../venues/holdNotificationsApi';
import { loadNotifications, type Notification } from '../api/notificationsApi';
import { formatSgtTimestamp } from './EventAuditDrawer';
import { color, radius, rule, surface } from '../theme';
import { Dot, GhostButton, IconButton, Notice } from '../ui';

const LABEL: Record<HoldNotification['kind'] | Notification['kind'], string> = {
  placed: 'Tentative hold placed', warning: 'Hold expiring soon', expired: 'Hold expired',
  // SG2-49: Venue Staff decisions on the coordinator's venue requests.
  venue_request_approved: 'Venue request approved', venue_request_rejected: 'Venue request rejected',
};
const TONE: Record<HoldNotification['kind'] | Notification['kind'], string> = {
  placed: color.accent, warning: color.silver, expired: color.slate,
  venue_request_approved: color.accent, venue_request_rejected: color.silver,
};

/** One line in the drawer, whichever inbox it came from. */
interface InboxEntry { key: string; kind: keyof typeof LABEL; message: string; created_at: string }

/** Hold notices (SG2-84) and decision notices (SG2-49), newest first. */
function inbox(holds: HoldNotification[] | null, notices: Notification[] | null): InboxEntry[] {
  return [
    ...(holds ?? []).map(entry => ({ ...entry, key: `hold-${entry.notification_id}` })),
    ...(notices ?? []).map(entry => ({ ...entry, key: `notice-${entry.notification_id}` }))
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function HoldNotificationDrawer({ notifications, loading, error, onClose, onRetry }: {
  notifications: InboxEntry[] | null; loading: boolean; error: string;
  onClose: () => void; onRetry: () => void;
}) {
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => { drawer.current!.focus(); }, []);

  return <>
    <button type="button" aria-label="Close notifications overlay" tabIndex={-1} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(1,20,19,0.6)', border: 'none', zIndex: 50 }} />
    <aside ref={drawer} tabIndex={-1} aria-label="Notifications"
      onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px,92vw)', zIndex: 51,
        background: color.deep, borderLeft: rule.edge, padding: '32px 28px', display: 'flex',
        flexDirection: 'column', gap: '24px', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 500, letterSpacing: '-0.02em', color: color.platinum }}>Notifications</h3>
        <IconButton label="Close notifications" onClick={onClose}>✕</IconButton>
      </div>
      {loading && notifications === null ? <p role="status" style={{ color: color.silver }}>Loading notifications…</p> : null}
      {error ? <Notice role="alert"><span>{error}</span><GhostButton onClick={onRetry}>Retry</GhostButton></Notice> : null}
      {notifications === null ? null : notifications.length === 0 ? <p style={{ color: color.silver }}>No notifications yet.</p> :
          notifications.map(notification => <div key={notification.key}
            style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', paddingBottom: '18px', borderBottom: rule.faint }}>
            <Dot tone={TONE[notification.kind]} style={{ marginTop: '7px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '15px', lineHeight: 1.4, color: color.platinum }}>{LABEL[notification.kind]}</span>
              <span style={{ fontSize: '13px', lineHeight: 1.4, color: color.silver }}>{notification.message}</span>
              <span style={{ fontSize: '10px', letterSpacing: '0.1em', color: color.slate }}>{formatSgtTimestamp(notification.created_at)}</span>
            </div>
          </div>)}
    </aside>
  </>;
}

/** Keep the badge and drawer synchronized for the authenticated session. */
function HoldNotificationsSession({ accessToken }: { accessToken: string }) {
  const [open, setOpen] = useState(false);
  // Each inbox keeps its last good list when a refresh of it fails.
  const [holds, setHolds] = useState<HoldNotification[] | null>(null);
  const [notices, setNotices] = useState<Notification[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    let current = true;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      setError('');
      void Promise.all([loadHoldNotifications(accessToken), loadNotifications(accessToken)]).then(([held, decided]) => {
        if (!current) return;
        inFlight = false;
        setLoading(false);
        if (held.ok) setHolds(held.notifications);
        if (decided.ok) setNotices(decided.notifications);
        setError([held, decided].flatMap(result => result.ok ? [] : [result.message]).join(' '));
      });
    };
    refresh.current = load;
    load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [accessToken]);
  // The count is shown once both inboxes have loaded at least once.
  const notifications = holds === null || notices === null ? null : inbox(holds, notices);
  const listed = holds === null && notices === null ? null : inbox(holds, notices);
  const count = notifications === null ? (error ? 'unavailable' : 'loading') : notifications.length;
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current!.focus(); };
  return <>
    <button ref={trigger} type="button" onClick={() => { if (!open) refresh.current!(); setOpen(value => !value); }} aria-label={`Notifications (${count})`} aria-expanded={open}
      style={{ position: 'relative', background: surface.iconButton, border: 'none', borderRadius: radius.sm,
        width: '32px', height: '32px', color: color.platinum, fontSize: '13px', cursor: 'pointer' }}>
      ●<span style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', borderRadius: '9px',
        background: color.accent, color: color.abyss, fontSize: '10px', lineHeight: '18px', letterSpacing: '0.04em' }}>{notifications === null ? '…' : notifications.length}</span>
    </button>
    {open ? createPortal(<HoldNotificationDrawer notifications={listed} loading={loading} error={error} onClose={close} onRetry={() => refresh.current!()} />, document.body) : null}
  </>;
}

/** A token change discards recipient data synchronously, including pending responses. */
export default function HoldNotifications({ accessToken }: { accessToken: string }) {
  return <HoldNotificationsSession key={accessToken} accessToken={accessToken} />;
}

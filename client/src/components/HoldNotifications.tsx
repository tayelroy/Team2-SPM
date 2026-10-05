import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadHoldNotifications, type HoldNotification } from '../venues/holdNotificationsApi';
import { formatSgtTimestamp } from './EventAuditDrawer';
import { color, radius, rule, surface } from '../theme';
import { Dot, GhostButton, IconButton, Notice } from '../ui';

const LABEL: Record<HoldNotification['kind'], string> = {
  placed: 'Tentative hold placed', warning: 'Hold expiring soon', expired: 'Hold expired',
};
const TONE: Record<HoldNotification['kind'], string> = {
  placed: color.accent, warning: color.silver, expired: color.slate,
};

function HoldNotificationDrawer({ notifications, loading, error, onClose, onRetry }: {
  notifications: HoldNotification[] | null; loading: boolean; error: string;
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
      {loading && notifications === null ? <p role="status" style={{ color: color.silver }}>Loading hold notifications…</p> : null}
      {error ? <Notice role="alert"><span>{error}</span><GhostButton onClick={onRetry}>Retry</GhostButton></Notice> : null}
      {notifications === null ? null : notifications.length === 0 ? <p style={{ color: color.silver }}>No hold notifications available.</p> :
          notifications.map(notification => <div key={notification.notification_id}
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
  const [notifications, setNotifications] = useState<HoldNotification[] | null>(null);
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
      void loadHoldNotifications(accessToken).then(result => {
        if (!current) return;
        inFlight = false;
        setLoading(false);
        if (result.ok) setNotifications(result.notifications);
        else setError(result.message);
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
    {open ? createPortal(<HoldNotificationDrawer notifications={notifications} loading={loading} error={error} onClose={close} onRetry={() => refresh.current!()} />, document.body) : null}
  </>;
}

/** A token change discards recipient data synchronously, including pending responses. */
export default function HoldNotifications({ accessToken }: { accessToken: string }) {
  return <HoldNotificationsSession key={accessToken} accessToken={accessToken} />;
}

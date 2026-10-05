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

function HoldNotificationDrawer({ accessToken, onClose, onCount }: {
  accessToken: string; onClose: () => void; onCount: (count: number) => void;
}) {
  const [notifications, setNotifications] = useState<HoldNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const drawer = useRef<HTMLElement>(null);

  useEffect(() => { drawer.current!.focus(); }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    loadHoldNotifications(accessToken).then(result => {
      if (!current) return;
      setLoading(false);
      if (!result.ok) { setError(result.message); return; }
      setNotifications(result.notifications);
      onCount(result.notifications.length);
    });
    return () => { current = false; };
  }, [accessToken, attempt, onCount]);

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
      {loading ? <p role="status" style={{ color: color.silver }}>Loading hold notifications…</p> : error ?
        <Notice role="alert"><span>{error}</span><GhostButton onClick={() => setAttempt(value => value + 1)}>Retry</GhostButton></Notice> :
        notifications.length === 0 ? <p style={{ color: color.silver }}>No hold notifications available.</p> :
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

/** Fetch only when opened; remount with a new session to clear recipient state. */
export default function HoldNotifications({ accessToken }: { accessToken: string }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current!.focus(); };
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(value => !value)} aria-label={`Notifications (${count})`} aria-expanded={open}
      style={{ position: 'relative', background: surface.iconButton, border: 'none', borderRadius: radius.sm,
        width: '32px', height: '32px', color: color.platinum, fontSize: '13px', cursor: 'pointer' }}>
      ●<span style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', borderRadius: '9px',
        background: color.accent, color: color.abyss, fontSize: '10px', lineHeight: '18px', letterSpacing: '0.04em' }}>{count}</span>
    </button>
    {open ? createPortal(<HoldNotificationDrawer accessToken={accessToken} onClose={close} onCount={setCount} />, document.body) : null}
  </>;
}

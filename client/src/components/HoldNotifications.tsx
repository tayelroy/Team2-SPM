import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HoldNotification } from '../venues/holdNotificationsApi';
import type { Notification } from '../api/notificationsApi';
import { loadNotificationInbox, readNotification, readAllNotifications, loadReminderPreferences, saveReminderPreferences,
  type InboxNotification, type InboxPage, type NotificationSource } from '../api/notificationInboxApi';
import { formatSgtTimestamp } from './EventAuditDrawer';
import { color, radius, rule, surface } from '../theme';
import { Dot, GhostButton, IconButton, Notice } from '../ui';

// Hold notices are written by the database with the expiry as a raw UTC
// instant (e.g. "expiry 2030-06-03T02:00:00.000Z"); show it in Singapore time.
const UTC_INSTANT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;

const LABEL: Record<HoldNotification['kind'] | Notification['kind'] | 'outstanding_arrangements', string> = {
  placed: 'Tentative hold placed', warning: 'Hold expiring soon', expired: 'Hold expired',
  // SG2-106: Venue Staff moved the hold's expiry.
  expiry_changed: 'Hold expiry changed',
  // SG2-49: Venue Staff decisions on the coordinator's venue requests.
  venue_request_approved: 'Venue request approved', venue_request_rejected: 'Venue request rejected',
  // SG2-51: a venue booked for the event was released.
  venue_booking_released: 'Venue booking released',
  // SG2-79: a booking now clashes once setup and turnaround apply.
  venue_booking_clash: 'Booking clash flagged',
  venue_unavailable: 'Venue unavailable',
  equipment_reserved: 'Equipment reserved',
  // SG2-58: the organiser's event was confirmed by its coordinator.
  event_confirmed: 'Event confirmed',
  // SG2-68: the steps of an event request, for the people involved in it.
  event_submitted: 'Event submitted',
  coordinator_assigned: 'Coordinator assigned',
  clarification_requested: 'Question from your coordinator',
  event_approved: 'Event approved',
  event_rejected: 'Event not approved',
  // SG2-66 AC7: the event moved back to Planning for its arrangements to be rechecked.
  event_returned_to_planning: 'Back in Planning',
  // SG2-92 AC5: the Safety Officer recorded the event's operational safety check decision.
  safety_decision: 'Safety check',
  outstanding_arrangements: 'Outstanding arrangements',
  // SG2-63 AC10: registration opened or closed, on schedule or closed early.
  registration_opened: 'Registration open',
  registration_closed: 'Registration closed',
  // SG2-83 AC4: for Venue Staff, a coordinator cancelled or asked to change a venue booking.
  venue_booking_cancelled: 'Venue booking cancelled',
  venue_change_requested: 'Venue change requested',
  // SG2-67: the organiser asked to cancel, and the coordinator cancelled.
  cancellation_requested: 'Cancellation requested',
  event_cancelled: 'Event cancelled',
};
const TONE: Record<HoldNotification['kind'] | Notification['kind'] | 'outstanding_arrangements', string> = {
  placed: color.accent, warning: color.silver, expired: color.slate, expiry_changed: color.accent,
  venue_request_approved: color.accent, venue_request_rejected: color.silver,
  venue_booking_released: color.silver,
  venue_booking_clash: color.silver,
  venue_unavailable: color.silver,
  equipment_reserved: color.accent,
  event_confirmed: color.accent,
  event_submitted: color.accent,
  coordinator_assigned: color.accent,
  clarification_requested: color.silver,
  event_approved: color.accent,
  event_rejected: color.silver,
  event_returned_to_planning: color.silver,
  safety_decision: color.accent,
  outstanding_arrangements: color.silver,
  registration_opened: color.accent,
  venue_booking_cancelled: color.silver,
  venue_change_requested: color.accent,
  registration_closed: color.silver,
  cancellation_requested: color.silver,
  event_cancelled: color.silver,
};

const identity = (entry: InboxNotification) => `${entry.source}:${entry.notification_id}`;
function merged(first: InboxNotification[], older: InboxNotification[]) {
  // Keep the database's exact cursor order: JS Date would truncate PostgreSQL
  // microseconds and could put an older hold ahead of a newer event notice.
  const byId = new Map(older.map(entry => [identity(entry), entry]));
  for (const entry of first) byId.set(identity(entry), entry);
  return [...byId.values()];
}

function ReminderFrequency({ accessToken }: { accessToken: string }) {
  const [days, setDays] = useState('1');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const load = useRef<(() => void) | null>(null);
  useEffect(() => {
    alive.current = true;
    load.current = () => {
      setMessage('');
      void loadReminderPreferences(accessToken).then(result => {
        if (!alive.current) return;
        if (result.ok) { setDays(String(result.value.frequency_days)); setReady(true); }
        else setMessage(result.message);
      });
    };
    load.current!();
    return () => { alive.current = false; };
  }, [accessToken]);
  const valid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 30;
  return <form onSubmit={event => {
    event.preventDefault();
    if (!valid || saving || !ready) return;
    setSaving(true); setMessage('');
    void saveReminderPreferences(accessToken, Number(days)).then(result => {
      if (!alive.current) return;
      setSaving(false);
      if (result.ok) { setDays(String(result.value.frequency_days)); setMessage('Reminder frequency saved.'); }
      else setMessage(result.message);
    });
  }} style={{ border: rule.faint, borderRadius: radius.sm, padding: '14px', display: 'grid', gap: '10px' }}>
    <label htmlFor="reminder-frequency" style={{ color: color.platinum, fontSize: '14px' }}>Reminder frequency (days)</label>
    <p style={{ color: color.silver, margin: 0, fontSize: '12px', lineHeight: 1.5 }}>Upcoming events with outstanding arrangements. Daily by default; choose 1–30 days.</p>
    <input id="reminder-frequency" type="number" min="1" max="30" step="1" value={days} disabled={!ready || saving}
      onChange={event => setDays(event.target.value)} style={{ width: '100%', minWidth: 0, padding: '9px', boxSizing: 'border-box' }} />
    <button type="submit" disabled={!ready || saving || !valid} style={{ padding: '10px', color: color.platinum,
      background: 'transparent', border: rule.faint, borderRadius: radius.sm }}>{saving ? 'Saving…' : 'Save reminder frequency'}</button>
    {message ? <p role={message === 'Reminder frequency saved.' ? 'status' : 'alert'} style={{ margin: 0, fontSize: '12px', color: color.silver }}>{message}</p> : null}
    {!ready && message ? <GhostButton onClick={() => load.current!()}>Retry reminder preferences</GhostButton> : null}
  </form>;
}

function HoldNotificationsSession({ accessToken, coordinator, onOpenNotification }: {
  accessToken: string; coordinator: boolean; onOpenNotification?: (source: NotificationSource, id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<InboxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const revision = useRef(0);
  const mutation = useRef(false);
  const loadingOlder = useRef(false);
  const loadedDepth = useRef(1);
  const refresh = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => { if (open) drawer.current!.focus(); }, [open]);
  useEffect(() => {
    active.current = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight || mutation.current || loadingOlder.current) return;
      inFlight = true;
      const started = revision.current;
      setLoading(true);
      let result = await loadNotificationInbox(accessToken);
      let depth = 1;
      if (result.ok) {
        let combined = result.value;
        // Refresh only the depth the person opened, atomically. Older rows
        // stay visible while cross-tab read state and new arrivals reconcile.
        while (depth < loadedDepth.current && combined.next_cursor) {
          if (!active.current || started !== revision.current) { inFlight = false; return; }
          const next = await loadNotificationInbox(accessToken, combined.next_cursor);
          if (!next.ok) { result = next; break; }
          combined = { ...next.value, notifications: merged(next.value.notifications, combined.notifications) };
          depth++;
        }
        if (result.ok) result = { ok: true, value: combined };
      }
      inFlight = false;
      if (!active.current || started !== revision.current) return;
      setLoading(false);
      if (result.ok) {
        loadedDepth.current = depth;
        setError(''); setPage(result.value);
      } else setError(result.message);
    };
    refresh.current = load;
    load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [accessToken]);
  const close = () => { setOpen(false); trigger.current!.focus(); };
  const startMutation = () => {
    mutation.current = true; revision.current++; setBusy(true); setLoading(false); setError('');
  };
  const finishMutation = () => { mutation.current = false; setBusy(false); };
  const read = (entry: InboxNotification) => {
    if (mutation.current || loadingOlder.current) return;
    startMutation();
    void readNotification(accessToken, entry.source, entry.notification_id).then(result => {
      if (!active.current) return;
      finishMutation();
      if (!result.ok) { setError(result.message); return; }
      setPage(previous => ({ ...previous!, unread_count: result.value.unread_count,
        notifications: previous!.notifications.map(item => identity(item) === identity(entry) ? result.value.notification : item) }));
      if (result.value.notification.event_id !== null && onOpenNotification) {
        close(); onOpenNotification(entry.source, entry.notification_id);
      }
    });
  };
  const readAll = () => {
    if (mutation.current || loadingOlder.current) return;
    startMutation();
    void readAllNotifications(accessToken).then(result => {
      if (!active.current) return;
      finishMutation();
      if (!result.ok) { setError(result.message); return; }
      const readAt = new Date().toISOString();
      setPage(previous => ({ ...previous!, unread_count: result.value.unread_count,
        notifications: previous!.notifications.map(entry => ({ ...entry, read_at: entry.read_at ?? readAt })) }));
    });
  };
  const older = () => {
    if (mutation.current || loadingOlder.current) return;
    loadingOlder.current = true; revision.current++; setBusy(true); setLoading(false); setError('');
    void loadNotificationInbox(accessToken, page!.next_cursor!).then(result => {
      loadingOlder.current = false;
      if (!active.current) return;
      setBusy(false);
      if (!result.ok) { setError(result.message); return; }
      loadedDepth.current++;
      setPage(previous => ({ ...result.value, notifications: merged(result.value.notifications, previous!.notifications) }));
    });
  };
  const count = page === null ? (error ? 'unavailable' : 'loading') : page.unread_count;
  return <>
    <button ref={trigger} type="button" onClick={() => { if (!open) refresh.current!(); setOpen(value => !value); }}
      aria-label={`Notifications (${count})`} aria-expanded={open}
      style={{ position: 'relative', background: surface.iconButton, border: 'none', borderRadius: radius.sm,
        width: '32px', height: '32px', color: color.platinum, fontSize: '13px', cursor: 'pointer' }}>
      ●<span aria-hidden="true" style={{ position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', borderRadius: '9px',
        padding: '0 4px', boxSizing: 'border-box', background: color.accent, color: color.abyss, fontSize: '10px', lineHeight: '18px' }}>{page === null ? '…' : page.unread_count > 99 ? '99+' : page.unread_count}</span>
    </button>
    {open ? createPortal(<>
      <button type="button" aria-label="Close notifications overlay" tabIndex={-1} onClick={close}
        style={{ position: 'fixed', inset: 0, background: 'rgba(1,20,19,0.6)', border: 'none', zIndex: 50 }} />
      <aside ref={drawer} tabIndex={-1} aria-label="Notifications" onKeyDown={event => { if (event.key === 'Escape') close(); }}
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px,100vw)', boxSizing: 'border-box', zIndex: 51,
          background: color.deep, borderLeft: rule.edge, padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '24px', color: color.platinum }}>Notifications</h3>
          <IconButton label="Close notifications" onClick={close}>✕</IconButton>
        </div>
        {page ? <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: color.silver }}>{page.unread_count} unread</span>
          <GhostButton disabled={busy || page.unread_count === 0} onClick={readAll}>Mark all as read</GhostButton>
        </div> : null}
        {loading && page === null ? <p role="status" style={{ color: color.silver }}>Loading notifications…</p> : null}
        {error ? <Notice role="alert"><span>{error}</span><GhostButton disabled={busy} onClick={() => refresh.current!()}>Retry</GhostButton></Notice> : null}
        {page?.notifications.length === 0 ? <p style={{ color: color.silver }}>No notifications yet.</p> : null}
        {page?.notifications.map(entry => <button type="button" key={identity(entry)} disabled={busy} onClick={() => read(entry)}
          aria-label={`${entry.read_at === null ? 'Unread' : 'Read'}: ${entry.message}`}
          style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 10px', border: 'none', borderBottom: rule.faint,
            borderLeft: entry.read_at === null ? `3px solid ${color.accent}` : '3px solid transparent', textAlign: 'left', cursor: busy ? 'wait' : 'pointer',
            background: entry.read_at === null ? 'rgba(203,255,252,0.05)' : 'transparent', opacity: entry.read_at === null ? 1 : .8 }}>
          <Dot tone={TONE[entry.kind as keyof typeof TONE]} style={{ marginTop: '7px', flexShrink: 0 }} />
          <span style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: '6px', overflowWrap: 'anywhere' }}>
            <span style={{ fontSize: '15px', lineHeight: 1.4, color: color.platinum }}>{LABEL[entry.kind as keyof typeof LABEL]}</span>
            <span style={{ fontSize: '13px', lineHeight: 1.5, color: color.silver }}>{entry.message.replace(UTC_INSTANT, instant => formatSgtTimestamp(instant))}</span>
            <span style={{ fontSize: '11px', color: color.silver }}>{entry.read_at === null ? 'Unread' : 'Read'} · <time dateTime={entry.created_at}>{formatSgtTimestamp(entry.created_at)}</time></span>
          </span>
        </button>)}
        {page?.next_cursor ? <GhostButton disabled={busy} onClick={older}>Load older notifications</GhostButton> : null}
        {coordinator ? <ReminderFrequency accessToken={accessToken} /> : null}
      </aside>
    </>, document.body) : null}
  </>;
}

/** Keying by token discards recipient data before another session can render it. */
export default function HoldNotifications({ accessToken, coordinator = false, onOpenNotification }: {
  accessToken: string; holds?: boolean; coordinator?: boolean; onOpenNotification?: (source: NotificationSource, id: number) => void;
}) {
  return <HoldNotificationsSession key={accessToken} accessToken={accessToken} coordinator={coordinator} onOpenNotification={onOpenNotification} />;
}

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { HEAD, NOTIFICATIONS, PAGE_BLURB, PAGE_TITLE } from '../mock/data';
import type { Notification, Role, Screen } from '../mock/types';
import { navFor, previewNavFor, primaryActionFor } from '../mock/viewModel';
import { color, layout, radius, rule, surface } from '../theme';
import { Dot, GhostButton, GradientButton, IconButton, Mark } from '../ui';

/** Slide-over notification panel. */
function NotificationDrawer({ onClose, notifications }: { onClose: () => void; notifications: Notification[] }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(1,20,19,0.6)',
          zIndex: 50,
        }}
      />
      <aside
        aria-label="Notifications"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px,92vw)',
          zIndex: 51,
          background: color.deep,
          borderLeft: rule.edge,
          padding: '32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: color.platinum,
            }}
          >
            Notifications
          </h3>
          <IconButton label="Close notifications" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        {notifications.length === 0 ? <p style={{ color: color.silver }}>No notifications available.</p> : null}
        {notifications.map((n) => (
          <div
            key={n.title}
            style={{
              display: 'flex',
              gap: '14px',
              alignItems: 'flex-start',
              paddingBottom: '18px',
              borderBottom: rule.faint,
            }}
          >
            <Dot tone={n.dot} style={{ marginTop: '7px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '15px', lineHeight: 1.4, color: color.platinum }}>
                {n.title}
              </span>
              <span style={{ fontSize: '13px', lineHeight: 1.4, color: color.silver }}>
                {n.body}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: color.slate,
                }}
              >
                {n.when}
              </span>
            </div>
          </div>
        ))}
      </aside>
    </>
  );
}

/** Closes an open menu when a pointer or focus lands outside it. */
function useDismissOutside(open: boolean, container: RefObject<HTMLDivElement>, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      if (!container.current!.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open, container, setOpen]);
}

function navItemStyle(active: boolean): CSSProperties {
  return {
    background: 'none',
    border: 'none',
    padding: '0 0 3px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 400,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: active ? color.platinum : color.silver,
    borderBottom: `1px solid ${active ? color.accent : 'transparent'}`,
  };
}

const menuStyle: CSSProperties = {
  position: 'absolute', top: 'calc(100% + 8px)', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px',
  background: color.deep, border: rule.raised, borderRadius: radius.sm, zIndex: 1,
};

/**
 * Chrome shared by every signed-in screen: the sticky header with role-scoped
 * navigation, the page heading block, and the notification drawer. The role
 * is a real, server-assigned attribute of the signed-in account — displayed
 * here, not switchable (only Technical Support Staff can change a role, and
 * only for someone else's account; see SG2-24).
 */
export default function AppShell({
  role,
  screen,
  onNavigate,
  onSignOut,
  children,
}: {
  role: Role;
  screen: Exclude<Screen, 'landing' | 'login'>;
  onNavigate: (screen: Screen) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const head = HEAD[role];
  const notifications = role === 'Event Organiser' ? [] : NOTIFICATIONS;
  const primary = primaryActionFor(role);
  const preview = previewNavFor(role);

  useDismissOutside(profileOpen, profileRef, setProfileOpen);
  useDismissOutside(previewOpen, previewRef, setPreviewOpen);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(1,29,28,0.92)',
          backdropFilter: 'blur(10px)',
          borderBottom: rule.edge,
        }}
      >
        <div
          style={{
            maxWidth: layout.maxWidth,
            margin: '0 auto',
            padding: '16px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => onNavigate(role === 'Attendee' ? 'attendee' : 'dashboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <Mark size={20} />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: color.platinum,
              }}
            >
              ConnectSphere
            </span>
          </button>

          <nav
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              marginLeft: '12px',
              flex: '1 1 320px',
              minWidth: 0,
            }}
          >
            {navFor(role).map((item) => {
              const active = item.screen === screen;
              return (
                <button
                  key={item.screen}
                  type="button"
                  onClick={() => onNavigate(item.screen)}
                  aria-current={active ? 'page' : undefined}
                  style={navItemStyle(active)}
                >
                  {item.label}
                </button>
              );
            })}
            {preview.length > 0 && (
              <div
                ref={previewRef}
                // Flex lets the trigger stretch to the row height like its sibling nav buttons.
                style={{ position: 'relative', display: 'flex' }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setPreviewOpen(false);
                    previewButton.current!.focus();
                  }
                }}
              >
                <button
                  ref={previewButton}
                  type="button"
                  aria-expanded={previewOpen}
                  aria-controls="preview-options"
                  onClick={() => setPreviewOpen(open => !open)}
                  style={navItemStyle(preview.some(item => item.screen === screen))}
                >
                  Preview <span aria-hidden="true">▾</span>
                </button>
                {previewOpen && (
                  <div id="preview-options" role="group" aria-label="Preview screens"
                    style={{ ...menuStyle, left: 0, width: '240px' }}>
                    {preview.map(item => (
                      <GhostButton key={item.screen} onClick={() => { setPreviewOpen(false); onNavigate(item.screen); }}
                        style={{ width: '100%', padding: '10px 16px', textAlign: 'left' }}>{item.label}</GhostButton>
                    ))}
                    <p style={{ margin: '4px 8px', fontSize: '12px', lineHeight: 1.4, color: color.silver }}>
                      Sample data only. Live requests are on your dashboard.
                    </p>
                  </div>
                )}
              </div>
            )}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              type="button"
              onClick={() => setNotifOpen((open) => !open)}
              aria-label={`Notifications (${notifications.length})`}
              style={{
                position: 'relative',
                background: surface.iconButton,
                border: 'none',
                borderRadius: radius.sm,
                width: '32px',
                height: '32px',
                color: color.platinum,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              ●
              <span
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  minWidth: '18px',
                  height: '18px',
                  borderRadius: '9px',
                  background: color.accent,
                  color: color.abyss,
                  fontSize: '10px',
                  lineHeight: '18px',
                  letterSpacing: '0.04em',
                }}
              >
                {notifications.length}
              </span>
            </button>

            <div
              ref={profileRef}
              style={{ position: 'relative' }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  setProfileOpen(false);
                  profileButton.current!.focus();
                }
              }}
            >
              <button
                ref={profileButton}
                type="button"
                aria-label="Profile"
                aria-expanded={profileOpen}
                aria-controls="profile-options"
                onClick={() => setProfileOpen(open => !open)}
                style={{ background: color.kelp, border: rule.control, borderRadius: radius.sm,
                  color: color.mist, fontSize: '12px', letterSpacing: '0.06em',
                  padding: '8px 10px', cursor: 'pointer' }}
              >
                <span aria-label="Your role">{role}</span> <span aria-hidden="true">▾</span>
              </button>
              {profileOpen && (
                <div id="profile-options" role="group" aria-label="Profile options"
                  style={{ ...menuStyle, right: 0, minWidth: '160px' }}>
                  <GhostButton onClick={() => { setProfileOpen(false); onNavigate('profile'); }}
                    style={{ width: '100%', padding: '10px 16px' }}>My Profile</GhostButton>
                  <GhostButton onClick={onSignOut} style={{ width: '100%', padding: '10px 16px' }}>Logout</GhostButton>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          maxWidth: layout.maxWidth,
          width: '100%',
          margin: '0 auto',
          padding: '40px 28px 100px',
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '24px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 500,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: color.silver,
              }}
            >
              {role === 'Event Organiser' ? 'Event Organiser' : head.eyebrow}
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: '44px',
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: '-0.04em',
                color: color.platinum,
              }}
            >
              {screen === 'dashboard'
                ? head.title
                : role === 'Event Organiser' && screen === 'events'
                  ? 'Your events'
                  : PAGE_TITLE[screen]}
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '16px',
                lineHeight: 1.4,
                color: color.silver,
                maxWidth: '620px',
              }}
            >
              {screen === 'dashboard'
                ? head.blurb
                : role === 'Event Organiser' && screen === 'events'
                  ? head.blurb
                  : role === 'Event Organiser' && screen === 'detail'
                    ? 'View the event request, current status and coordinator details.'
                    : PAGE_BLURB[screen]}
            </p>
          </div>
          {/* The primary CTA belongs to the dashboard only. */}
          {screen === 'dashboard' ? (
            <GradientButton onClick={() => onNavigate(primary.screen)}>
              {primary.label}
            </GradientButton>
          ) : null}
        </div>

        {children}
      </main>

      {notifOpen ? <NotificationDrawer notifications={notifications} onClose={() => setNotifOpen(false)} /> : null}
    </div>
  );
}

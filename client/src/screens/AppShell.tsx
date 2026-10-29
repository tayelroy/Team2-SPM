import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { HEAD, PAGE_BLURB, PAGE_TITLE } from '../mock/data';
import type { Role, Screen } from '../mock/types';
import { navFor, primaryActionFor } from '../mock/viewModel';
import type { Access } from '../auth/access';
import { color, layout, radius, rule, surface } from '../theme';
import { GhostButton, GradientButton, IconButton, Mark } from '../ui';
import HoldNotifications from '../components/HoldNotifications';
import type { NotificationSource } from '../api/notificationInboxApi';
import RoleSwitcher from '../components/RoleSwitcher';

/** Slide-over notification panel. */
function NotificationDrawer({ onClose }: { onClose: () => void }) {
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
        <p style={{ color: color.silver }}>No notifications available.</p>
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
 * navigation, the page heading block, and the notification drawer. Accounts
 * holding several server-assigned roles can choose which one to act as;
 * assigning roles remains a Technical Support Staff action (SG2-24).
 */
export default function AppShell({
  role,
  screen,
  onNavigate,
  onSignOut,
  accessToken,
  access,
  onOpenNotification,
  roles = [role],
  onSwitchRole,
  children,
}: {
  role: Role;
  /** Every role the account holds (SG2-104); a switcher shows when there are several. */
  roles?: readonly Role[];
  onSwitchRole?: (role: Role) => void;
  screen: Exclude<Screen, 'landing' | 'login'>;
  onNavigate: (screen: Screen) => void;
  onSignOut: () => void;
  accessToken?: string;
  /** The account's server permissions; `undefined` while still loading. */
  access?: Access | null;
  onOpenNotification?: (source: NotificationSource, id: number) => void;
  children: ReactNode;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const head = HEAD[role];
  const primary = primaryActionFor(role);

  useDismissOutside(profileOpen, profileRef, setProfileOpen);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        className="app-header"
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
            onClick={() => onNavigate(role === 'Attendee' ? 'findEvents' : 'dashboard')}
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
            id="application-navigation"
            className="app-navigation"
            aria-busy={access === undefined}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              marginLeft: '12px',
              flex: '1 1 320px',
              minWidth: 0,
            }}
          >
            {navFor(role, access).map((item) => {
              const active = item.screen === screen;
              return (
                <button
                  key={item.screen}
                  type="button"
                  onClick={() => onNavigate(item.screen)}
                  aria-current={active ? 'page' : undefined}
                  className="app-nav-item"
                  style={navItemStyle(active)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="app-header-controls">
            {/* SG2-51 AC4: Event Organisers are told when a venue for their event is released.
                SG2-68: the Event Coordinator Lead is told when an event is waiting for a coordinator;
                neither has hold notices. */}
            {accessToken
              ? <HoldNotifications key={`${accessToken}:${role}`} accessToken={accessToken} coordinator={role === 'Event Coordinator'} onOpenNotification={onOpenNotification} /> : <button
              type="button"
              onClick={() => setNotifOpen((open) => !open)}
              aria-label="Notifications (0)"
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
                0
              </span>
            </button>}

            {roles.length > 1 && onSwitchRole
              ? <RoleSwitcher role={role} roles={roles} onSwitchRole={onSwitchRole} />
              : <span className="app-current-role" aria-label="Your role">{role}</span>}

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
                title="Profile"
                className="app-profile-trigger"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M4 17v-1a6 6 0 0 1 12 0v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
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

      {notifOpen ? <NotificationDrawer onClose={() => setNotifOpen(false)} /> : null}
    </div>
  );
}

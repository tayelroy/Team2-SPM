import { ROLES } from '../mock/types';
import type { Role } from '../mock/types';
import { chipStyle } from '../mock/viewModel';
import { color, radius } from '../theme';
import { Card, Chip, Eyebrow, Field, GradientButton, Mark } from '../ui';

/**
 * Sign-in screen. The role chips are the prototype's role switch — picking one
 * decides which scoped view the app opens on, since every downstream screen is
 * filtered by role.
 */
export default function Login({
  role,
  onPickRole,
  onSignIn,
  onBack,
}: {
  role: Role;
  onPickRole: (role: Role) => void;
  onSignIn: () => void;
  onBack: () => void;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '-200px',
          right: '-180px',
          width: '520px',
          height: '520px',
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 40% 35%, rgba(203,255,252,0.14), rgba(0,130,124,0.12) 45%, rgba(1,38,36,0) 70%)',
          animation: 'orbdrift 14s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '460px',
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            alignItems: 'flex-start',
          }}
        >
          <button
            type="button"
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <Mark size={26} />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: color.silver,
              }}
            >
              ConnectSphere
            </span>
          </button>
          <h2
            style={{
              margin: 0,
              fontSize: 'clamp(2.1rem,5.5vw,3rem)',
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '-0.04em',
              color: color.platinum,
              textWrap: 'pretty',
            }}
          >
            Sign in
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '16px',
              lineHeight: 1.4,
              color: color.silver,
              maxWidth: '380px',
            }}
          >
            Pick up where things stand. Your view is scoped to your role.
          </p>
        </div>

        <Card style={{ gap: '20px' }}>
          <Field label="Work email" defaultValue="a.vance@connectsphere.co" />
          <Field label="Password" type="password" defaultValue="............" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Eyebrow>Sign in as (mockup role switch)</Eyebrow>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {ROLES.map((r) => {
                const style = chipStyle(r === role);
                return (
                  <Chip
                    key={r}
                    {...style}
                    pressed={r === role}
                    onClick={() => onPickRole(r)}
                  >
                    {r}
                  </Chip>
                );
              })}
            </div>
          </div>

          <GradientButton
            onClick={onSignIn}
            style={{ marginTop: '4px', borderRadius: radius.sm }}
          >
            Sign in
          </GradientButton>
          <span style={{ fontSize: '13px', color: color.silver }}>
            Access is scoped to your role — you only see the events and actions that
            belong to you.
          </span>
          <span style={{ fontSize: '13px', color: color.silver }}>
            New here? <a href="/register">Register an account</a>
          </span>
        </Card>
      </div>
    </div>
  );
}

import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { StoredSession } from '../auth/session';
import { color, radius, rule, surface, label as labelToken } from '../theme';
import { Card, GradientButton, Mark } from '../ui';

type Status = 'idle' | 'submitting' | 'error';

/**
 * Styled like ui.tsx's Field, but controlled: Field only takes defaultValue
 * (it's built for the static mockups), and this page needs real state to
 * submit against the live API.
 */
function ControlledField({
  id,
  label,
  type,
  value,
  onChange
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label htmlFor={id} style={labelToken}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        required
        style={{
          background: surface.field,
          border: rule.control,
          borderRadius: radius.sm,
          padding: '13px 14px',
          color: color.mist,
          fontSize: '14px',
          outline: 'none'
        }}
      />
    </div>
  );
}

/**
 * Real sign-in screen. Used to be a role-picking mockup — the chips let you
 * preview any role's view with no credentials. Real auth replaces that: the
 * role now comes from the server, not a self-selected preview.
 */
export default function Login({
  onSignIn,
  onBack
}: {
  onSignIn: (session: StoredSession) => void;
  onBack: () => void;
}) {
  const baseId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function handleSignIn() {
    if (status === 'submitting') return;
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus('error');
        setMessage(data.error || 'Sign-in failed. Please try again.');
        return;
      }

      onSignIn({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    } catch {
      setStatus('error');
      setMessage('Could not reach the server. Check your connection and try again.');
    }
  }

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
        overflow: 'hidden'
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
          pointerEvents: 'none'
        }}
      />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '460px',
          display: 'flex',
          flexDirection: 'column',
          gap: '32px'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'flex-start' }}>
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
              cursor: 'pointer'
            }}
          >
            <Mark size={26} />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: color.silver
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
              textWrap: 'pretty'
            }}
          >
            Sign in
          </h2>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.4, color: color.silver, maxWidth: '380px' }}>
            Pick up where things stand. Your view is scoped to your role.
          </p>
        </div>

        <Card style={{ gap: '20px' }}>
          <ControlledField
            id={`${baseId}-email`}
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <ControlledField
            id={`${baseId}-password`}
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <GradientButton onClick={handleSignIn} style={{ marginTop: '4px', borderRadius: radius.sm }}>
            {status === 'submitting' ? 'Signing in…' : 'Sign in'}
          </GradientButton>

          {message && (
            <span role="alert" style={{ fontSize: '13px', lineHeight: 1.4, color: '#ff8a80' }}>
              {message}
            </span>
          )}

          <span style={{ fontSize: '13px', color: color.silver }}>
            Access is scoped to your role — you only see the events and actions that belong to you.
          </span>
          <span style={{ fontSize: '13px', color: color.silver }}>
            New here? <a href="/register">Register an account</a>
          </span>
        </Card>
      </div>
    </div>
  );
}

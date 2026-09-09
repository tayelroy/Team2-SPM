import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { color, radius, rule, surface, label as labelToken } from './theme';
import { Card, GradientButton, Mark } from './ui';

interface FormState {
  name: string;
  email: string;
  password: string;
  organisation: string;
}

const EMPTY_FORM: FormState = { name: '', email: '', password: '', organisation: '' };

type Status = 'idle' | 'submitting' | 'success' | 'error';

const FIELDS: Array<{ key: keyof FormState; label: string; type: string }> = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'organisation', label: 'Organisation', type: 'text' }
];

/**
 * Styled like ui.tsx's Field, but controlled: Field only takes defaultValue
 * (it's built for the static mockups), and this page needs real state to
 * submit and clear the form against the live API.
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

export default function Register() {
  const baseId = useId();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  function updateField(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };
  }

  async function handleRegister() {
    if (status === 'submitting') return;
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus('error');
        setMessage(data.error || 'Registration failed. Please try again.');
        return;
      }

      setStatus('success');
      setMessage(data.message || 'Account created successfully.');
      setForm(EMPTY_FORM);
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
        padding: '64px 24px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          display: 'flex',
          flexDirection: 'column',
          gap: '32px'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
          </div>
          <h1
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
            Register an account
          </h1>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.4, color: color.silver, maxWidth: '380px' }}>
            For Event Organisers and Attendees. Staff accounts are provisioned separately.
          </p>
        </div>

        <Card style={{ gap: '20px' }}>
          {FIELDS.map(({ key, label, type }) => (
            <ControlledField
              key={key}
              id={`${baseId}-${key}`}
              label={label}
              type={type}
              value={form[key]}
              onChange={updateField(key)}
            />
          ))}

          <GradientButton onClick={handleRegister} style={{ marginTop: '4px', borderRadius: radius.sm }}>
            {status === 'submitting' ? 'Registering…' : 'Register'}
          </GradientButton>

          {message && (
            <span
              role={status === 'error' ? 'alert' : 'status'}
              style={{
                fontSize: '13px',
                lineHeight: 1.4,
                color: status === 'error' ? '#ff8a80' : color.accent
              }}
            >
              {message}
            </span>
          )}
        </Card>
      </div>
    </div>
  );
}

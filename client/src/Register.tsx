import { FormEvent, useState } from 'react';

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

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: '1px solid var(--color-line)',
  background: 'transparent',
  padding: '0.6rem 0',
  fontFamily: 'var(--font-body)',
  fontSize: '1.05rem',
  color: 'var(--color-ink)',
  outline: 'none',
  transition: 'border-color 160ms ease',
};

export default function Register() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  function updateField(field: keyof FormState) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
        gap: '2rem',
        padding: '5vw 6vw',
        alignItems: 'start',
      }}
    >
      <div style={{ position: 'sticky', top: '5vw' }}>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(6rem, 14vw, 11rem)',
            lineHeight: 0.85,
            color: 'var(--color-line)',
          }}
        >
          02
        </p>
        <h1
          style={{
            fontSize: 'clamp(2.25rem, 4vw, 3rem)',
            marginTop: '-1rem',
            color: 'var(--color-ink)',
          }}
        >
          Register an account
        </h1>
        <p style={{ marginTop: '1rem', maxWidth: '32ch', color: 'var(--color-ink-soft)' }}>
          For Event Organisers and Attendees. Staff accounts are provisioned separately.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          maxWidth: '30rem',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-line)',
          borderRadius: '4px',
          padding: '2.5rem',
        }}
      >
        {FIELDS.map(({ key, label, type }, index) => (
          <div
            key={key}
            style={{
              marginBottom: '1.75rem',
              animation: 'rise-in 480ms ease both',
              animationDelay: `${index * 70}ms`,
            }}
          >
            <label
              htmlFor={key}
              style={{
                display: 'block',
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--color-ink-soft)',
                marginBottom: '0.4rem',
              }}
            >
              {label}
            </label>
            <input
              id={key}
              name={key}
              type={type}
              value={form[key]}
              onChange={updateField(key)}
              required
              className="field-input"
              style={inputStyle}
            />
          </div>
        ))}

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="btn-lift btn-lift--accent"
          style={{
            width: '100%',
            marginTop: '0.5rem',
            padding: '0.95rem',
            border: 'none',
            borderRadius: '999px',
            backgroundColor: 'var(--color-accent)',
            color: 'var(--color-accent-ink)',
            fontWeight: 600,
            fontSize: '0.95rem',
            cursor: status === 'submitting' ? 'default' : 'pointer',
            opacity: status === 'submitting' ? 0.7 : 1,
          }}
        >
          {status === 'submitting' ? 'Registering...' : 'Register'}
        </button>

        {message && (
          <p
            role={status === 'error' ? 'alert' : 'status'}
            style={{
              marginTop: '1.25rem',
              fontSize: '0.9rem',
              color: status === 'error' ? 'var(--color-bad)' : 'var(--color-good)',
            }}
          >
            {message}
          </p>
        )}
      </form>
    </main>
  );
}

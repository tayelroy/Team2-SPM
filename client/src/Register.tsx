import { FormEvent, useState } from 'react';

interface FormState {
  name: string;
  email: string;
  password: string;
  organisation: string;
}

const EMPTY_FORM: FormState = { name: '', email: '', password: '', organisation: '' };

type Status = 'idle' | 'submitting' | 'success' | 'error';

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
        maxWidth: '420px',
        margin: '2rem auto',
        padding: '2rem',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)'
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem' }}>
        Register an account
      </h1>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" value={form.name} onChange={updateField('name')} required />

        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value={form.email}
          onChange={updateField('email')}
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={form.password}
          onChange={updateField('password')}
          required
        />

        <label htmlFor="organisation">Organisation</label>
        <input
          id="organisation"
          name="organisation"
          value={form.organisation}
          onChange={updateField('organisation')}
          required
        />

        <button type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Registering...' : 'Register'}
        </button>
      </form>
      {message && (
        <p role={status === 'error' ? 'alert' : 'status'} style={{ color: status === 'error' ? '#b91c1c' : '#15803d' }}>
          {message}
        </p>
      )}
    </main>
  );
}

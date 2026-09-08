import { useEffect, useState, FormEvent } from 'react';

interface ProfileData {
  id: string;
  name: string;
  email: string;
  phone: string;
  communication_preferences: string[];
  department?: string;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

const COMM_CHANNELS = ['email', 'sms', 'phone', 'none'] as const;

/**
 * View/edit the current user's profile (SG2-27).
 *
 * NOTE: identity comes via the `x-user-id` header, a temporary stand-in for
 * real auth (SG2-23/24). Until that lands, this reads the id from
 * localStorage so the page is usable for manual testing today.
 */
export default function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', communication_preferences: [] as string[] });
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const userId = typeof window !== 'undefined' ? window.localStorage.getItem('devUserId') || '' : '';

  useEffect(() => {
    if (!userId) {
      setLoadState({ status: 'error', message: 'No user signed in (set localStorage.devUserId for now).' });
      return;
    }
    fetch('/api/profile', { headers: { 'x-user-id': userId } })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP error: ${res.status}`);
        }
        return res.json();
      })
      .then((data: ProfileData) => {
        setProfile(data);
        setForm({
          name: data.name,
          email: data.email,
          phone: data.phone,
          communication_preferences: data.communication_preferences
        });
        setLoadState({ status: 'ready' });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown connection error';
        setLoadState({ status: 'error', message });
      });
  }, [userId]);

  function toggleChannel(channel: string) {
    setForm((f) => ({
      ...f,
      communication_preferences: f.communication_preferences.includes(channel)
        ? f.communication_preferences.filter((c) => c !== channel)
        : [...f.communication_preferences, channel]
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify(form)
      });
      const body = await res.json();
      if (!res.ok) {
        setSaveError(body.details || [body.error || 'Could not save profile.']);
        return;
      }
      setProfile(body);
    } catch (err: unknown) {
      setSaveError([err instanceof Error ? err.message : 'Unknown connection error']);
    } finally {
      setSaving(false);
    }
  }

  if (loadState.status === 'loading') {
    return <div>Loading profile...</div>;
  }
  if (loadState.status === 'error') {
    return <div>Error: {loadState.message}</div>;
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Edit profile">
      <h2>My Profile</h2>
      {profile?.department && <p>Department: {profile.department}</p>}

      <label>
        Name
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </label>

      <label>
        Email
        <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      </label>

      <label>
        Phone
        <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
      </label>

      <fieldset>
        <legend>Communication preferences</legend>
        {COMM_CHANNELS.map((channel) => (
          <label key={channel}>
            <input
              type="checkbox"
              checked={form.communication_preferences.includes(channel)}
              onChange={() => toggleChannel(channel)}
            />
            {channel}
          </label>
        ))}
      </fieldset>

      {saveError && (
        <ul role="alert">
          {saveError.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

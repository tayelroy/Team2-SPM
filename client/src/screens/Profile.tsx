import { useEffect, useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { fetchProfile, updateProfile, type ProfileRecord } from '../api/profile';
import { color, radius, rule, surface, label as labelToken } from '../theme';
import { Card, Fact, GradientButton } from '../ui';

const CHANNELS: { value: string; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'phone_call', label: 'Phone call' }
];

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Styled like ui.tsx's Field, but controlled — Field only takes defaultValue
 * (it's built for the static mockups), and this page needs real state to
 * submit against the live API.
 */
function ControlledField({
  id,
  label,
  type = 'text',
  value,
  onChange
}: {
  id: string;
  label: string;
  type?: string;
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
 * View and update the caller's own profile (SG2-27).
 *
 * `department` only renders when the loaded profile includes the key at
 * all — the server omits it entirely for external roles (event_organiser,
 * attendee), so its presence (not its value) is what decides whether the
 * field appears, matching the "internal users additionally see their
 * department" acceptance criterion.
 */
export default function Profile() {
  const baseId = useId();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadMessage, setLoadMessage] = useState('');
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [channels, setChannels] = useState<string[]>([]);
  const [department, setDepartment] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const showsDepartment = profile !== null && 'department' in profile;

  useEffect(() => {
    let cancelled = false;
    fetchProfile().then((outcome) => {
      if (cancelled) return;
      if (!outcome.ok) {
        setLoadState('error');
        setLoadMessage(outcome.message);
        return;
      }
      setProfile(outcome.profile);
      setName(outcome.profile.name);
      setPhone(outcome.profile.phone ?? '');
      setChannels(outcome.profile.communication_preferences);
      setDepartment(outcome.profile.department ?? '');
      setLoadState('ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleChannel(value: string) {
    setChannels((current) => (current.includes(value) ? current.filter((c) => c !== value) : [...current, value]));
  }

  async function handleSave() {
    if (saveState === 'saving') return;
    setSaveState('saving');
    setSaveMessage('');

    const outcome = await updateProfile({
      name,
      phone: phone.trim() === '' ? null : phone,
      communication_preferences: channels,
      ...(showsDepartment ? { department: department.trim() === '' ? null : department } : {})
    });

    if (!outcome.ok) {
      setSaveState('error');
      setSaveMessage(outcome.details ? outcome.details.join(' ') : outcome.message);
      return;
    }
    setProfile(outcome.profile);
    setSaveState('saved');
    setSaveMessage('Profile updated.');
  }

  if (loadState === 'loading') {
    return <p role="status">Loading your profile…</p>;
  }

  if (loadState === 'error') {
    return <p role="alert">{loadMessage}</p>;
  }

  return (
    <Card style={{ gap: '24px', maxWidth: '560px' }}>
      <Fact label="Organisation" value={profile?.organisation ?? '—'} />

      <ControlledField id={`${baseId}-name`} label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <ControlledField id={`${baseId}-phone`} label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={labelToken}>Communication preferences</span>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {CHANNELS.map((channel) => {
            const inputId = `${baseId}-channel-${channel.value}`;
            return (
              <label
                key={channel.value}
                htmlFor={inputId}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: color.mist }}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={channels.includes(channel.value)}
                  onChange={() => toggleChannel(channel.value)}
                />
                {channel.label}
              </label>
            );
          })}
        </div>
      </div>

      {showsDepartment ? (
        <ControlledField
          id={`${baseId}-department`}
          label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
      ) : null}

      <GradientButton onClick={handleSave} style={{ marginTop: '4px', borderRadius: radius.sm, alignSelf: 'flex-start' }}>
        {saveState === 'saving' ? 'Saving…' : 'Save changes'}
      </GradientButton>

      {saveMessage ? (
        <span
          role={saveState === 'error' ? 'alert' : 'status'}
          style={{ fontSize: '13px', lineHeight: 1.4, color: saveState === 'error' ? '#ff8a80' : color.silver }}
        >
          {saveMessage}
        </span>
      ) : null}
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import { can, loadAccess, type Access } from '../auth/access';
import { Card, Eyebrow, Fact, GhostButton, GradientButton, Notice, RecessedCard } from '../ui';
import { color, rule } from '../theme';
import VenueForm, { inputStyle } from '../venues/VenueForm';
import { VenueError, venueRequest, type Venue, type VenueValues } from '../venues/api';

/** Login owns the token. Never use the prototype role selector as permission. */
export default function Venues({ accessToken = null, onBook }: { accessToken?: string | null; onBook: () => void }) {
  // Remount on identity changes, immediately removing the previous user's data/form.
  return <VenueCatalogue key={accessToken} token={accessToken} onBook={onBook} />;
}

function VenueCatalogue({ token, onBook }: { token: string | null; onBook: () => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Venue | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setAccess(null);
    setVenues([]);
    async function load() {
      try {
        const identity = await loadAccess(token, controller.signal);
        if (!can(identity, 'venues.read')) throw new VenueError(403);
        const data = await venueRequest(token!, controller.signal);
        if (controller.signal.aborted) return;
        setAccess(identity);
        setVenues(data.venues);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof VenueError ? failure.message : 'Unable to load venues. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [token, attempt]);

  useEffect(() => () => { pending.current?.abort(); }, []);

  async function save(values: VenueValues) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError('');
    try {
      const { venue } = await venueRequest(token!, controller.signal, values, editing?.venue_id);
      if (controller.signal.aborted) return;
      setVenues(current => [...current.filter(item => item.venue_id !== venue.venue_id), venue]);
      setSaved(`${venue.name} saved. The catalogue is up to date.`);
      setEditing(undefined);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof VenueError && [401, 403].includes(failure.status)) {
        setAccess(null);
        setVenues([]);
        setEditing(undefined);
      }
      setError(failure instanceof VenueError ? failure.message : 'Unable to save venue. Your changes are still in the form. Please try again.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  if (!token) return <Notice><Eyebrow>Sign in required</Eyebrow><span>Sign in with your account to view venue records.</span></Notice>;
  if (loading) return <p role="status">Loading venue catalogue…</p>;
  if (!access) return <Notice><p role="alert">{error}</p><GhostButton onClick={() => setAttempt(n => n + 1)}>Retry</GhostButton></Notice>;
  if (editing !== undefined) return <VenueForm venue={editing} saving={saving} error={error} onSave={save}
    onCancel={() => { setEditing(undefined); setError(''); }} />;

  const search = query.trim().toLowerCase();
  const filtered = venues.filter(venue => [venue.name, venue.location, venue.facilities, venue.accessibility_features, venue.operating_information]
    .some(value => (value ?? '').toLowerCase().includes(search))).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-label="Venue catalogue" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {saved ? <Notice><span role="status">{saved}</span></Notice> : null}
      <RecessedCard padding="24px 28px" style={{ gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '20px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: '1 1 280px', maxWidth: '600px' }}>
            <Eyebrow>Search venues</Eyebrow>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} style={inputStyle}
              placeholder="Search name, location, facilities or access…" />
          </label>
          {can(access, 'venues.create') ? <GradientButton onClick={() => { setSaved(''); setEditing(null); }}>Add venue</GradientButton> : null}
        </div>
        <span style={{ color: color.silver, fontSize: '13px' }}>{filtered.length} of {venues.length} venues</span>
      </RecessedCard>
      {filtered.length === 0 ? <Card style={{ gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>{venues.length ? 'No matching venues' : 'No venues yet'}</h2>
        <p style={{ margin: 0, color: color.silver }}>{venues.length ? 'Try another name, location or feature.' : 'Venue records will appear here once added.'}</p>
        {query ? <GhostButton onClick={() => setQuery('')}>Clear search</GhostButton> : null}
      </Card> : null}
      <div className="venue-grid">
        {filtered.map(venue => <Card key={venue.venue_id} padding="28px" style={{ gap: '22px', minWidth: 0 }}>
          <div style={{ borderBottom: rule.edge, paddingBottom: '20px', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
            <div style={{ minWidth: 0 }}>
              <Eyebrow>Venue record</Eyebrow>
              <h2 style={{ margin: '10px 0 8px', fontSize: '26px', fontWeight: 500, letterSpacing: '-0.03em', overflowWrap: 'anywhere' }}>{venue.name}</h2>
              <span style={{ color: color.silver, fontSize: '14px', overflowWrap: 'anywhere' }}>{venue.location ?? 'Location not recorded'}</span>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}><span style={{ display: 'block', fontSize: '32px', color: color.phosphor }}>{venue.capacity ?? '—'}</span><Eyebrow>Capacity</Eyebrow></div>
          </div>
          <div style={{ display: 'grid', gap: '18px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            <Fact label="Facilities" value={venue.facilities ?? 'Not recorded'} />
            <Fact label="Accessibility" value={venue.accessibility_features ?? 'Not recorded'} />
            <Fact label="Operating information" value={venue.operating_information ?? 'Not recorded'} />
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {can(access, 'venues.update') ? <GhostButton onClick={() => { setSaved(''); setEditing(venue); }}>Edit {venue.name}</GhostButton> : null}
            {access.role === 'event_coordinator' ? <GhostButton onClick={onBook}>Request {venue.name}</GhostButton> : null}
          </div>
        </Card>)}
      </div>
    </section>
  );
}

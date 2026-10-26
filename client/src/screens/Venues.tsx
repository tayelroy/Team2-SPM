import { useEffect, useRef, useState } from 'react';
import { can, loadAccess, type Access } from '../auth/access';
import { Card, Eyebrow, Fact, GhostButton, GradientButton, Notice, RecessedCard } from '../ui';
import { color, rule } from '../theme';
import VenueForm, { inputStyle } from '../venues/VenueForm';
import VenueBlocks from '../venues/VenueBlocks';
import VenueBookings from '../venues/VenueBookings';
import { VenueLayoutError, describeLayouts, fetchVenueLayouts, saveVenueLayouts, type VenueLayout, type VenueLayoutValues } from '../venues/layoutsApi';
import { VenueDeleteBlocked, VenueError, deleteVenue, venueRequest, type Venue, type VenueBlocker, type VenueValues } from '../venues/api';
import { NO_OPERATIONS, VenueOperationsError, describeTimes, fetchVenueOperations, saveVenueOperations, type VenueOperationValues, type VenueOperations } from '../venues/operationsApi';

const KIND = { booking: 'Booking', hold: 'Tentative hold', request: 'Pending request' } as const;
const when = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false });

/** Use the signed-in token and server permissions to load and maintain records. */
export default function Venues({ accessToken = null }: { accessToken?: string | null }) {
  // Remount on identity changes, immediately removing the previous user's data/form.
  return <VenueCatalogue key={accessToken} token={accessToken} />;
}

function VenueCatalogue({ token }: { token: string | null }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Venue | null | undefined>(undefined);
  const [blocking, setBlocking] = useState<Venue | undefined>(undefined);
  const [bookings, setBookings] = useState<Venue | undefined>(undefined);
  const [layoutsByVenue, setLayoutsByVenue] = useState<Record<number, VenueLayout[]>>({});
  // null marks a venue whose details failed to load (shown as Unavailable).
  const [operationsByVenue, setOperationsByVenue] = useState<Record<number, VenueOperations | null>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  // SG2-106: the venue awaiting delete confirmation, and what stopped a delete.
  const [removing, setRemoving] = useState<{ venue: Venue; blockers?: VenueBlocker[]; error?: string } | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
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
        // Both endpoints enforce authorization independently. Start them together,
        // but expose neither records nor controls until both checks succeed.
        const [identity, data] = await Promise.all([
          loadAccess(token, controller.signal).then(identity => {
            if (!can(identity, 'venues.read')) throw new VenueError(403);
            return identity;
          }),
          venueRequest(token!, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        // These independent detail reads share the loading state and abort
        // signal, but neither waits for the other wave to finish.
        const [layouts, operations] = await Promise.all([
          can(identity, 'venues.layouts.read')
            ? Promise.all((data.venues as Venue[]).map((venue: Venue) =>
                fetchVenueLayouts(token!, controller.signal, venue.venue_id).catch(() => [] as VenueLayout[])))
            : [],
          can(identity, 'venues.operations.read')
            ? Promise.all((data.venues as Venue[]).map((venue: Venue) =>
                fetchVenueOperations(token!, controller.signal, venue.venue_id).catch(() => null)))
            : [],
        ]);
        if (controller.signal.aborted) return;
        setAccess(identity);
        setVenues(data.venues);
        setLayoutsByVenue(Object.fromEntries((data.venues as Venue[]).map((venue: Venue, index: number) => [venue.venue_id, layouts[index] ?? []])));
        setOperationsByVenue(Object.fromEntries((data.venues as Venue[]).map((venue: Venue, index: number) => [venue.venue_id, operations.length ? operations[index] : NO_OPERATIONS])));
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

  async function save(values: VenueValues, layoutValues?: VenueLayoutValues[], operationValues?: VenueOperationValues) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError('');
    try {
      const { venue } = await venueRequest(token!, controller.signal, values, editing?.venue_id);
      if (controller.signal.aborted) return;
      setVenues(current => [...current.filter(item => item.venue_id !== venue.venue_id), venue]);
      if (layoutValues !== undefined) {
        const layouts = await saveVenueLayouts(token!, controller.signal, venue.venue_id, layoutValues);
        if (controller.signal.aborted) return;
        setLayoutsByVenue(current => ({ ...current, [venue.venue_id]: layouts }));
      }
      if (operationValues !== undefined) {
        const operations = await saveVenueOperations(token!, controller.signal, venue.venue_id, operationValues);
        if (controller.signal.aborted) return;
        setOperationsByVenue(current => ({ ...current, [venue.venue_id]: operations }));
      }
      setSaved(`${venue.name} saved. The catalogue is up to date.`);
      setEditing(undefined);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const known = failure instanceof VenueError || failure instanceof VenueLayoutError || failure instanceof VenueOperationsError;
      if (known && [401, 403].includes(failure.status)) {
        setAccess(null);
        setVenues([]);
        setEditing(undefined);
      }
      setError(known ? failure.message
        : 'Unable to save venue. Your changes are still in the form. Please try again.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  // Confirm is disabled while deleting, so one delete runs at a time.
  async function remove(venue: Venue) {
    const controller = new AbortController();
    pending.current = controller;
    setDeleting(true);
    try {
      await deleteVenue(token!, controller.signal, venue.venue_id);
      if (controller.signal.aborted) return;
      setVenues(current => current.filter(item => item.venue_id !== venue.venue_id));
      setRemoving(undefined);
      setSaved(`${venue.name} deleted. It no longer appears in search, availability or new bookings.`);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof VenueDeleteBlocked) setRemoving({ venue, blockers: failure.blockers });
      else if (failure instanceof VenueError && [401, 403].includes(failure.status)) {
        setAccess(null); setVenues([]); setRemoving(undefined); setError(failure.message);
      } else setRemoving({ venue, error: failure instanceof VenueError ? failure.message : 'Unable to delete the venue. Please try again.' });
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setDeleting(false);
    }
  }

  if (!token) return <Notice><Eyebrow>Sign in required</Eyebrow><span>Sign in with your account to view venue records.</span></Notice>;
  if (loading) return <p role="status">Loading venue catalogue…</p>;
  if (!access) return <Notice><p role="alert">{error}</p><GhostButton onClick={() => setAttempt(n => n + 1)}>Retry</GhostButton></Notice>;
  if (bookings) return <VenueBookings token={token} venue={bookings} onClose={() => setBookings(undefined)} />;
  if (blocking) return <VenueBlocks token={token} venue={blocking} onClose={() => setBlocking(undefined)}
    onAccessLost={message => { setAccess(null); setVenues([]); setBlocking(undefined); setError(message); }} />;
  if (editing !== undefined) return <VenueForm venue={editing}
    layouts={editing && can(access, 'venues.layouts.update') ? layoutsByVenue[editing.venue_id] ?? [] : undefined}
    // Unloaded details are left out of the form, so saving cannot overwrite them with defaults.
    operations={editing && can(access, 'venues.operations.update') && operationsByVenue[editing.venue_id] !== null
      ? operationsByVenue[editing.venue_id] ?? NO_OPERATIONS : undefined}
    saving={saving} error={error} onSave={save}
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
              placeholder="Name, location, facilities or access" />
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
            {can(access, 'venues.layouts.read') ? <Fact label="Supported layouts" value={describeLayouts(layoutsByVenue[venue.venue_id] ?? [])} /> : null}
            {can(access, 'venues.operations.read') ? <>
              <Fact label="Setup and turnaround" value={operationsByVenue[venue.venue_id] === null ? 'Unavailable' : describeTimes(operationsByVenue[venue.venue_id] ?? NO_OPERATIONS)} />
              <Fact label="Emergency access" value={operationsByVenue[venue.venue_id] === null ? 'Unavailable' : operationsByVenue[venue.venue_id]?.emergency_access ?? 'Not recorded'} />
              <Fact label="Known restrictions" value={operationsByVenue[venue.venue_id] === null ? 'Unavailable' : operationsByVenue[venue.venue_id]?.known_restrictions ?? 'Not recorded'} />
            </> : null}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {can(access, 'venues.update') ? <GhostButton onClick={() => { setSaved(''); setEditing(venue); }}>Edit {venue.name}</GhostButton> : null}
            {can(access, 'venues.blocks.manage') ? <GhostButton onClick={() => { setSaved(''); setBlocking(venue); }}>Block {venue.name}</GhostButton> : null}
            {can(access, 'venue_bookings.by_venue') ? <GhostButton onClick={() => { setSaved(''); setBookings(venue); }}>Bookings for {venue.name}</GhostButton> : null}
            {can(access, 'venues.delete') && removing?.venue.venue_id !== venue.venue_id
              ? <GhostButton onClick={() => { setSaved(''); setRemoving({ venue }); }}>Delete {venue.name}</GhostButton> : null}
          </div>
          {removing?.venue.venue_id === venue.venue_id ? <RecessedCard padding="18px 20px" style={{ gap: '12px' }}>
            <div role="group" aria-label={`Delete ${venue.name}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowWrap: 'anywhere' }}>
              {removing.blockers ? <>
                <p role="alert" style={{ margin: 0 }}>{venue.name} cannot be deleted while it has current or future work. Clear these first:</p>
                <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '6px' }}>
                  {removing.blockers.map(item => <li key={`${item.kind}-${item.id}`}>
                    {KIND[item.kind]} #{item.id} · {item.event_name ?? 'No event'} · {when.format(new Date(item.starts_at))} – {when.format(new Date(item.ends_at))} (SGT)
                  </li>)}
                </ul>
              </> : <p style={{ margin: 0 }}>Delete {venue.name}? It will be removed from search, availability and new bookings. Past bookings and history keep its name.</p>}
              {removing.error ? <p role="alert" style={{ margin: 0 }}>{removing.error}</p> : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {removing.blockers ? null : <GradientButton disabled={deleting} onClick={() => void remove(venue)}>{deleting ? 'Deleting…' : 'Confirm delete'}</GradientButton>}
                <GhostButton disabled={deleting} onClick={() => setRemoving(undefined)}>{removing.blockers ? 'Close' : 'Cancel'}</GhostButton>
              </div>
            </div>
          </RecessedCard> : null}
        </Card>)}
      </div>
    </section>
  );
}

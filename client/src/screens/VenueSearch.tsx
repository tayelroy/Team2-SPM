import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Card, Eyebrow, Fact, GhostButton, RecessedCard } from '../ui';
import { color, gradient, label, radius } from '../theme';
import { inputStyle } from '../venues/VenueForm';
import { LAYOUT_LABELS, LAYOUTS, describeLayouts, type Layout } from '../venues/layoutsApi';
import { EMPTY_SEARCH, VenueSearchError, formatSgt, searchVenues, sgtToIso, type VenueMatch, type VenueSearchValues } from '../venues/searchApi';
import type { VenueSearchPrefill } from '../venues/searchPrefill';
import { EventVenueFit } from '../venues/VenueFit';
import { EventVenueRequests, VenueRequestForm, requestedNotice } from '../venues/VenueRequests';

const TEXT_FIELDS = [
  ['location', 'Location', 'e.g. North Wing'],
  ['facilities', 'Facilities', 'e.g. projector, stage'],
  ['accessibility', 'Accessibility', 'e.g. step-free, hearing loop']
] as const;

/** The criteria a search actually ran with, in one line (SG2-46 AC4). */
export function describeCriteria(values: VenueSearchValues): string {
  const parts = [`${formatSgt(sgtToIso(values.from))} – ${formatSgt(sgtToIso(values.until))}`];
  if (values.attendance.trim()) parts.push(`${values.attendance.trim()}+ people`);
  if (values.location.trim()) parts.push(`Location: ${values.location.trim()}`);
  if (values.layout) parts.push(`Layout: ${LAYOUT_LABELS[values.layout]}`);
  if (values.facilities.trim()) parts.push(`Facilities: ${values.facilities.trim()}`);
  if (values.accessibility.trim()) parts.push(`Accessibility: ${values.accessibility.trim()}`);
  return parts.join(' · ');
}

/** SG2-46: an Event Coordinator narrows the venues down to those that could
 * host an event — meeting every applied criterion and free for the period. */
export default function VenueSearch({ accessToken, prefill = null }: { accessToken: string; prefill?: VenueSearchPrefill | null }) {
  const [values, setValues] = useState<VenueSearchValues>(prefill?.values ?? EMPTY_SEARCH);
  const [searched, setSearched] = useState<VenueSearchValues | null>(null);
  const [results, setResults] = useState<VenueMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState('');
  // SG2-48: the venue whose request form is open, what the last request
  // said, and a counter that reloads the event's requests after one is made.
  const [requesting, setRequesting] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [requestsVersion, setRequestsVersion] = useState(0);
  const pending = useRef<AbortController | null>(null);

  async function run(criteria: VenueSearchValues) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError('');
    setNotice('');
    setRequesting(null);
    try {
      const venues = await searchVenues(accessToken, controller.signal, criteria);
      setResults(venues);
      setSearched(criteria);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setResults(null);
      setError(failure instanceof VenueSearchError ? failure.message : 'Venue search is unavailable right now. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const rejected = !values.from || !values.until || values.from >= values.until;
    setInvalid(rejected);
    if (!rejected) void run(values);
  }

  // Opening search from an approved event runs it straight away (AC1).
  useEffect(() => {
    // Pre-fill sets both ends of the period together, or neither.
    if (prefill?.values.from) void run(prefill.values);
    return () => { pending.current?.abort(); };
    // Runs once: the parent remounts this screen for a different event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: keyof VenueSearchValues) => (event: { target: { value: string } }) =>
    setValues(current => ({ ...current, [key]: event.target.value }));

  return (
    <section aria-label="Find venues" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <RecessedCard padding="24px 28px" style={{ gap: '18px' }}>
        {prefill ? <Eyebrow>For: {prefill.eventName} (#{prefill.eventId})</Eyebrow> : <Eyebrow>Search venues</Eyebrow>}
        <form onSubmit={submit} aria-label="Venue search criteria">
          <div className="venue-fields">
            {([['from', 'From'], ['until', 'Until']] as const).map(([key, title]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <label htmlFor={`search-${key}`} style={label}>{title} (Singapore time)</label>
                <input id={`search-${key}`} type="datetime-local" required value={values[key]} style={inputStyle} onChange={set(key)} />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="search-attendance" style={label}>Attendance</label>
              <input id="search-attendance" type="number" min={1} step={1} value={values.attendance} style={inputStyle}
                placeholder="Expected guests" onChange={set('attendance')} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="search-layout" style={label}>Layout</label>
              <select id="search-layout" value={values.layout} style={inputStyle}
                onChange={event => setValues(current => ({ ...current, layout: event.target.value as Layout | '' }))}>
                <option value="">Any layout</option>
                {LAYOUTS.map(layout => <option key={layout} value={layout}>{LAYOUT_LABELS[layout]}</option>)}
              </select>
            </div>
            {TEXT_FIELDS.map(([key, title, placeholder]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <label htmlFor={`search-${key}`} style={label}>{title}</label>
                <input id={`search-${key}`} type="text" value={values[key]} placeholder={placeholder} style={inputStyle} onChange={set(key)} />
              </div>
            ))}
          </div>
          {prefill ? <p style={{ color: color.silver, fontSize: '13px', lineHeight: 1.5 }}>
            {prefill.accessibilityNeeds === null
              ? 'No accessibility needs were specified for this event, so accessibility is not used to match venues.'
              : `The event's accessibility needs: “${prefill.accessibilityNeeds}”. Keywords in the Accessibility field must all appear in a venue's accessibility features.`}
          </p> : null}
          <p style={{ color: color.silver, fontSize: '13px', lineHeight: 1.5 }}>
            Separate facility and accessibility keywords with commas. Blocked venues and venues with a confirmed booking in this period are not shown.
          </p>
          {invalid ? <p role="alert">Enter a period that starts before it ends.</p> : null}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button type="submit" style={{ border: 0, borderRadius: radius.sm, padding: '15px 22px',
              background: gradient.aurora, color: '#222', fontSize: '14px', cursor: loading ? 'wait' : 'pointer' }}>
              Search
            </button>
            <GhostButton onClick={() => { setValues(EMPTY_SEARCH); setResults(null); setSearched(null); setInvalid(false); setError(''); }}>Clear</GhostButton>
          </div>
        </form>
      </RecessedCard>

      {loading ? <p role="status">Searching venues…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status" style={{ margin: 0, color: color.accent }}>{notice}</p> : null}
      {!loading && results && searched ? (
        results.length === 0 ? (
          <Card style={{ gap: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No venues match</h2>
            <p style={{ margin: 0, color: color.silver }}>Searched: {describeCriteria(searched)}</p>
            <p style={{ margin: 0, color: color.silver }}>Try a smaller attendance, another layout, fewer keywords or another period.</p>
          </Card>
        ) : (
          <>
            <p role="status" style={{ margin: 0, color: color.silver }}>
              {results.length} {results.length === 1 ? 'venue' : 'venues'} available · {describeCriteria(searched)}
            </p>
            <div className="venue-grid">
              {results.map(venue => (
                <Card key={venue.venue_id} padding="28px" style={{ gap: '18px', minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>{venue.name}</h3>
                      <span style={{ color: color.silver, fontSize: '14px' }}>{venue.location ?? 'Location not recorded'}</span>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span style={{ display: 'block', fontSize: '28px', color: color.phosphor }}>{venue.capacity ?? '—'}</span>
                      <Eyebrow>Capacity</Eyebrow>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: '14px', overflowWrap: 'anywhere' }}>
                    <Fact label="Facilities" value={venue.facilities ?? 'Not recorded'} />
                    <Fact label="Accessibility" value={venue.accessibility_features ?? 'Not recorded'} />
                    <Fact label="Supported layouts" value={describeLayouts(venue.layouts)} />
                  </div>
                  {venue.held.map(period => (
                    <p key={period.starts_at} style={{ margin: 0, fontSize: '13px', color: color.silver }}>
                      ⚠ Held booking {formatSgt(period.starts_at)} – {formatSgt(period.ends_at)} (not confirmed)
                    </p>
                  ))}
                  {/* SG2-48 AC1: from an event's search, request one of the venues found. */}
                  {prefill ? (requesting === venue.venue_id
                    ? <VenueRequestForm accessToken={accessToken} eventId={prefill.eventId} venue={venue}
                        period={{ from: searched.from, until: searched.until }} layout={searched.layout}
                        venueRequirements={prefill.venueRequirements} onCancel={() => setRequesting(null)}
                        onRequested={(_request, booking, conflicts) => {
                          setRequesting(null);
                          setNotice(requestedNotice(venue.name, booking, conflicts));
                          setRequestsVersion(version => version + 1);
                        }} />
                    : <GhostButton onClick={() => { setNotice(''); setRequesting(venue.venue_id); }} style={{ alignSelf: 'flex-start' }}>
                        Request this venue
                      </GhostButton>) : null}
                </Card>
              ))}
            </div>
          </>
        )
      ) : null}
      {/* SG2-47: once a search has run for an event, say which venues do not fit it and why. */}
      {prefill && searched ? <EventVenueFit accessToken={accessToken} eventId={prefill.eventId} eventName={prefill.eventName} /> : null}
      {/* SG2-48 AC3: the event's requests, each shown as pending until decided. */}
      {prefill && searched ? <EventVenueRequests accessToken={accessToken} eventId={prefill.eventId} eventName={prefill.eventName} refresh={requestsVersion} /> : null}
    </section>
  );
}

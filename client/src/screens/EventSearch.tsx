import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { categoryLabel, EVENT_CATEGORIES } from '../api/eventRequests';
import {
  EMPTY_SEARCH,
  fetchSearchOptions,
  searchEvents,
  type AppliedFilters,
  type EventSearchOptions,
  type EventSearchQuery,
  type EventSearchResult,
} from '../api/eventSearch';
import { STATUS_FILTERS } from '../mock/data';
import { badgeStyle, statusLabel } from '../mock/viewModel';
import { color, gradient, label, radius } from '../theme';
import { Badge, Card, Fact, GhostButton, Notice, RecessedCard } from '../ui';
import { inputStyle } from '../venues/VenueForm';
import { formatSgt } from '../venues/searchApi';

// AC3: drafts are never found, so Draft (and the "All" placeholder) are not offered.
const STATES = STATUS_FILTERS.filter((state) => state.value !== 'all' && state.value !== 'draft');
const NOT_RECORDED = 'Not recorded';

type Outcome =
  | { kind: 'loading' }
  | { kind: 'results'; events: EventSearchResult[]; truncated: boolean; filters: AppliedFilters }
  | { kind: 'error'; message: string; retry: boolean };

/** "1 Nov 2031" for a YYYY-MM-DD day, read as a calendar day (no time zone shift). */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * SG2-70 AC4: the filters the server says it applied, in words. Venue and
 * coordinator ids are named from the options when they are known.
 */
export function describeFilters(filters: AppliedFilters, options: EventSearchOptions | null): string[] {
  const parts: string[] = [];
  if (filters.query) parts.push(`Name or organisation contains “${filters.query}”`);
  if (filters.dateFrom && filters.dateTo) parts.push(`Date ${formatDay(filters.dateFrom)} – ${formatDay(filters.dateTo)}`);
  else if (filters.dateFrom) parts.push(`Date from ${formatDay(filters.dateFrom)}`);
  else if (filters.dateTo) parts.push(`Date until ${formatDay(filters.dateTo)}`);
  if (filters.status) parts.push(`State: ${statusLabel(filters.status)}`);
  if (filters.venueId !== null) {
    const venue = options?.venues.find((option) => option.venueId === filters.venueId);
    parts.push(`Venue: ${venue?.name ?? `#${filters.venueId}`}`);
  }
  if (filters.category) parts.push(`Category: ${categoryLabel(filters.category)}`);
  if (filters.coordinatorId === 'unassigned') parts.push('Coordinator: Unassigned');
  else if (filters.coordinatorId) {
    const coordinator = options?.coordinators.find((option) => option.userId === filters.coordinatorId);
    parts.push(`Coordinator: ${coordinator?.name ?? 'Unknown coordinator'}`);
  }
  return parts;
}

/**
 * SG2-70: an internal user finds an event by what they remember about it —
 * its name or client organisation (AC1), narrowed by date, state, venue,
 * category and assigned coordinator, or none (AC2). The server returns only the
 * events the caller's acting role may see, never a draft (AC3), and when
 * nothing matches the screen says so with the filters that were in force (AC4).
 */
export default function EventSearch({ accessToken }: { accessToken: string }) {
  const [values, setValues] = useState<EventSearchQuery>(EMPTY_SEARCH);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'loading' });
  const [options, setOptions] = useState<EventSearchOptions | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [lastQuery, setLastQuery] = useState<EventSearchQuery>(EMPTY_SEARCH);
  const pending = useRef<AbortController | null>(null);

  async function run(query: EventSearchQuery) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLastQuery(query);
    setOutcome({ kind: 'loading' });
    const result = await searchEvents(query, accessToken, controller.signal);
    if (controller.signal.aborted) return;
    if (result.ok) setOutcome({ kind: 'results', events: result.events, truncated: result.truncated, filters: result.filters });
    else if (result.kind === 'invalid') setOutcome({ kind: 'error', message: result.message, retry: false });
    else if (result.kind === 'unauthorized') {
      setOutcome({ kind: 'error', message: 'Only ConnectSphere staff can search events. Sign in again if your role has changed.', retry: false });
    } else setOutcome({ kind: 'error', message: 'Event search is temporarily unavailable. Please try again.', retry: true });
  }

  // Opening the screen lists the events the caller may see, soonest first.
  useEffect(() => {
    void run(EMPTY_SEARCH);
    let cancelled = false;
    fetchSearchOptions(accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setOptions(result.options);
      else setOptionsFailed(true);
    });
    return () => { cancelled = true; pending.current?.abort(); };
    // Runs once: the parent remounts this screen for a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(values);
  }

  function clear() {
    setValues(EMPTY_SEARCH);
    void run(EMPTY_SEARCH);
  }

  const set = (key: keyof EventSearchQuery) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const optionsNote = optionsFailed ? 'Venue and coordinator lists are unavailable right now.' : null;

  return (
    <section aria-label="Find an event" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <RecessedCard padding="24px 28px" style={{ gap: '18px' }}>
        <form onSubmit={submit} aria-label="Event search filters">
          <div className="venue-fields">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="event-search-q" style={label}>Event name or client organisation</label>
              <input id="event-search-q" type="search" value={values.q} maxLength={255} style={inputStyle}
                placeholder="e.g. Harbour Gala" onChange={set('q')} />
            </div>
            {([['from', 'From date'], ['to', 'To date']] as const).map(([key, title]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <label htmlFor={`event-search-${key}`} style={label}>{title}</label>
                <input id={`event-search-${key}`} type="date" value={values[key]} style={inputStyle} onChange={set(key)} />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="event-search-status" style={label}>State</label>
              <select id="event-search-status" value={values.status} style={inputStyle} onChange={set('status')}>
                <option value="">Any state</option>
                {STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="event-search-venue" style={label}>Venue</label>
              <select id="event-search-venue" value={values.venue} style={inputStyle} onChange={set('venue')} disabled={!options}>
                <option value="">Any venue</option>
                {options?.venues.map((venue) => <option key={venue.venueId} value={String(venue.venueId)}>{venue.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="event-search-category" style={label}>Category</label>
              <select id="event-search-category" value={values.category} style={inputStyle} onChange={set('category')}>
                <option value="">Any category</option>
                {EVENT_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <label htmlFor="event-search-coordinator" style={label}>Assigned coordinator</label>
              <select id="event-search-coordinator" value={values.coordinator} style={inputStyle} onChange={set('coordinator')} disabled={!options}>
                <option value="">Any coordinator</option>
                <option value="unassigned">Unassigned</option>
                {options?.coordinators.map((coordinator) => <option key={coordinator.userId} value={coordinator.userId}>{coordinator.name}</option>)}
              </select>
            </div>
          </div>
          {optionsNote ? <p role="status" style={{ color: color.silver, fontSize: '13px' }}>{optionsNote}</p> : null}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
            <button type="submit" style={{ border: 0, borderRadius: radius.sm, padding: '15px 22px', minHeight: '44px',
              background: gradient.aurora, color: '#222', fontSize: '14px', cursor: outcome.kind === 'loading' ? 'wait' : 'pointer' }}>
              Search
            </button>
            <GhostButton onClick={clear}>Clear filters</GhostButton>
          </div>
        </form>
      </RecessedCard>

      {outcome.kind === 'loading' ? <p role="status">Searching events…</p> : null}

      {outcome.kind === 'error' ? (
        <Notice>
          <p role="alert">{outcome.message}</p>
          {outcome.retry ? <GhostButton onClick={() => void run(lastQuery)}>Retry</GhostButton> : null}
        </Notice>
      ) : null}

      {outcome.kind === 'results' && outcome.events.length === 0 ? (
        <Card style={{ gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 500 }}>No events match</h2>
          {describeFilters(outcome.filters, options).length > 0 ? (
            <>
              <p style={{ margin: 0, color: color.silver }}>Nothing matched every filter in force:</p>
              <ul aria-label="Filters in force" style={{ margin: 0, paddingLeft: '20px', color: color.mist, lineHeight: 1.6 }}>
                {describeFilters(outcome.filters, options).map((part) => <li key={part}>{part}</li>)}
              </ul>
              <div><GhostButton onClick={clear}>Clear filters</GhostButton></div>
            </>
          ) : (
            <p style={{ margin: 0, color: color.silver }}>There are no submitted events for your role yet. Drafts are not shown until they are submitted.</p>
          )}
        </Card>
      ) : null}

      {outcome.kind === 'results' && outcome.events.length > 0 ? (
        <section aria-label="Search results" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h2 aria-live="polite" style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: color.silver }}>
            {outcome.truncated
              ? `Showing the first ${outcome.events.length} matching events. Narrow your search to see the rest.`
              : `${outcome.events.length} ${outcome.events.length === 1 ? 'event' : 'events'} found`}
          </h2>
          {outcome.events.map((event) => {
            const title = event.name.trim() || 'Untitled event';
            const titleId = `event-search-result-${event.eventId}`;
            const badge = badgeStyle(event.status);
            return (
              <Card key={event.eventId} padding="24px 28px" style={{ gap: '16px' }}>
                <article aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                    <h3 id={titleId} style={{ margin: 0, fontSize: '22px', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</h3>
                    <Badge bg={badge.badgeBg} fg={badge.badgeFg}>{statusLabel(event.status)}</Badge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }}>
                    <Fact label="Client organisation" value={event.organisation ?? NOT_RECORDED} />
                    <Fact label="Date and time" value={event.proposedDate ? formatSgt(event.proposedDate) : NOT_RECORDED} />
                    <Fact label="Category" value={categoryLabel(event.category)} />
                    <Fact label="Venue" value={event.venues.length ? event.venues.join(', ') : 'No venue yet'} />
                    <Fact label="Coordinator" value={event.coordinatorName ?? 'Unassigned'} />
                    <Fact label="Event number" value={`#${event.eventId}`} />
                  </div>
                </article>
              </Card>
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

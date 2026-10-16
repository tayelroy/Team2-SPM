import { useEffect, useState } from 'react';
import { WEEKDAYS } from '../mock/data';
import { loadSession } from '../auth/session';
import { loadAllVenuesAvailability } from '../venues/availability';
import type { VenueAvailabilitySummary } from '../venues/availability';
import { buildCalendarDays, monthRange, MONTH_LABELS } from '../venues/calendarView';
import type { DayKind } from '../venues/calendarView';
import { color, radius, rule } from '../theme';
import { Card, IconButton } from '../ui';
import './AvailabilityCalendar.css';

type Status = 'loading' | 'ready' | 'no-access' | 'error';

const CURRENT_YEAR = monthRange(new Date()).year;
/** Bounded range for the year dropdown; the arrows stay unbounded either side of it. */
const YEAR_OPTIONS = Array.from({ length: 11 }, (_, i) => CURRENT_YEAR - 5 + i);

const selectStyle = {
  background: color.kelp,
  border: rule.control,
  borderRadius: radius.sm,
  color: color.mist,
  fontSize: '12px',
  letterSpacing: '0.06em',
  padding: '8px 10px',
  outline: 'none',
};

const LEGEND: { label: string; bg: string; bd: string }[] = [
  { label: 'Free', bg: 'rgba(1,29,28,0.5)', bd: 'rgba(203,255,252,0.35)' },
  { label: 'Booked', bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)' },
  { label: 'Tentative', bg: 'rgba(195,175,90,0.18)', bd: 'rgba(230,209,137,0.5)' },
  { label: 'Setup / turnaround', bg: 'rgba(0,130,124,0.1)', bd: 'rgba(203,255,252,0.22)' },
  { label: 'Unavailable', bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)' }
];

const KIND_STYLE: Record<DayKind, { bg: string; bd: string; labelFg: string }> = {
  free: { bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)', labelFg: color.silver },
  booked: { bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)', labelFg: color.mist },
  tentative: { bg: 'rgba(195,175,90,0.18)', bd: 'rgba(230,209,137,0.5)', labelFg: color.mist },
  unavailable: { bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)', labelFg: color.silver },
  preparation: { bg: 'rgba(0,130,124,0.1)', bd: 'rgba(203,255,252,0.22)', labelFg: color.mist },
  mixed: { bg: color.teal, bd: color.teal, labelFg: color.abyss }
};

const dayLabel = new Intl.DateTimeFormat('en-SG', { dateStyle: 'full', timeZone: 'Asia/Singapore' });
const entryTime = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false });

const BLANK_STYLE = { bg: 'transparent', bd: 'transparent', labelFg: color.slate };

/** Month grid across every venue: available, booked, and unavailable days. */
export default function AvailabilityCalendar() {
  const [reference, setReference] = useState(() => new Date());
  const [status, setStatus] = useState<Status>('loading');
  const [venues, setVenues] = useState<VenueAvailabilitySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const range = monthRange(reference);

  useEffect(() => {
    const session = loadSession();
    const controller = new AbortController();
    setStatus('loading');

    loadAllVenuesAvailability(session?.accessToken ?? null, range.from, range.to, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result === null) {
          setStatus('no-access');
          return;
        }
        setVenues(result.venues);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus('error');
      });

    return () => controller.abort();
    // range.from/range.to are derived from `reference`; re-run only when the
    // displayed month actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  // Navigate from the Singapore month on screen; midday UTC on the 1st is
  // inside that month in Singapore too.
  function shiftMonth(delta: number) {
    jumpTo(range.year, range.month + delta);
  }

  function jumpTo(year: number, month: number) {
    setSelectedDate(null);
    setReference(new Date(Date.UTC(year, month, 1, 12)));
  }

  const days = buildCalendarDays(reference, venues);
  const selectedDay = days.find(day => day.date === selectedDate && day.inMonth);
  // The grid deliberately summarises crowded days. Details use the complete
  // source entries so choosing a day also reveals everything behind '+ more'.
  const selectedStart = selectedDate === null ? 0 : Date.parse(`${selectedDate}T00:00:00+08:00`);
  const selectedEntries = selectedDay ? venues.flatMap(venue => venue.entries
    .filter(entry => Date.parse(entry.start) < selectedStart + 86_400_000 && Date.parse(entry.end) > selectedStart)
    .map(entry => ({ ...entry, venue: venue.name }))) : [];
  // Keep the dropdown in sync even if the arrows navigated past the fixed
  // window (unbounded, unlike the dropdown) — extend it rather than showing
  // a year that doesn't match the current selection.
  const yearOptions = YEAR_OPTIONS.includes(range.year)
    ? YEAR_OPTIONS
    : [...YEAR_OPTIONS, range.year].sort((a, b) => a - b);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '20px',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: color.platinum,
          }}
        >
          {range.label}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <select
            aria-label="Jump to month"
            value={range.month}
            onChange={(e) => jumpTo(range.year, Number(e.target.value))}
            style={selectStyle}
          >
            {MONTH_LABELS.map((label, i) => (
              <option key={label} value={i}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Jump to year"
            value={range.year}
            onChange={(e) => jumpTo(Number(e.target.value), range.month)}
            style={selectStyle}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <IconButton label="Previous month" onClick={() => shiftMonth(-1)}>←</IconButton>
          <IconButton label="Next month" onClick={() => shiftMonth(1)}>→</IconButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'center' }}>
        {LEGEND.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div
              aria-hidden="true"
              style={{
                width: '12px',
                height: '12px',
                borderRadius: radius.sm,
                background: item.bg,
                border: `1px solid ${item.bd}`,
              }}
            />
            <span
              style={{
                fontSize: '12px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: color.silver,
              }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {status === 'loading' && <Card padding="28px">Loading venue availability…</Card>}
      {status === 'no-access' && <Card padding="28px">You don't have access to this view.</Card>}
      {status === 'error' && <Card padding="28px">Couldn't load venue availability. Try again.</Card>}

      {status === 'ready' && (
        <Card padding="clamp(12px, 3vw, 28px)" style={{ gap: '14px', minWidth: 0 }}>
          <p className="availability-day-hint">Choose a day to read its full venue details.</p>
          <div className="availability-weekdays" aria-hidden="true">
            {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
          </div>
          <div className="availability-month-grid" aria-label="Venue availability by day">
            {days.map((day, i) => {
              const style = day.inMonth ? KIND_STYLE[day.kind] : BLANK_STYLE;
              const content = <>
                <span className="availability-day-number">{day.n}</span>
                <span className="availability-cell-items">
                  {day.items.map((item, j) => <span key={j} style={{ color: style.labelFg }}>{item}</span>)}
                </span>
                {day.inMonth && <span className="availability-day-marker" aria-hidden="true">
                  {day.kind === 'free' ? 'Free' : '●'}
                </span>}
              </>;
              const dayStyle = { background: style.bg, borderColor: style.bd };
              return day.inMonth ? (
                <button
                  key={day.date}
                  type="button"
                  className="availability-day"
                  aria-label={`${day.date}: ${day.kind}`}
                  aria-pressed={selectedDate === day.date}
                  aria-controls="selected-venue-day"
                  onClick={() => setSelectedDate(day.date)}
                  style={dayStyle}
                >{content}</button>
              ) : (
                <div key={`blank-${i}`} className="availability-day availability-day-blank" aria-hidden="true" style={dayStyle}>{content}</div>
              );
            })}
          </div>
          {selectedDay && <section id="selected-venue-day" className="availability-day-details" aria-label="Selected day availability" aria-live="polite">
            <h3>{dayLabel.format(new Date(`${selectedDate}T12:00:00+08:00`))}</h3>
            {selectedEntries.length === 0 ? <p>No bookings or unavailability recorded for this day.</p> : (
              <ul>
                {selectedEntries.map((entry, i) => <li key={i}>
                  <strong>{entry.venue} · {entry.label}</strong>
                  <span><time dateTime={entry.start}>{entryTime.format(new Date(entry.start))}</time> – <time dateTime={entry.end}>{entryTime.format(new Date(entry.end))}</time> (Singapore time)</span>
                </li>)}
              </ul>
            )}
          </section>}
        </Card>
      )}
    </div>
  );
}

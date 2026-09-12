import { useEffect, useState } from 'react';
import { WEEKDAYS } from '../mock/data';
import { loadSession } from '../auth/session';
import { loadAllVenuesAvailability } from '../venues/availability';
import type { VenueAvailabilitySummary } from '../venues/availability';
import { buildCalendarDays, monthRange } from '../venues/calendarView';
import type { DayKind } from '../venues/calendarView';
import { color, radius } from '../theme';
import { Card, IconButton } from '../ui';

type Status = 'loading' | 'ready' | 'no-access' | 'error';

const LEGEND: { label: string; bg: string; bd: string }[] = [
  { label: 'Free', bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)' },
  { label: 'Booked', bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)' },
  { label: 'Unavailable', bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)' }
];

const KIND_STYLE: Record<DayKind, { bg: string; bd: string; labelFg: string }> = {
  free: { bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)', labelFg: color.silver },
  booked: { bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)', labelFg: color.mist },
  unavailable: { bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)', labelFg: color.silver },
  mixed: { bg: color.teal, bd: color.teal, labelFg: color.abyss }
};

const BLANK_STYLE = { bg: 'transparent', bd: 'transparent', labelFg: color.slate };

/** Month grid across every venue: available, booked, and unavailable days. */
export default function AvailabilityCalendar() {
  const [reference, setReference] = useState(() => new Date());
  const [status, setStatus] = useState<Status>('loading');
  const [venues, setVenues] = useState<VenueAvailabilitySummary[]>([]);

  const range = monthRange(reference);

  useEffect(() => {
    const session = loadSession();
    const controller = new AbortController();
    setStatus('loading');

    loadAllVenuesAvailability(session?.accessToken ?? null, range.from, range.to, controller.signal)
      .then((result) => {
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

  function shiftMonth(delta: number) {
    setReference((prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + delta, 1)));
  }

  const days = buildCalendarDays(reference, venues);

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
        <div style={{ display: 'flex', gap: '10px' }}>
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
        <Card padding="28px" style={{ gap: '14px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7,minmax(0,1fr))',
              gap: '10px',
            }}
          >
            {WEEKDAYS.map((day) => (
              <span
                key={day}
                style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: color.silver,
                  textAlign: 'center',
                }}
              >
                {day}
              </span>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7,minmax(0,1fr))',
              gap: '10px',
            }}
          >
            {days.map((day, i) => {
              const style = day.inMonth ? KIND_STYLE[day.kind] : BLANK_STYLE;
              return (
                <div
                  key={i}
                  style={{
                    minHeight: '96px',
                    borderRadius: radius.sm,
                    padding: '10px',
                    background: style.bg,
                    border: `1px solid ${style.bd}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <span style={{ fontSize: '12px', color: day.inMonth ? color.silver : 'transparent' }}>
                    {day.n}
                  </span>
                  {day.items.map((item, j) => (
                    <span
                      key={j}
                      style={{
                        fontSize: '11px',
                        lineHeight: 1.3,
                        letterSpacing: '0.02em',
                        color: style.labelFg,
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

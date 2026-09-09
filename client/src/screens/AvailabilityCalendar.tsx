import { WEEKDAYS } from '../mock/data';
import { CALENDAR_LEGEND, calendarDays } from '../mock/viewModel';
import { color, radius } from '../theme';
import { Card, IconButton } from '../ui';

/** Month grid for one venue: available, held, confirmed and blocked days. */
export default function AvailabilityCalendar() {
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
          Atrium Hall · October 2026
        </h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <IconButton label="Previous month">←</IconButton>
          <IconButton label="Next month">→</IconButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'center' }}>
        {CALENDAR_LEGEND.map((item) => (
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
          {calendarDays().map((day, i) => (
            <div
              key={`day-${i}`}
              style={{
                minHeight: '96px',
                borderRadius: radius.sm,
                padding: '10px',
                background: day.bg,
                border: `1px solid ${day.bd}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '12px', color: day.numFg }}>{day.n}</span>
              {day.label ? (
                <span
                  style={{
                    fontSize: '11px',
                    lineHeight: 1.3,
                    letterSpacing: '0.04em',
                    color: day.labelFg,
                  }}
                >
                  {day.label}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

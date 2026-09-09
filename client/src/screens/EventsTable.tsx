import { useState } from 'react';
import { STATUS_FILTERS } from '../mock/data';
import type { Role } from '../mock/types';
import { eventCards } from '../mock/viewModel';
import { color, radius, surface } from '../theme';
import { Badge } from '../ui';

const COLUMNS = 'minmax(220px,2.2fr) 1fr 1fr 1fr 40px';

/** Full event list with status filtering. Rows open the detail screen. */
export default function EventsTable({
  role,
  onOpenEvent,
}: {
  role: Role;
  onOpenEvent: () => void;
}) {
  const [filter, setFilter] = useState('All');
  const all = eventCards(role);
  const rows = filter === 'All' ? all : all.filter((e) => e.status === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {STATUS_FILTERS.map((f) => {
          const active = f === filter;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={active}
              style={{
                background: active ? 'rgba(203,255,252,0.16)' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: radius.sm,
                padding: '9px 14px',
                color: active ? color.mist : color.silver,
                fontSize: '12px',
                letterSpacing: '0.06em',
                cursor: 'pointer',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      <div style={{ background: color.kelp, borderRadius: radius.card, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLUMNS,
            gap: '16px',
            padding: '18px 28px',
            background: surface.tableHead,
          }}
        >
          {['Event', 'Date', 'Venue', 'Status', ''].map((heading, i) => (
            <span
              key={heading || `col-${i}`}
              style={{
                fontSize: '10px',
                fontWeight: 500,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: color.silver,
              }}
            >
              {heading}
            </span>
          ))}
        </div>

        {rows.map((event) => (
          <button
            key={event.ref}
            type="button"
            onClick={onOpenEvent}
            style={{
              width: '100%',
              textAlign: 'left',
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: '16px',
              alignItems: 'center',
              padding: '20px 28px',
              background: 'none',
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: '17px', color: color.platinum }}>{event.name}</span>
              <span
                style={{
                  fontSize: '12px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: color.slate,
                }}
              >
                {event.ref} · {event.client}
              </span>
            </span>
            <span style={{ fontSize: '14px', color: color.silver }}>{event.date}</span>
            <span style={{ fontSize: '14px', color: color.silver }}>{event.venue}</span>
            <span style={{ justifySelf: 'start' }}>
              <Badge bg={event.badgeBg} fg={event.badgeFg}>
                {event.status}
              </Badge>
            </span>
            <span
              aria-hidden="true"
              style={{ justifySelf: 'end', color: color.platinum, fontSize: '14px' }}
            >
              ↗
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

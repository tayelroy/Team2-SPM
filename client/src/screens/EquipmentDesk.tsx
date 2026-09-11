import { can } from '../auth/access';
import { usePageAccess } from '../auth/pages';
import { useState } from 'react';
import { EQUIPMENT_STOCK } from '../mock/data';
import { equipmentViews } from '../mock/viewModel';
import { color, radius, surface } from '../theme';
import { RecessedCard, StatFigure } from '../ui';

const COLUMNS = 'minmax(200px,2fr) 1fr 1fr 1.4fr 130px';

/**
 * Equipment requests with live reservation. Reserving a row settles it in
 * place — the prototype's stand-in for decrementing stock across overlapping
 * events.
 */
export default function EquipmentDesk() {
  const { access, run } = usePageAccess();
  const [reserved, setReserved] = useState<Record<number, boolean>>({});
  const rows = equipmentViews(reserved);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
          {['Item / event', 'Qty', 'Window', 'Availability', ''].map((heading, i) => (
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

        {rows.map((row, i) => (
          <div
            key={row.item}
            style={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: '16px',
              alignItems: 'center',
              padding: '20px 28px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '17px', color: color.platinum }}>{row.item}</span>
              <span
                style={{
                  fontSize: '12px',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: color.slate,
                }}
              >
                {row.event}
              </span>
            </div>
            <span style={{ fontSize: '14px', color: color.silver }}>{row.qty}</span>
            <span style={{ fontSize: '14px', color: color.silver }}>{row.window}</span>
            <span style={{ fontSize: '14px', lineHeight: 1.43, color: row.availFg }}>
              {row.avail}
            </span>
            {can(access, 'equipment.reserve') ? <button
              type="button"
              disabled={row.done}
              onClick={() => run('equipment.reserve', () => setReserved((current) => ({ ...current, [i]: true })))}
              style={{
                justifySelf: 'start',
                background: row.btnBg,
                border: `1px solid ${row.btnBd}`,
                borderRadius: radius.sm,
                padding: '11px 15px',
                color: row.btnFg,
                fontSize: '13px',
                letterSpacing: '0.04em',
                cursor: row.done ? 'default' : 'pointer',
              }}
            >
              {row.btn}
            </button> : null}
          </div>
        ))}
      </div>

      <RecessedCard
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: '24px',
        }}
      >
        {EQUIPMENT_STOCK.map((stat) => (
          <div
            key={stat.label}
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <StatFigure value={stat.value} label={stat.label} size={44} />
          </div>
        ))}
      </RecessedCard>
    </div>
  );
}

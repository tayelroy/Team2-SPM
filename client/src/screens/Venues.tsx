import { can } from '../auth/access';
import { usePageAccess } from '../auth/pages';
import { VENUE_FILTERS } from '../mock/data';
import { venueViews } from '../mock/viewModel';
import { color, radius, rule } from '../theme';
import { Card, Dot, Field, IconButton, ImagePlaceholder, RecessedCard } from '../ui';

/**
 * Venue catalogue. Each card closes with a suitability line for the event
 * currently being placed — the check that drives the whole booking flow.
 */
export default function Venues({ onBook }: { onBook: () => void }) {
  const { access, run } = usePageAccess();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <RecessedCard
        padding="28px 30px"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
          gap: '18px',
        }}
      >
        {VENUE_FILTERS.map((f) => (
          <Field key={f.label} label={f.label} defaultValue={f.value} onAbyss />
        ))}
      </RecessedCard>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
          gap: '20px',
        }}
      >
        {venueViews().map((venue) => (
          <Card key={venue.name} padding="30px 32px" style={{ gap: '18px' }}>
            <ImagePlaceholder height="118px" caption="venue photo" />
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '24px',
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    color: color.platinum,
                  }}
                >
                  {venue.name}
                </span>
                <span style={{ fontSize: '14px', color: color.silver }}>{venue.meta}</span>
              </div>
              {can(access, 'venue_booking.request') ? <IconButton label={`Request ${venue.name}`} onClick={() => run('venue_booking.request', onBook)}>
                ↗
              </IconButton> : null}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {venue.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '12px',
                    letterSpacing: '0.04em',
                    padding: '6px 10px',
                    borderRadius: radius.sm,
                    background: 'rgba(255,255,255,0.07)',
                    color: color.mist,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                paddingTop: '14px',
                borderTop: rule.edge,
              }}
            >
              <Dot tone={venue.dot} />
              <span style={{ fontSize: '13px', lineHeight: 1.4, color: venue.fitFg }}>
                {venue.fit}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

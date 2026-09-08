import { FOOTER_LINKS } from '../mock/data';
import { useInertiaScroll } from '../hooks/useInertiaScroll';
import { useParticleOrb } from '../hooks/useParticleOrb';
import { color, layout } from '../theme';
import { GradientButton, Mark } from '../ui';

/**
 * Marketing entry point: a full-height hero built around the particle orb,
 * over a deep-pool footer. Scrolling is eased by `useInertiaScroll`, so the
 * page is a fixed-height clip with a translated track rather than a normal
 * document scroll.
 */
export default function Landing({ onOpenApp }: { onOpenApp: () => void }) {
  const { canvasRef, spacerRef } = useParticleOrb();
  const containerRef = useInertiaScroll();

  return (
    <div
      ref={containerRef}
      style={{
        height: '100vh',
        overflow: 'hidden',
        position: 'relative',
        background: color.abyss,
      }}
    >
      <div style={{ willChange: 'transform' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              cursor: 'crosshair',
            }}
          />
          {/* Drifting atmospheric glows behind the orb. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '-160px',
              right: '-140px',
              width: '520px',
              height: '520px',
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 40% 35%, rgba(203,255,252,0.22), rgba(0,130,124,0.18) 45%, rgba(1,38,36,0) 70%)',
              animation: 'orbdrift 12s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: '-220px',
              left: '-160px',
              width: '560px',
              height: '560px',
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 60% 60%, rgba(250,209,255,0.14), rgba(0,130,124,0.14) 50%, rgba(1,38,36,0) 72%)',
              animation: 'orbdrift 16s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />

          <header
            style={{
              position: 'relative',
              zIndex: 2,
              maxWidth: layout.maxWidth,
              width: '100%',
              margin: '0 auto',
              padding: layout.gutter,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Mark />
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: color.platinum,
                }}
              >
                ConnectSphere
              </span>
            </div>
            <GradientButton onClick={onOpenApp}>Open app</GradientButton>
          </header>

          <div
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '28px',
              maxWidth: '1000px',
              width: '100%',
              margin: '0 auto',
              padding: '64px 28px 0',
              // The orb owns pointer events across the hero.
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: color.silver,
              }}
            >
              Event planning &amp; venue booking
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(2.5rem,7vw,3.8rem)',
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: '-0.04em',
                color: color.platinum,
                maxWidth: '18ch',
                textWrap: 'pretty',
              }}
            >
              Exceptional Events Begin with the Perfect Space
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '16px',
                lineHeight: 1.4,
                color: color.silver,
                maxWidth: '560px',
              }}
            >
              Requests, venues, equipment and registrations in a single place — no
              more spreadsheets, shared calendars and scattered email threads.
            </p>
          </div>
          {/* Grown by the orb hook so the sphere clears the copy. */}
          <div ref={spacerRef} style={{ flex: 'none', pointerEvents: 'none' }} />
        </main>

        <footer
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '56px',
            padding: '80px 28px 28px',
            background:
              'radial-gradient(ellipse 70% 55% at 22% 92%, rgba(0,130,124,0.55) 0%, rgba(1,38,36,0) 68%), linear-gradient(160deg, #013432 0%, #011917 55%, #010f0e 100%)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: layout.maxWidth,
              width: '100%',
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
              gap: '48px',
              alignItems: 'start',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 'clamp(2.1rem,5.5vw,3rem)',
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: '-0.04em',
                color: color.platinum,
                maxWidth: '14ch',
                textWrap: 'pretty',
              }}
            >
              Every event, one current
            </h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '20px',
                textAlign: 'right',
              }}
            >
              <span
                style={{
                  fontSize: 'clamp(1.5rem,3vw,2rem)',
                  fontWeight: 500,
                  lineHeight: 1.1,
                  letterSpacing: '-0.03em',
                  color: color.platinum,
                }}
              >
                Connect with our team
              </span>
              <GradientButton
                style={{ display: 'flex', alignItems: 'center', gap: '14px' }}
              >
                Get in touch <span style={{ fontSize: '15px' }}>↗</span>
              </GradientButton>
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              maxWidth: layout.maxWidth,
              width: '100%',
              margin: '0 auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '32px',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px 20px',
                maxWidth: '640px',
              }}
            >
              {FOOTER_LINKS.map((link) => (
                <a
                  key={link}
                  href="#"
                  style={{
                    fontSize: '15px',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: color.silver,
                  }}
                >
                  {link}
                </a>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {['X', 'in'].map((handle) => (
                <a
                  key={handle}
                  href="#"
                  aria-label={handle === 'X' ? 'ConnectSphere on X' : 'ConnectSphere on LinkedIn'}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    letterSpacing: '0.04em',
                    color: color.mist,
                  }}
                >
                  {handle}
                </a>
              ))}
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              maxWidth: layout.maxWidth,
              width: '100%',
              margin: '0 auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              justifyContent: 'space-between',
              paddingTop: '28px',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {['Built by ConnectSphere', '©2026 ConnectSphere'].map((line) => (
              <span
                key={line}
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: color.slate,
                }}
              >
                {line}
              </span>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ATTENDEE_FACTS } from '../mock/data';
import { color, gradient, radius, rule } from '../theme';
import {
  Badge,
  Card,
  Fact,
  ImagePlaceholder,
  RecessedCard,
} from '../ui';

/**
 * Public-facing event page. Registration is a live toggle; the registration
 * list below reflects it so the state change is visible in both places.
 */
export default function AttendeeEvent() {
  const [registered, setRegistered] = useState(true);

  const registrations = [
    {
      name: 'Northbridge Investor Forum',
      state: registered ? 'Registered' : 'Not registered',
      meta: '12 Oct 2026 · Atrium Hall',
      bg: registered ? color.teal : 'rgba(255,255,255,0.09)',
      fg: registered ? color.abyss : color.mist,
      canWithdraw: registered,
    },
    {
      name: 'Quarterly Partner Dinner',
      state: 'Registered',
      meta: '3 Nov 2026 · The Kelp Room',
      bg: color.teal,
      fg: color.abyss,
      canWithdraw: true,
    },
    {
      name: 'Grad Recruitment Open Day',
      state: 'Registration not open',
      meta: '28 Sep 2026 · venue being confirmed',
      bg: 'rgba(112,119,119,0.35)',
      fg: color.silver,
      canWithdraw: false,
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
        gap: '20px',
        alignItems: 'start',
      }}
    >
      <Card style={{ gap: '24px' }}>
        <ImagePlaceholder height="180px" caption="event banner image" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: color.silver,
            }}
          >
            Registration open · closes 8 Oct
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: '36px',
              fontWeight: 500,
              lineHeight: 1,
              color: color.platinum,
            }}
          >
            Northbridge Investor Forum
          </h2>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.4, color: color.silver }}>
            A half-day forum with two keynotes, a panel, and a standing reception.
            Step-free access and a hearing loop are available in the main hall.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
            gap: '20px',
          }}
        >
          {ATTENDEE_FACTS.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} />
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => setRegistered((on) => !on)}
            style={{
              border: 'none',
              borderRadius: radius.sm,
              padding: '15px 22px',
              // Registering is the primary action, so it takes the gradient;
              // withdrawing steps down to the flat kelp fill.
              background: registered ? color.kelp : gradient.aurora,
              color: registered ? color.platinum : '#222222',
              fontSize: '14px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {registered ? 'Withdraw registration' : 'Register'}
          </button>
          <span style={{ fontSize: '14px', color: color.mist }}>
            {registered
              ? "You're registered — confirmation sent to your email."
              : 'Places are held as soon as you register.'}
          </span>
        </div>
      </Card>

      <RecessedCard style={{ gap: '20px' }}>
        <h3
          style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: color.platinum,
          }}
        >
          My registrations
        </h3>
        {registrations.map((r) => (
          <div
            key={r.name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingBottom: '16px',
              borderBottom: rule.faint,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '17px', color: color.platinum }}>{r.name}</span>
              <Badge bg={r.bg} fg={r.fg}>
                {r.state}
              </Badge>
            </div>
            <span style={{ fontSize: '13px', color: color.silver }}>{r.meta}</span>
            {r.canWithdraw ? (
              <button
                type="button"
                style={{
                  alignSelf: 'flex-start',
                  background: 'none',
                  border: rule.raised,
                  borderRadius: radius.sm,
                  padding: '9px 14px',
                  color: color.mist,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Withdraw
              </button>
            ) : null}
          </div>
        ))}
      </RecessedCard>
    </div>
  );
}

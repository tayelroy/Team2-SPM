import { BOOKING_FACTS, BOOKING_QUEUE } from '../mock/data';
import { color, radius, rule } from '../theme';
import {
  Badge,
  Card,
  Eyebrow,
  Fact,
  GhostButton,
  GradientButton,
  Notice,
  NoticeMark,
  RecessedCard,
  TextField,
} from '../ui';

/**
 * Venue-staff decision screen. The overlap notice is the point of the screen:
 * conflicts are surfaced with concrete alternatives before anyone approves.
 */
export default function BookingApproval() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
        gap: '20px',
        alignItems: 'start',
      }}
    >
      <Card style={{ gap: '26px' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: color.platinum,
          }}
        >
          Booking request — Atrium Hall
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
            gap: '20px',
          }}
        >
          {BOOKING_FACTS.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} />
          ))}
        </div>

        <Notice style={{ padding: '24px 26px' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <NoticeMark />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '16px', color: color.platinum }}>
                Overlaps an existing hold
              </span>
              <span style={{ fontSize: '14px', lineHeight: 1.43, color: color.silver }}>
                Atrium Hall is held 09:00–13:00 on 12 Oct for “Grad Recruitment Open
                Day” (E-190). Requested window 10:00–17:00 overlaps by 3 hours.
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {['Suggest 14:00–21:00', 'Offer Deepwater Auditorium'].map((option) => (
              <button
                key={option}
                type="button"
                style={{
                  background: color.deep,
                  border: rule.raised,
                  borderRadius: radius.sm,
                  padding: '11px 16px',
                  color: color.platinum,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </Notice>

        <TextField
          label="Decision note (shared with the coordinator)"
          placeholder="Reason for approval or rejection…"
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <GradientButton>Approve booking</GradientButton>
          <GhostButton>Reject with reason</GhostButton>
        </div>
      </Card>

      <RecessedCard style={{ gap: '18px' }}>
        <Eyebrow>Pending booking requests</Eyebrow>
        {BOOKING_QUEUE.map((request) => (
          <div
            key={request.venue}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              paddingBottom: '14px',
              borderBottom: rule.faint,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '15px', color: color.platinum }}>
                {request.venue}
              </span>
              <Badge bg={request.bg} fg={request.fg}>
                {request.state}
              </Badge>
            </div>
            <span style={{ fontSize: '13px', lineHeight: 1.4, color: color.silver }}>
              {request.detail}
            </span>
          </div>
        ))}
      </RecessedCard>
    </div>
  );
}

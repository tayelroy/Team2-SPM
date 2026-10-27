import { useEffect, useState } from 'react';
import {
  acceptChangeRequest,
  fetchChangeRequests,
  refuseChangeRequest,
  type AcceptedChange,
  type AffectedArrangementKind,
  type ChangeRequestList,
  type ClarificationNextStep,
  type ImpactReasonCode,
  type RecheckKey,
} from '../api/changeRequests';
import { statusLabel } from '../mock/viewModel';
import { color, radius, rule, surface } from '../theme';
import { Badge, Eyebrow, GhostButton, GradientButton } from '../ui';
import { formatSgtTimestamp, humanizeFieldValue } from './EventAuditDrawer';

export interface ChangeRequestsPanelProps {
  eventId: number;
  accessToken: string;
  /** Called after the server accepted a change, so the screen can re-read the event. */
  onAccepted: (change: AcceptedChange) => void;
}

const KIND_LABELS: Record<AffectedArrangementKind, string> = {
  venue_booking: 'Venue booking',
  venue_request: 'Venue request',
  equipment_reservation: 'Equipment reservation',
  equipment_request: 'Equipment request',
  registrations: 'Registrations',
};

/** Matches the server's wording: only a confirmed venue booking is "booked". */
const PERIOD_VERBS: Record<AffectedArrangementKind, string> = {
  venue_booking: 'Booked',
  venue_request: 'Requested',
  equipment_reservation: 'Reserved',
  equipment_request: 'Requested',
  registrations: 'Open',
};

/** AC1 revalidate, AC2 capacity check, AC3 period recheck: each reads differently at a glance. */
const REASONS: Record<ImpactReasonCode, { label: string; bg: string; fg: string }> = {
  revalidate: { label: 'Revalidate', bg: 'rgba(255,255,255,0.08)', fg: color.silver },
  capacity_check: { label: 'Capacity check', bg: 'rgba(250,209,255,0.16)', fg: color.phosphor },
  period_recheck: { label: 'Period recheck', bg: surface.notice, fg: color.accent },
};

const SIGNIFICANT = { label: 'Significant change', bg: 'rgba(255, 180, 0, 0.2)', fg: '#fde047' };
const NOT_SIGNIFICANT = { label: 'No revalidation needed', bg: 'rgba(0,130,124,0.35)', fg: color.mist };

const MAX_REASON_LENGTH = 1000;

/** SG2-65 AC4: the two ways to accept a change on a request returned for clarification. */
const NEXT_STEPS: { next: ClarificationNextStep; label: string }[] = [
  { next: 'review', label: 'Accept and return to review' },
  { next: 'resubmit', label: 'Accept and ask organiser to resubmit' },
];

const RECHECK_NAMES: Record<RecheckKey, string> = {
  venue_recheck: 'venue',
  equipment_recheck: 'equipment',
  registration_recheck: 'registrations',
  safety_venue_recheck: 'venue (safety check)',
  safety_equipment_recheck: 'equipment (safety check)',
  safety_other_recheck: 'other arrangements (safety check)',
};

/**
 * SG2-66 AC1–AC4: the assigned coordinator sees what each change request
 * would break before accepting it. The requests are the ones organisers
 * raised (SG2-64); the impact is always recomputed by the server.
 * SG2-65: the coordinator can also refuse one with a reason (AC2), and on a
 * request returned for clarification chooses where it goes next (AC4).
 */
export default function ChangeRequestsPanel({ eventId, accessToken, onAccepted }: ChangeRequestsPanelProps) {
  const [list, setList] = useState<ChangeRequestList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One acceptance in flight at a time: every Accept button is disabled meanwhile.
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<{ id: string; message: string } | null>(null);
  // SG2-65 AC2: the request whose refusal form is open, and its reason.
  const [refusingId, setRefusingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setLoadError(null);
    void fetchChangeRequests(eventId, accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setList(result.list);
      else setLoadError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, accessToken, attempt]);

  const decided = (id: string) =>
    setList((current) => current && { ...current, change_requests: current.change_requests.filter((r) => r.id !== id) });

  const accept = async (id: string, next?: ClarificationNextStep) => {
    setAcceptingId(id);
    setAcceptError(null);
    setRefused(false);
    const result = await acceptChangeRequest(eventId, id, accessToken, next);
    setAcceptingId(null);
    if (!result.ok) {
      setAcceptError({ id, message: [result.message, ...(result.details ?? [])].join(' ') });
      return;
    }
    // Accepted requests are no longer listed by the server either.
    decided(id);
    onAccepted(result.change);
  };

  const refuse = async (id: string) => {
    setAcceptingId(id);
    setAcceptError(null);
    const result = await refuseChangeRequest(eventId, id, reason.trim(), accessToken);
    setAcceptingId(null);
    if (!result.ok) {
      setAcceptError({ id, message: [result.message, ...(result.details ?? [])].join(' ') });
      return;
    }
    setRefusingId(null);
    setReason('');
    setRefused(true);
    decided(id);
  };

  return (
    <section
      data-testid="change-requests-panel"
      aria-label="Change requests"
      style={{ display: 'grid', gap: '16px', minWidth: 0, overflowWrap: 'anywhere' }}
    >
      <h3 style={{ margin: 0 }}>Change requests</h3>
      {refused ? (
        <p role="status" style={{ margin: 0, color: color.silver }}>
          Change refused. The event is unchanged and the organiser has been told why.
        </p>
      ) : null}
      {loadError !== null ? (
        <div style={{ display: 'grid', gap: '10px', justifyItems: 'start' }}>
          <p role="alert" style={{ margin: 0 }}>{loadError}</p>
          <GhostButton onClick={() => setAttempt((value) => value + 1)}>Retry</GhostButton>
        </div>
      ) : !list ? (
        <p role="status" style={{ margin: 0 }}>Loading change requests…</p>
      ) : list.change_requests.length === 0 ? (
        <p style={{ margin: 0, color: color.silver }}>No change requests are waiting for your decision.</p>
      ) : (
        <>
          {list.can_accept ? null : (
            <p role="status" style={{ margin: 0, color: color.silver }}>
              Changes cannot be accepted while this event is {statusLabel(list.event.status)}.
            </p>
          )}
          {list.change_requests.map((request) => {
            const marker = request.significant ? SIGNIFICANT : NOT_SIGNIFICANT;
            const names = request.impact.outstanding_arrangements.map((key) => RECHECK_NAMES[key]);
            const outstandingNames =
              names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
            const { arrangements } = request.impact;
            return (
              <article
                key={request.id}
                data-testid={`change-request-${request.id}`}
                aria-label={`Change request ${request.id}`}
                style={{
                  display: 'grid',
                  gap: '14px',
                  padding: 'clamp(16px, 3vw, 24px)',
                  background: surface.sunken,
                  border: rule.edge,
                  borderRadius: radius.card,
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <Eyebrow>Requested {formatSgtTimestamp(request.requested_at)}</Eyebrow>
                  <Badge bg={marker.bg} fg={marker.fg} size={10}>{marker.label}</Badge>
                </div>
                <p style={{ margin: 0, color: color.mist }}>{request.reason}</p>
                <ul aria-label="Requested changes" style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '6px' }}>
                  {request.changes.map((change) => (
                    <li key={change.field}>
                      <strong style={{ color: color.platinum }}>{change.label}</strong>:{' '}
                      {[change.from, change.to]
                        .map((value) => humanizeFieldValue(change.field, value === null ? null : String(value)))
                        .join(' → ')}
                    </li>
                  ))}
                </ul>
                {arrangements.length > 0 ? (
                  <>
                    <h4 style={{ margin: 0 }}>Affected arrangements</h4>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px' }}>
                      {arrangements.map((item, index) => (
                        <li
                          key={`${item.kind}:${item.id ?? index}`}
                          data-testid="affected-arrangement"
                          style={{
                            display: 'grid',
                            gap: '8px',
                            padding: '12px 14px',
                            background: surface.field,
                            border: rule.faint,
                            borderRadius: radius.sm,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                            <Eyebrow>{KIND_LABELS[item.kind]}</Eyebrow>
                            <strong style={{ color: color.platinum }}>{item.label}</strong>
                          </div>
                          {item.starts_at ? (
                            <span style={{ color: color.silver, fontSize: '13px' }}>
                              {PERIOD_VERBS[item.kind]} for {formatSgtTimestamp(item.starts_at)} – {formatSgtTimestamp(item.ends_at)}
                            </span>
                          ) : null}
                          <ul
                            aria-label={`Why ${item.label} needs attention`}
                            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}
                          >
                            {item.reasons.map((reason) => (
                              <li
                                key={reason.code}
                                data-reason={reason.code}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '10px',
                                  borderLeft: `3px solid ${REASONS[reason.code].fg}`,
                                  paddingLeft: '10px',
                                }}
                              >
                                <Badge bg={REASONS[reason.code].bg} fg={REASONS[reason.code].fg} size={10}>
                                  {REASONS[reason.code].label}
                                </Badge>
                                <span style={{ color: color.mist, fontSize: '13px' }}>{reason.message}</span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
                      Accepting marks the {outstandingNames} as outstanding. The event stays in Planning until
                      each one is rechecked.
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, color: color.silver, fontSize: '13px' }}>
                    {request.significant
                      ? 'No existing arrangements are affected by this change.'
                      : 'Accepting updates the event details only; no arrangements need rechecking.'}
                  </p>
                )}
                {acceptError?.id === request.id ? (
                  <p role="alert" style={{ margin: 0 }}>{acceptError.message}</p>
                ) : null}
                {refusingId === request.id ? (
                  <div style={{ display: 'grid', gap: '8px', minWidth: 0 }}>
                    <label htmlFor={`refuse-reason-${request.id}`}>Reason for refusing</label>
                    <textarea
                      id={`refuse-reason-${request.id}`}
                      rows={3}
                      maxLength={MAX_REASON_LENGTH}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className="organisation-textarea"
                    />
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <GradientButton
                        onClick={() => void refuse(request.id)}
                        disabled={reason.trim() === '' || acceptingId !== null}
                      >
                        {acceptingId === request.id ? 'Refusing change…' : 'Confirm refusal'}
                      </GradientButton>
                      <GhostButton onClick={() => { setRefusingId(null); setReason(''); }} disabled={acceptingId !== null}>
                        Cancel
                      </GhostButton>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {list.next_step_required ? (
                      NEXT_STEPS.map(({ next, label }) => (
                        <GradientButton
                          key={next}
                          onClick={() => void accept(request.id, next)}
                          disabled={acceptingId !== null}
                        >
                          {label}
                        </GradientButton>
                      ))
                    ) : (
                      <GradientButton
                        onClick={() => void accept(request.id)}
                        disabled={!list.can_accept || acceptingId !== null}
                      >
                        {acceptingId === request.id ? 'Accepting change…' : 'Accept change'}
                      </GradientButton>
                    )}
                    <GhostButton
                      onClick={() => { setRefusingId(request.id); setReason(''); setAcceptError(null); }}
                      disabled={acceptingId !== null}
                    >
                      Refuse change
                    </GhostButton>
                  </div>
                )}
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import {
  categoryLabel,
  fetchOwnEventDetail,
  getEventStage,
  submitEventRequest,
  type EventRequestDetail,
  type EventStageResult
} from '../api/eventRequests';
import EventAuditDrawer from '../components/EventAuditDrawer';
import EventStageTracker from '../components/EventStageTracker';
import ClarificationThread from '../components/ClarificationThread';
import ConfirmedArrangements from '../components/ConfirmedArrangements';
import SafetyDecisionSummary from '../components/SafetyDecisionSummary';
import RegistrationPanel from '../components/RegistrationPanel';
import CancellationPanel from '../components/CancellationPanel';
import { terminalEventStatus } from '../eventLifecycle';
import OrganiserChangeRequests from '../components/OrganiserChangeRequests';
import type { Role, Screen } from '../mock/types';
import { badgeStyle, lockedRequestNotice, statusLabel } from '../mock/viewModel';
import { color, radius } from '../theme';
import { Badge, Card, Notice, NoticeMark } from '../ui';
import { formatProposedDate } from './EventsTable';
import { formatSgtTimestamp } from '../components/EventAuditDrawer';

export interface EventDetailProps {
  role: Role;
  onNavigate: (screen: Screen) => void;
  selectedEventId?: number;
  accessToken?: string;
}

const ARRANGEMENT_LABELS: Record<string, string> = {
  venue_recheck: 'Venue Suitability Recheck',
  equipment_recheck: 'Equipment Recheck',
  registration_recheck: 'Registration Capacity Recheck',
  // SG2-93 AC1: arrangements a Safety Officer's Request changes left outstanding.
  safety_venue_recheck: 'Venue Changes (Safety Check)',
  safety_equipment_recheck: 'Equipment Changes (Safety Check)',
  safety_other_recheck: 'Other Changes (Safety Check)',
  venue: 'Venue Suitability Recheck',
  equipment: 'Equipment Recheck',
  registration: 'Registration Capacity Recheck',
};

/** Organisation-scoped request detail. All event content comes from the API. */
export default function EventDetail({
  role,
  onNavigate,
  selectedEventId,
  accessToken,
}: EventDetailProps) {
  const isOrganiser = role === 'Event Organiser';

  const [detail, setDetail] = useState<EventRequestDetail | null>(null);
  const [stage, setStage] = useState<EventStageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    if (!isOrganiser || !selectedEventId || !accessToken) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setStage(null);

    fetchOwnEventDetail(selectedEventId, accessToken)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setDetail(result.request);
          // SG2-38: a colleague's view-only copy has no stage access on the
          // server, so asking for it would only earn a 403. The stage is
          // fetched once the detail says whose event this is.
          if (result.request.canManage) {
            getEventStage(selectedEventId, accessToken)
              .then((stageResult) => {
                if (!cancelled && stageResult.ok) {
                  setStage(stageResult.stage);
                }
              })
              .catch(() => {
                // Stage error does not prevent event details from displaying
              });
          }
        } else if (result.kind === 'not_found') {
          setNotFound(true);
        } else if (result.kind === 'unauthorized') {
          setError('Your session has expired. Please sign in again.');
        } else if (result.kind === 'unavailable') {
          setError('Event request details are temporarily unavailable. Please try again later.');
        } else {
          setError(result.message || 'Failed to load event details.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Event request details are temporarily unavailable. Please try again later.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOrganiser, selectedEventId, accessToken, reloadKey]);

  if (!isOrganiser) {
    return <Card><p role="alert">Event requests are available only to Event Organisers.</p></Card>;
  }

  if (selectedEventId && accessToken) {
    if (loading) {
      return (
        <div
          role="status"
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            color: color.silver,
            fontSize: '15px',
          }}
        >
          Loading event details…
        </div>
      );
    }

    if (notFound) {
      return (
        <Card style={{ gap: '20px', alignItems: 'flex-start' }}>
          <NoticeMark size={24} />
          <h2 style={{ margin: 0, fontSize: '24px', color: color.platinum }}>
            Event request not found
          </h2>
          <p style={{ margin: 0, color: color.silver }}>
            No event request found for this account. It may have been deleted or belongs to
            another organisation.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('events')}
            style={{
              background: color.kelp,
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: radius.sm,
              padding: '10px 18px',
              color: color.platinum,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Back to events
          </button>
        </Card>
      );
    }

    if (error) {
      return (
        <Notice style={{ flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <NoticeMark size={20} />
            <span role="alert" style={{ fontSize: '15px', color: color.platinum }}>
              {error}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={reload}
              style={{
                background: color.kelp,
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: radius.sm,
                padding: '8px 16px',
                color: color.platinum,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => onNavigate('events')}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: radius.sm,
                padding: '8px 16px',
                color: color.silver,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Back to events
            </button>
          </div>
        </Notice>
      );
    }

    if (detail) {
      const badge = badgeStyle(detail.status);
      const isRejected = detail.status.toLowerCase() === 'rejected';
      // SG2-36: the coordinator has asked a question and is waiting on the organiser.
      const needsClarification = detail.status.toLowerCase() === 'needs_clarification';
      const isTerminal = terminalEventStatus(detail.status) !== null;
      const isLocked = isTerminal || !detail.waitingOnMe;
      // SG2-64 AC5: a request returned for clarification is answered in the
      // thread and changed through a change request, never edited directly.
      const canEditRequest = !isLocked && !needsClarification;
      // SG2-64 AC1/AC4: change requests on any submitted, still-open event.
      const canRequestChange = detail.canManage && Boolean(accessToken)
        && !isTerminal && detail.status.toLowerCase() !== 'draft';

      // SG2-36/SG2-64 AC5: once the question is answered, the organiser sends
      // the request back to review as it stands.
      const resubmit = async () => {
        setResubmitting(true);
        setResubmitError(null);
        const result = await submitEventRequest(detail.eventId, accessToken!);
        setResubmitting(false);
        if (result.ok) reload();
        else setResubmitError(result.kind === 'error' ? result.message : 'Could not resubmit the request. Please try again.');
      };

      const facts = [
        { label: 'Organisation', value: detail.organisation || '—' },
        { label: 'Proposed date', value: formatProposedDate(detail.proposedDate) },
        {
          label: 'Expected attendance',
          value: detail.expectedAttendance !== null ? String(detail.expectedAttendance) : '—',
        },
        { label: 'Venue requirements', value: detail.venueRequirements || 'None specified' },
        // SG2-105: requests submitted before the layout was asked for have none.
        { label: 'Preferred room layout', value: detail.preferredLayout || 'Not specified' },
        // SG2-70: the kind of event, which internal users can filter by.
        { label: 'Category', value: categoryLabel(detail.category) },
        { label: 'Coordinator', value: detail.coordinatorName || 'Unassigned' },
        ...(detail.coordinatorName
          ? [{ label: 'Coordinator contact', value: detail.coordinatorPhone || 'No phone number on file' }]
          : []),
        { label: 'Accessibility needs', value: detail.accessibilityNeeds || 'None specified' },
        {
          label: 'Equipment requirements',
          value: detail.equipmentRequirements || 'None specified',
        },
        { label: 'Registration required', value: detail.registrationNeeded ? 'Yes' : 'No' },
        // SG2-100 AC4: a completed event says who closed it out and when.
        ...(detail.completedAt
          ? [
              { label: 'Completed at', value: formatSgtTimestamp(detail.completedAt) },
              { label: 'Completed by', value: detail.completedBy ?? '—' },
            ]
          : []),
      ];

      return (
        <article className="organisation-detail">
          <div className="organisation-detail-header">
            <div className="organisation-detail-status">
              <Badge bg={badge.badgeBg} fg={badge.badgeFg}>{statusLabel(detail.status)}</Badge>
              <span className="organisation-event-ref">#{detail.eventId}</span>
            </div>
            <button className="organisation-text-button" type="button" onClick={() => onNavigate('events')}>
              ← Back to events
            </button>
          </div>

          {stage && (
            <div className="organisation-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <EventStageTracker stage={stage} />
              {stage.arrangements_recheck_needed && !isTerminal && (
                <Notice
                  data-testid="arrangements-recheck-banner"
                  style={{
                    borderColor: 'rgba(255, 180, 0, 0.4)',
                    background: 'rgba(255, 180, 0, 0.08)',
                  }}
                >
                  <NoticeMark size={18} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <strong style={{ color: '#fde047', fontSize: '14px' }}>
                      Arrangements Outstanding: Venue & Equipment Recheck Needed
                    </strong>
                    <span style={{ color: color.mist, fontSize: '13px' }}>
                      Changes have been made that affect existing venue, equipment, or registration
                      arrangements. These arrangements remain outstanding until verified by the
                      coordinator.
                    </span>
                    {stage.outstanding_arrangements && stage.outstanding_arrangements.length > 0 && (
                      <>
                        <div
                          data-testid="outstanding-arrangements-tags"
                          style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}
                        >
                          {stage.outstanding_arrangements.map((arr) => (
                            <Badge
                              key={arr}
                              bg="rgba(255, 180, 0, 0.2)"
                              fg="#fde047"
                              size={10}
                            >
                              {ARRANGEMENT_LABELS[arr] ?? arr}
                            </Badge>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </Notice>
              )}
            </div>
          )}

          <section className="organisation-detail-intro">
            <h2>{detail.name || 'Untitled event'}</h2>
            <p>{detail.purpose || 'No purpose specified'}</p>
            {detail.description ? <p className="organisation-detail-description">{detail.description}</p> : null}
          </section>
          {/* SG2-37: a rejection always explains itself, so the organiser can
              understand the decision and discuss revisions with the coordinator. */}
          {isRejected && detail.decisionReason ? (
            <section className="organisation-detail-intro" aria-label="Why this request was rejected">
              <h3>Why this was rejected</h3>
              <p className="organisation-detail-description">{detail.decisionReason}</p>
            </section>
          ) : null}
          {detail.canManage && detail.status.toLowerCase() !== 'draft' && accessToken ? (
            <ClarificationThread
              eventId={detail.eventId}
              accessToken={accessToken}
              canPost={needsClarification}
              prompt="Answer your coordinator"
            />
          ) : null}
          <dl className="organisation-detail-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {/* SG2-58 AC1/AC3: the creating organiser sees what was confirmed;
              the server returns 404 to anyone else. */}
          {['confirmed', 'completed'].includes(detail.status.toLowerCase()) && detail.canManage && (
            <ConfirmedArrangements eventId={detail.eventId} accessToken={accessToken} />
          )}
          {/* SG2-64 AC1/AC3: the creating organiser asks for a change and sees
              what is still waiting on the coordinator. */}
          {canRequestChange && (
            <OrganiserChangeRequests eventId={detail.eventId} accessToken={accessToken!} />
          )}
          {/* SG2-92 AC4–AC6: the latest safety decision for the creating
              organiser; coordinator rework is available from the work queue. */}
          {detail.canManage && accessToken
            && ['planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'].includes(detail.status.toLowerCase()) && (
            <SafetyDecisionSummary
              eventId={detail.eventId}
              accessToken={accessToken}
              status={detail.status.toLowerCase()}
              canRework={false}
              onReworked={reload}
            />
          )}
          {/* SG2-63: the registration picture for the organisation's organisers;
              only the creating organiser changes
              the settings, and the server decides who sees contact details. */}
          {accessToken && detail.registrationNeeded
            && detail.status.toLowerCase() !== 'draft' && (
            <RegistrationPanel eventId={detail.eventId} accessToken={accessToken} />
          )}
          {/* SG2-67: the creating organiser asks to cancel with a reason and sees
              the recorded cancellation; the coordinator acts from the work queue. */}
          {accessToken && detail.canManage
            && !['draft', 'rejected', 'completed'].includes(detail.status.toLowerCase()) && (
            <CancellationPanel
              eventId={detail.eventId}
              accessToken={accessToken}
              mode="organiser"
              status={detail.status.toLowerCase()}
              requestedAt={detail.cancellationRequestedAt ?? null}
              reason={detail.cancellationReason ?? null}
              cancelledAt={detail.cancelledAt ?? null}
              onChanged={reload}
            />
          )}
          <footer className="organisation-detail-footer">
            <h3>Your options</h3>
            {!detail.canManage ? (
              // SG2-38: view only means the creator's history and stage stay
              // with the creator; the server refuses both to colleagues.
              <p role="status" className="organisation-detail-notice">
                View only. This event is shared with your organisation. Only its creator can edit or submit the request.
              </p>
            ) : (
              <>
                {needsClarification ? (
                  <div className="organisation-detail-notice" role="status" aria-label="Your coordinator has a question">
                    <strong>Your coordinator has a question</strong>
                    <p>Answer it in the conversation above. Ask for any change to the request through a change request, then resubmit it for review.</p>
                  </div>
                ) : null}
                {resubmitError ? (
                  <p role="alert" className="organisation-detail-notice">{resubmitError}</p>
                ) : null}
                {isLocked ? (
                  <p role="status" aria-label="Editing disabled" className="organisation-detail-notice">
                    {lockedRequestNotice(detail)}
                  </p>
                ) : null}
                <div className="organisation-detail-actions">
                  {canEditRequest ? (
                    <button className="organisation-button organisation-button-primary" type="button" onClick={() => onNavigate('drafts')}>Edit request</button>
                  ) : null}
                  {needsClarification && accessToken ? (
                    <button
                      className="organisation-button organisation-button-primary"
                      type="button"
                      onClick={() => void resubmit()}
                      disabled={resubmitting}
                    >
                      {resubmitting ? 'Resubmitting…' : 'Resubmit for review'}
                    </button>
                  ) : null}
                  <button
                    className="organisation-button"
                    type="button"
                    onClick={() => setIsHistoryDrawerOpen(true)}
                  >
                    View Change History
                  </button>
                </div>
              </>
            )}
            <p className="organisation-detail-hint">
              {!detail.canManage
                ? 'Contact the request creator if this event needs updating.'
                : isRejected
                  ? 'The rejection reason and change history remain available.'
                  : needsClarification
                    ? 'Answer your coordinator, then resubmit the request for review.'
                    : isLocked
                      ? 'Your coordinator will be in touch if clarification is needed.'
                      : 'You can edit and submit this request while it is a draft.'}
            </p>
          </footer>
          {detail.canManage ? (
            <EventAuditDrawer
              isOpen={isHistoryDrawerOpen}
              onClose={() => setIsHistoryDrawerOpen(false)}
              eventId={detail.eventId}
              eventName={detail.name}
              accessToken={accessToken}
            />
          ) : null}
        </article>
      );
    }
  }

  return (
    <Card>
      <p>Select an event from your organisation’s events to view its details.</p>
      <button className="organisation-button" type="button" onClick={() => onNavigate('events')}>Back to events</button>
    </Card>
  );
}

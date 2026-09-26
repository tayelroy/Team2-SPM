import { useEffect, useState } from 'react';
import {
  fetchOwnEventDetail,
  getEventStage,
  type EventRequestDetail,
  type EventStageResult
} from '../api/eventRequests';
import EventPlanningDrawer from './EventPlanningDrawer';
import { loadSession } from '../auth/session';
import EventStageTracker from '../components/EventStageTracker';
import type { Role, Screen } from '../mock/types';
import { badgeStyle } from '../mock/viewModel';
import { color, radius } from '../theme';
import { Badge, Card, Notice, NoticeMark } from '../ui';
import { formatProposedDate } from './EventsTable';

export interface EventDetailProps {
  role: Role;
  onNavigate: (screen: Screen) => void;
  /**
   * The current status of the event request. When `'submitted'`, organiser
   * actions are disabled (AC3). Defaults to `undefined` (no restriction).
   */
  eventStatus?: string;
  selectedEventId?: number;
  accessToken?: string;
  currentUserId?: string;
}

const ARRANGEMENT_LABELS: Record<string, string> = {
  venue_recheck: 'Venue Suitability Recheck',
  equipment_recheck: 'Equipment Recheck',
  registration_recheck: 'Registration Capacity Recheck',
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
  currentUserId,
}: EventDetailProps) {
  const isOrganiser = role === 'Event Organiser';
  const isCoordinator = role === 'Event Coordinator';
  const isAuthorizedRole = isOrganiser || (isCoordinator && Boolean(selectedEventId));

  const [detail, setDetail] = useState<EventRequestDetail | null>(null);
  const [stage, setStage] = useState<EventStageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isPlanningDrawerOpen, setIsPlanningDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isAuthorizedRole || !selectedEventId || !accessToken) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    getEventStage(selectedEventId, accessToken)
      .then((stageResult) => {
        if (!cancelled && stageResult.ok) {
          setStage(stageResult.stage);
        }
      })
      .catch(() => {
        // Stage error does not prevent event details from displaying
      });

    fetchOwnEventDetail(selectedEventId, accessToken)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setDetail(result.request);
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
  }, [isAuthorizedRole, selectedEventId, accessToken, reloadKey]);

  if (!isAuthorizedRole) {
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
              onClick={() => setReloadKey((k) => k + 1)}
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
      const isLocked = !detail.waitingOnMe;
      const isRejected = detail.status.toLowerCase() === 'rejected';
      const isTerminal = ['cancelled', 'completed', 'rejected'].includes(detail.status.toLowerCase());

      const session = loadSession();
      const resolvedUserId = currentUserId ?? session?.user?.userId;
      const isAssignedCoordinator =
        isCoordinator &&
        Boolean(
          detail.coordinatorId &&
            (!resolvedUserId || detail.coordinatorId === resolvedUserId),
        );
      const canEditPlanning = isAssignedCoordinator && !isTerminal;

      const facts = [
        { label: 'Organisation', value: detail.organisation || '—' },
        { label: 'Proposed date', value: formatProposedDate(detail.proposedDate) },
        {
          label: 'Expected attendance',
          value: detail.expectedAttendance !== null ? String(detail.expectedAttendance) : '—',
        },
        { label: 'Venue requirements', value: detail.venueRequirements || 'None specified' },
        { label: 'Coordinator', value: detail.coordinatorName || 'Unassigned' },
        { label: 'Accessibility needs', value: detail.accessibilityNeeds || 'None specified' },
        {
          label: 'Equipment requirements',
          value: detail.equipmentRequirements || 'None specified',
        },
        { label: 'Registration required', value: detail.registrationNeeded ? 'Yes' : 'No' },
      ];

      return (
        <article className="organisation-detail">
          <div className="organisation-detail-header">
            <div className="organisation-detail-status">
              <Badge bg={badge.badgeBg} fg={badge.badgeFg}>{detail.status}</Badge>
              <span className="organisation-event-ref">#{detail.eventId}</span>
            </div>
            <button className="organisation-text-button" type="button" onClick={() => onNavigate('events')}>
              ← Back to events
            </button>
          </div>

          {stage && (
            <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <EventStageTracker stage={stage} />
              {stage.arrangements_recheck_needed && (
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
          <dl className="organisation-detail-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <footer className="organisation-detail-footer">
            <h3>Your options</h3>
            {!detail.canManage && !isCoordinator ? (
              <p role="status" className="organisation-detail-notice">
                View only. This event is shared with your organisation. Only its creator can edit or submit the request.
              </p>
            ) : (
              <>
                {isRejected && isOrganiser ? (
                  <div className="organisation-detail-notice">
                    <strong>Request returned for revision</strong>
                    <p>This request was returned by your coordinator. Please review the details, make necessary amendments, and resubmit.</p>
                  </div>
                ) : null}
                {isLocked && isOrganiser ? (
                  <p role="status" aria-label="Editing disabled: request submitted" className="organisation-detail-notice">
                    This request has been submitted and is now with your coordinator. Contact your coordinator if an amendment is needed.
                  </p>
                ) : null}
                <div className="organisation-detail-actions">
                  {!isLocked && isOrganiser ? (
                    <button className="organisation-button organisation-button-primary" type="button" onClick={() => onNavigate('drafts')}>Edit request</button>
                  ) : null}
                  {canEditPlanning ? (
                    <button
                      className="organisation-button organisation-button-primary"
                      type="button"
                      onClick={() => setIsPlanningDrawerOpen(true)}
                    >
                      Edit Planning Information
                    </button>
                  ) : null}
                </div>
              </>
            )}
            <p className="organisation-detail-hint">
              {isCoordinator
                ? canEditPlanning
                  ? 'Update event planning information, dates, attendance, and requirements.'
                  : isTerminal
                    ? 'Planning details cannot be modified for terminal events.'
                    : 'Awaiting assignment to coordinator.'
                : !detail.canManage
                  ? 'Contact the request creator if this event needs updating.'
                  : isLocked
                    ? 'Your coordinator will be in touch if clarification is needed.'
                    : 'You can edit and resubmit this request while it is with you.'}
            </p>
          </footer>
          {canEditPlanning && (
            <EventPlanningDrawer
              isOpen={isPlanningDrawerOpen}
              onClose={() => setIsPlanningDrawerOpen(false)}
              eventId={detail.eventId}
              accessToken={accessToken}
              initialValues={{
                proposed_date: detail.proposedDate,
                expected_attendance: detail.expectedAttendance,
                venue_requirements: detail.venueRequirements,
                equipment_requirements: detail.equipmentRequirements,
                accessibility_needs: detail.accessibilityNeeds,
                registration_needed: detail.registrationNeeded,
                status: detail.status,
              }}
              onSuccess={(updatedEvent) => {
                setDetail({
                  ...detail,
                  status: updatedEvent.status,
                  expectedAttendance: updatedEvent.expected_attendance,
                  proposedDate: updatedEvent.proposed_date,
                  venueRequirements: updatedEvent.venue_requirements,
                  equipmentRequirements: updatedEvent.equipment_requirements,
                  accessibilityNeeds: updatedEvent.accessibility_needs,
                  registrationNeeded: updatedEvent.registration_needed,
                });
                setReloadKey((k) => k + 1);
              }}
            />
          )}
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

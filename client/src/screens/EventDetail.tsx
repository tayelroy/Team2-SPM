import { useEffect, useState } from 'react';
import { fetchOwnEventDetail, type EventRequestDetail } from '../api/eventRequests';
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
}

/** Organisation-scoped request detail. All event content comes from the API. */
export default function EventDetail({
  role,
  onNavigate,
  selectedEventId,
  accessToken,
}: EventDetailProps) {
  const isOrganiser = role === 'Event Organiser';

  const [detail, setDetail] = useState<EventRequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isOrganiser || !selectedEventId || !accessToken) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

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
            {!detail.canManage ? (
              <p role="status" className="organisation-detail-notice">
                View only. This event is shared with your organisation. Only its creator can edit or submit the request.
              </p>
            ) : (
              <>
                {isRejected ? (
                  <div className="organisation-detail-notice">
                    <strong>Request returned for revision</strong>
                    <p>This request was returned by your coordinator. Please review the details, make necessary amendments, and resubmit.</p>
                  </div>
                ) : null}
                {isLocked ? (
                  <p role="status" aria-label="Editing disabled: request submitted" className="organisation-detail-notice">
                    This request has been submitted and is now with your coordinator. Contact your coordinator if an amendment is needed.
                  </p>
                ) : null}
                <div className="organisation-detail-actions">
                  {!isLocked ? (
                    <button className="organisation-button organisation-button-primary" type="button" onClick={() => onNavigate('drafts')}>Edit request</button>
                  ) : null}
                </div>
              </>
            )}
            <p className="organisation-detail-hint">
              {!detail.canManage
                ? 'Contact the request creator if this event needs updating.'
                : isLocked
                  ? 'Your coordinator will be in touch if clarification is needed.'
                  : 'You can edit and resubmit this request while it is with you.'}
            </p>
          </footer>
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

import { useEffect, useState } from 'react';
import { fetchOwnEventRequests, type EventRequestSummary } from '../api/eventRequests';
import { STATUS_FILTERS } from '../mock/data';
import type { Role } from '../mock/types';
import { badgeStyle, eventCards } from '../mock/viewModel';
import { color, radius, surface } from '../theme';
import { Badge, Notice, NoticeMark } from '../ui';

const MOCK_COLUMNS = 'minmax(220px,2.2fr) 1fr 1fr 1fr 40px';
const ORGANISER_COLUMNS =
  'minmax(200px,2fr) minmax(120px,1.2fr) minmax(130px,1.2fr) minmax(110px,1fr) minmax(130px,1.2fr) 40px';

/**
 * Formats an ISO 8601 proposed date into readable '12 Oct 2026' string,
 * or '—' if empty or invalid.
 */
export function formatProposedDate(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export interface EventsTableProps {
  role: Role;
  accessToken?: string;
  onOpenEvent: (eventId?: number) => void;
}

/** Full event list with status filtering. Rows open the detail screen. */
export default function EventsTable({ role, accessToken, onOpenEvent }: EventsTableProps) {
  const [filter, setFilter] = useState('All');
  const [requests, setRequests] = useState<EventRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const isOrganiser = role === 'Event Organiser';

  useEffect(() => {
    if (!isOrganiser || !accessToken) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchOwnEventRequests(accessToken, filter)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setRequests(result.requests);
        } else if (result.kind === 'unauthorized') {
          setError('Your session has expired. Please sign in again.');
        } else if (result.kind === 'unavailable') {
          setError('Event requests are temporarily unavailable. Please try again later.');
        } else {
          setError(result.message || 'Failed to load event requests.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Event requests are temporarily unavailable. Please try again later.');
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
  }, [isOrganiser, accessToken, filter, reloadKey]);

  // For non-organisers, preserve original mock cards display.
  const mockAll = eventCards(role);
  const mockRows = filter === 'All' ? mockAll : mockAll.filter((e) => e.status === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        role="tablist"
        aria-label="Filter events by status"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}
      >
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

      {isOrganiser ? (
        loading ? (
          <div
            role="status"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: color.silver,
              fontSize: '15px',
            }}
          >
            Loading event requests…
          </div>
        ) : error ? (
          <Notice style={{ flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <NoticeMark size={20} />
              <span role="alert" style={{ fontSize: '15px', color: color.platinum }}>
                {error}
              </span>
            </div>
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
          </Notice>
        ) : requests.length === 0 ? (
          <div
            role="status"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: color.silver,
              fontSize: '15px',
              background: surface.sunken,
              borderRadius: radius.card,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {filter === 'All'
              ? 'No event requests found.'
              : `No ${filter.toLowerCase()} events found.`}
          </div>
        ) : (
          <div style={{ background: color.kelp, borderRadius: radius.card, overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: ORGANISER_COLUMNS,
                gap: '16px',
                padding: '18px 28px',
                background: surface.tableHead,
              }}
            >
              {['Event', 'Proposed date', 'Coordinator', 'Status', 'Action', ''].map(
                (heading, i) => (
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
                ),
              )}
            </div>

            {requests.map((event) => {
              const badge = badgeStyle(event.status);
              return (
                <button
                  key={event.eventId}
                  type="button"
                  onClick={() => onOpenEvent(event.eventId)}
                  aria-label={`View ${event.name || 'Untitled event'}`}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'grid',
                    gridTemplateColumns: ORGANISER_COLUMNS,
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
                    <span style={{ fontSize: '17px', color: color.platinum }}>
                      {event.name || 'Untitled event'}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: color.slate,
                      }}
                    >
                      #{event.eventId}
                    </span>
                  </span>
                  <span style={{ fontSize: '14px', color: color.silver }}>
                    {formatProposedDate(event.proposedDate)}
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      color: event.coordinatorName ? color.silver : color.slate,
                    }}
                  >
                    {event.coordinatorName || 'Unassigned'}
                  </span>
                  <span style={{ justifySelf: 'start' }}>
                    <Badge bg={badge.badgeBg} fg={badge.badgeFg}>
                      {event.status}
                    </Badge>
                  </span>
                  <span style={{ justifySelf: 'start' }}>
                    {event.waitingOnMe ? (
                      <Badge bg="rgba(203,255,252,0.16)" fg={color.accent}>
                        Waiting on you
                      </Badge>
                    ) : (
                      <span style={{ fontSize: '13px', color: color.slate }}>
                        With coordinator
                      </span>
                    )}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{ justifySelf: 'end', color: color.platinum, fontSize: '14px' }}
                  >
                    ↗
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div style={{ background: color.kelp, borderRadius: radius.card, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: MOCK_COLUMNS,
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

          {mockRows.map((event) => (
            <button
              key={event.ref}
              type="button"
              onClick={() => onOpenEvent()}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'grid',
                gridTemplateColumns: MOCK_COLUMNS,
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
      )}
    </div>
  );
}

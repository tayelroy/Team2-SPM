import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  getEventHistory,
  type EventAuditLogEntry,
} from '../api/eventRequests';
import { loadSession } from '../auth/session';
import { statusLabel } from '../mock/viewModel';
import { color, radius, rule, surface, label as labelToken } from '../theme';
import {
  Badge,
  GhostButton,
  IconButton,
  Notice,
  NoticeMark,
} from '../ui';

const FIELD_LABELS: Record<string, string> = {
  expected_attendance: 'Expected Attendance',
  proposed_date: 'Proposed Date',
  venue_requirements: 'Venue Requirements',
  equipment_requirements: 'Equipment Requirements',
  accessibility_needs: 'Accessibility Needs',
  registration_needed: 'Registration Needed',
  registration_capacity: 'Registration Capacity',
  registration_opens_at: 'Registration Opens At',
  registration_closes_at: 'Registration Closes At',
  planning_notes: 'Planning Notes',
  arrangements_recheck_needed: 'Arrangements Recheck Needed',
  status: 'Status',
  coordinator_id: 'Coordinator',
  venue_hold_status: 'Tentative Hold Status',
};

/** Formats an ISO string into Singapore Standard Time (SGT). */
export function formatSgtTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Date not available';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Date not available';
  const formatted = new Intl.DateTimeFormat('en-SG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Singapore',
    hour12: false,
  }).format(d);
  return `${formatted} SGT`;
}

/** Humanizes database column names to user-facing labels. */
export function humanizeFieldName(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * The reader-facing form of a recorded value (SG2-100 AC5). Only `status`
 * rows are translated: every other field's values are already free text or
 * numbers, and passing those through `statusLabel` would rewrite anything
 * that happened to collide with a status name.
 */
export function humanizeFieldValue(field: string, value: string | null): string {
  if (value === null) return '(empty)';
  return field === 'status' ? statusLabel(value) : value;
}

export interface EventAuditDrawerProps {
  isOpen?: boolean;
  onClose: () => void;
  eventId: number;
  eventName?: string | null;
  accessToken?: string | null;
}

export function EventAuditDrawer({
  isOpen = false,
  onClose,
  eventId,
  eventName,
  accessToken,
}: EventAuditDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EventAuditLogEntry[]>([]);
  const latestRequestIdRef = useRef(0);

  const fetchHistory = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    const token = accessToken || loadSession()?.accessToken;
    if (!token) {
      setError('You are signed out. Sign in again to view change history.');
      return;
    }

    setLoading(true);
    setError(null);

    const outcome = await getEventHistory(eventId, token).then(
      (result) => ({ failed: false as const, result }),
      () => ({ failed: true as const })
    );

    // A newer fetch (e.g. eventId flipped mid-fetch) has since started; drop this stale response.
    if (latestRequestIdRef.current !== requestId) return;

    if (outcome.failed) {
      setError('Could not reach the server. Please try again.');
    } else if (!outcome.result.ok) {
      setError(outcome.result.message);
    } else {
      setHistory(outcome.result.history);
    }
    setLoading(false);
  }, [eventId, accessToken]);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    } else {
      setError(null);
      setHistory([]);
      setLoading(false);
    }
  }, [isOpen, fetchHistory]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="audit-drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(3px)',
          zIndex: 50,
        }}
      />

      {/* Drawer Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Event Change History"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(580px, 94vw)',
          zIndex: 51,
          background: color.deep,
          borderLeft: rule.edge,
          padding: '32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          overflowY: 'auto',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            borderBottom: rule.faint,
            paddingBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ ...labelToken, color: color.accent }}>Audit Trail</span>
            <h3
              style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: color.platinum,
              }}
            >
              Change History — #{eventId}
            </h3>
            {eventName && (
              <span style={{ fontSize: '13px', color: color.silver }}>{eventName}</span>
            )}
          </div>
          <IconButton label="Close change history" onClick={onClose}>
            ✕
          </IconButton>
        </div>

        {/* Loading State */}
        {loading && (
          <div
            role="status"
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: color.silver,
              fontSize: '14px',
            }}
          >
            Loading change history…
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <Notice
            style={{
              borderColor: 'rgba(255, 138, 128, 0.5)',
              background: 'rgba(255, 138, 128, 0.08)',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <NoticeMark size={20} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span role="alert" style={{ fontSize: '14px', color: '#ff8a80' }}>
                  {error}
                </span>
                <GhostButton
                  onClick={fetchHistory}
                  style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '12px' }}
                >
                  Retry
                </GhostButton>
              </div>
            </div>
          </Notice>
        )}

        {/* Empty State */}
        {!loading && !error && history.length === 0 && (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              color: color.silver,
              fontSize: '14px',
              border: rule.faint,
              borderRadius: radius.sm,
              background: surface.fieldOnAbyss,
            }}
          >
            No change history recorded for this event yet.
          </div>
        )}

        {/* Timeline Entries */}
        {!loading && !error && history.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {history.map((entry) => (
              <div
                key={entry.log_id}
                data-testid={`audit-entry-${entry.log_id}`}
                style={{
                  background: surface.fieldOnAbyss,
                  border: rule.control,
                  borderRadius: radius.sm,
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {/* Meta header: Actor & Timestamp */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ color: color.platinum, fontSize: '13px' }}>
                      {entry.actor_id === null ? 'System' : entry.actor_name}
                    </strong>
                    {(entry.actor_id === null || entry.actor_role) && (
                      <Badge size={10} bg="rgba(94, 234, 212, 0.15)" fg="#5eead4">
                        {entry.actor_id === null ? 'Automatic' : entry.actor_role}
                      </Badge>
                    )}
                  </div>
                  <span style={{ color: color.silver, fontSize: '12px' }}>
                    {formatSgtTimestamp(entry.created_at)}
                  </span>
                </div>

                {/* Field Changed */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: color.accent,
                      fontWeight: 600,
                    }}
                  >
                    {humanizeFieldName(entry.field_name)}
                  </span>
                </div>

                {/* Old vs New Diff */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    padding: '8px 12px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: radius.sm,
                    fontSize: '13px',
                  }}
                >
                  <span
                    data-testid="diff-old"
                    style={{
                      color: '#ff8a80',
                      textDecoration: 'line-through',
                      wordBreak: 'break-word',
                    }}
                  >
                    {humanizeFieldValue(entry.field_name, entry.old_value)}
                  </span>
                  <span style={{ color: color.silver }}>→</span>
                  <span
                    data-testid="diff-new"
                    style={{
                      color: '#a7f3d0',
                      fontWeight: 500,
                      wordBreak: 'break-word',
                    }}
                  >
                    {humanizeFieldValue(entry.field_name, entry.new_value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default EventAuditDrawer;

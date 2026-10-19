import { useEffect, useState } from 'react';
import { getEventStage, type EventStageResult } from '../api/eventRequests';
import { color } from '../theme';
import { Notice, NoticeMark } from '../ui';
import RecheckSettleActions from './RecheckSettleActions';

/**
 * SG2-66 AC4: the assigned coordinator's recheck banner in the work queue.
 * It reads the event's stage for the outstanding rechecks and stays silent
 * while loading, when nothing needs rechecking, or if the read fails.
 */
export default function ArrangementRechecks({ eventId, accessToken, onSettled }: {
  eventId: number;
  accessToken: string;
  /** Called after a recheck was settled, so the screen can re-read the event. */
  onSettled: () => void;
}) {
  const [stage, setStage] = useState<EventStageResult | null>(null);

  useEffect(() => {
    let active = true;
    void getEventStage(eventId, accessToken).then((result) => {
      if (active && result.ok) setStage(result.stage);
    });
    return () => {
      active = false;
    };
  }, [eventId, accessToken]);

  if (!stage?.arrangements_recheck_needed) return null;
  return (
    <Notice
      data-testid="arrangements-recheck-banner"
      style={{ borderColor: 'rgba(255, 180, 0, 0.4)', background: 'rgba(255, 180, 0, 0.08)' }}
    >
      <NoticeMark size={18} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <strong style={{ color: '#fde047', fontSize: '14px' }}>Arrangements need rechecking</strong>
        <span style={{ color: color.mist, fontSize: '13px' }}>
          A change affected these arrangements. Each stays outstanding, and the event cannot be confirmed, until
          you mark it rechecked.
        </span>
        <RecheckSettleActions
          eventId={eventId}
          accessToken={accessToken}
          outstanding={stage.outstanding_arrangements}
          onSettled={onSettled}
        />
      </div>
    </Notice>
  );
}

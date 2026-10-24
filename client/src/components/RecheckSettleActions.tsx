import { useState } from 'react';
import { settleRecheck, type RecheckKey, type SettledRecheck } from '../api/changeRequests';
import { color } from '../theme';
import { GhostButton } from '../ui';

export interface RecheckSettleActionsProps {
  eventId: number;
  accessToken: string;
  /** The event's outstanding arrangements; keys that are not rechecks get no button. */
  outstanding: string[];
  /** Called after the server settled a recheck, so the screen can re-read the event. */
  onSettled: (settled: SettledRecheck) => void;
}

const SETTLE_LABELS: Record<RecheckKey, string> = {
  venue_recheck: 'Mark venue rechecked',
  equipment_recheck: 'Mark equipment rechecked',
  registration_recheck: 'Mark registrations rechecked',
  // SG2-93 AC4: venue and equipment settle once staff confirm them again; other on the coordinator's word.
  safety_venue_recheck: 'Mark venue safety changes done',
  safety_equipment_recheck: 'Mark equipment safety changes done',
  safety_other_recheck: 'Mark other safety changes done',
};

/**
 * SG2-66 AC4: the assigned coordinator settles each outstanding recheck in
 * turn. The server re-checks the arrangement first; a refusal lists what
 * still blocks it. One settle runs at a time.
 */
export default function RecheckSettleActions({ eventId, accessToken, outstanding, onSettled }: RecheckSettleActionsProps) {
  const [settlingKey, setSettlingKey] = useState<RecheckKey | null>(null);
  const [failure, setFailure] = useState<{ message: string; blockers: string[] } | null>(null);

  const settle = async (key: RecheckKey) => {
    setSettlingKey(key);
    setFailure(null);
    const result = await settleRecheck(eventId, key, accessToken);
    setSettlingKey(null);
    if (result.ok) onSettled(result.settled);
    else setFailure({ message: result.message, blockers: result.kind === 'blocked' ? result.blockers : [] });
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
        {outstanding
          .filter((key): key is RecheckKey => key in SETTLE_LABELS)
          .map((key) => (
            <GhostButton
              key={key}
              onClick={() => void settle(key)}
              disabled={settlingKey !== null}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              {SETTLE_LABELS[key]}
            </GhostButton>
          ))}
      </div>
      {failure && (
        <div
          role="alert"
          data-testid={failure.blockers.length > 0 ? 'recheck-blockers' : 'recheck-error'}
          style={{ display: 'grid', gap: '4px', marginTop: '6px', color: color.platinum, fontSize: '13px' }}
        >
          <strong>{failure.message}</strong>
          {failure.blockers.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {failure.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

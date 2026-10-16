import { useEffect, useState } from 'react';
import { getEventArrangements, type EventArrangementsResult } from '../api/eventRequests';
import EventArrangementsPanel from './EventArrangementsPanel';

/**
 * Loads an event's arrangement readiness for the assigned coordinator and shows
 * it as a panel (SG2-57). It stays silent while loading or if the read fails —
 * the readiness view is informational and must not crowd out the rest of the
 * event detail when the service is briefly unavailable.
 */
export default function EventArrangements({
  eventId,
  accessToken = null,
  confirmed = false
}: {
  eventId: number;
  accessToken?: string | null;
  /** SG2-58: once confirmed, the panel says so rather than "Ready for confirmation". */
  confirmed?: boolean;
}) {
  const [arrangements, setArrangements] = useState<EventArrangementsResult | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    setArrangements(null);
    void getEventArrangements(eventId, accessToken).then((result) => {
      if (active && result.ok) setArrangements(result.arrangements);
    });
    return () => {
      active = false;
    };
  }, [eventId, accessToken]);

  if (!arrangements) return null;
  // Inset like the rest of the event card, so the panel's own border does not
  // sit on top of the card's edge.
  return (
    <div className="organisation-detail-panel">
      <EventArrangementsPanel arrangements={arrangements} confirmed={confirmed} />
    </div>
  );
}

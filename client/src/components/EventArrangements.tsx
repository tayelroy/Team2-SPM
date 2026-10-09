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
  accessToken = null
}: {
  eventId: number;
  accessToken?: string | null;
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
  return <EventArrangementsPanel arrangements={arrangements} style={{ marginTop: '24px' }} />;
}

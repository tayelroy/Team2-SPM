import { useEffect, useState } from 'react';
import { getEventArrangements, type EventArrangementsResult } from '../api/eventRequests';
import EventArrangementsPanel from './EventArrangementsPanel';

/**
 * Loads an event's arrangement readiness for the assigned coordinator and shows
 * it as a panel (SG2-57). It stays silent while loading or if the read fails —
 * the readiness view is informational and must not crowd out the rest of the
 * event detail when the service is briefly unavailable. `onLoaded` hands the
 * same reading to the surrounding detail (e.g. whether a venue is requested).
 */
export default function EventArrangements({
  eventId,
  accessToken = null,
  onLoaded
}: {
  eventId: number;
  accessToken?: string | null;
  onLoaded?: (arrangements: EventArrangementsResult) => void;
}) {
  const [arrangements, setArrangements] = useState<EventArrangementsResult | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    setArrangements(null);
    void getEventArrangements(eventId, accessToken).then((result) => {
      if (active && result.ok) {
        setArrangements(result.arrangements);
        onLoaded?.(result.arrangements);
      }
    });
    return () => {
      active = false;
    };
    // onLoaded is a notification, not an input: a new callback identity must
    // not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, accessToken]);

  if (!arrangements) return null;
  return <EventArrangementsPanel arrangements={arrangements} style={{ marginTop: '24px' }} />;
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A period a venue was marked unavailable that affects a confirmed booking
 * (SG2-80 flags it, SG2-81 shows it to the event's coordinator). The reason
 * is the category the Venue Staff chose and their note.
 */
export interface BookingDisruption {
  starts_at: string;
  ends_at: string;
  category: string;
  reason: string;
}

interface DisruptionRow {
  booking_id: number;
  venue_unavailability: BookingDisruption | BookingDisruption[] | null;
}

type Failed = (error: unknown) => void;

/**
 * Which of the given bookings a venue's unavailability affects (SG2-80 flags,
 * read with the service role). Used by event readiness: an affected booking
 * leaves the venue arrangement outstanding (SG2-81 AC2).
 */
export async function fetchAffectedBookingIds(admin: SupabaseClient, bookingIds: number[]):
  Promise<{ ok: true; ids: Set<number> } | { ok: false; message: string }> {
  if (bookingIds.length === 0) return { ok: true, ids: new Set() };
  const { data, error } = await admin.from('venue_booking_disruptions').select('booking_id').in('booking_id', bookingIds);
  if (error) return { ok: false, message: error.message };
  return { ok: true, ids: new Set((data as { booking_id: number }[]).map(row => Number(row.booking_id))) };
}

/** The unavailable periods affecting each booking, earliest first (SG2-81 AC1). */
export async function fetchDisruptions(admin: SupabaseClient, bookingIds: number[], failed: Failed): Promise<Map<number, BookingDisruption[]>> {
  const found = new Map<number, BookingDisruption[]>();
  if (bookingIds.length === 0) return found;
  const { data, error } = await admin.from('venue_booking_disruptions')
    .select('booking_id,venue_unavailability(starts_at,ends_at,category,reason)').in('booking_id', bookingIds);
  if (error) failed(error);
  for (const row of data as DisruptionRow[]) {
    const periods = [row.venue_unavailability ?? []].flat();
    found.set(Number(row.booking_id), [...(found.get(Number(row.booking_id)) ?? []), ...periods]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
  }
  return found;
}

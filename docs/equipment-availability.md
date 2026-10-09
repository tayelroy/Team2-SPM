# SG2-54 — Check equipment availability

Technical Support Staff can open an equipment request in the work queue and
check the stock for its dates. The check shows the quantity held, the peak
quantity committed to other events, the quantity remaining and the calculated
shortfall. Maintenance and damaged equipment contribute no available stock.
Checks remain available when the event is confirmed, even though arrangement
editing has closed.

## Dates and commitments

The default period uses the equipment request's recorded dates. When those
are absent, it uses the first start and last end of the event's confirmed venue
bookings. If neither supplies a complete period, the form shows the proposed
event start and asks for an end. Technical Support can also choose another
complete period. Inputs and displayed dates explicitly use Singapore time.
No event duration is invented.

Only actual `equipment_reservations` commit stock. Equipment requirements,
pending requests and arrangement notes do not reserve anything. Reservations
for the current event are excluded because the check measures stock available
to that event, including equipment it has already secured. Reservations for
completed, cancelled or rejected events do not consume stock.

Each reservation uses its explicit period, or the envelope of its event's
confirmed venue bookings. A legacy reservation without either period is
conservatively counted throughout the selected dates, and the interface states
how many such reservations it included. The booking envelope includes gaps
between bookings. A recorded reservation period avoids that conservative
envelope when the actual equipment use is shorter.

Intervals are half open: a reservation ending when another begins does not
overlap it. The calculation groups arrivals and departures at each instant and
uses the highest simultaneous quantity. Two consecutive reservations of eight
and six consume a peak of eight; they consume fourteen while their periods
overlap. Arithmetic uses PostgreSQL bigint so totals can exceed an individual
integer quantity without overflowing.

For operational equipment, remaining stock is the held quantity minus that
peak, clamped at zero. For damaged or maintenance equipment, remaining stock
is zero. The shortfall is the requested quantity minus the remaining stock,
also clamped at zero. The original held quantity remains visible for reference.

## API and database

`GET /api/equipment-requests/:requestId/availability?event_id=<id>` returns a
read-only check. Optional `starts_at` and `ends_at` must both be supplied as
valid zoned ISO timestamps with the end after the start. Invalid identifiers,
repeated parameters, partial periods and impossible calendar dates return 400.
Missing requests return 404. An absent complete default period returns 200
with `status: "dates_required"`; it never returns a fabricated available count.

The route requires `equipment.availability.read`, granted only to Technical
Support Staff. It forwards the caller's JWT to
`check_equipment_availability(integer,bigint,timestamptz,timestamptz)`, which
independently checks the current stored role. The function uses an empty search
path, denies anonymous execution and adds no ordinary reservation table access.
The stable function reads one PostgreSQL statement snapshot and changes no
requests, arrangements, equipment or reservations.

Apply `supabase/migrations/202610120001_equipment_availability.sql` after the
existing migrations before using this feature against hosted Supabase. It adds
nullable reservation start/end columns, a paired finite period constraint, an
equipment/event index and the guarded RPC. Legacy undated rows retain their
contents. No new environment variables, paid services or plan changes are
required. Hosted application verification remains separate from local fixtures
and the automatic Vercel preview build.

## Verification

Tests exercise exported API adapters, HTTP routes, rendered workflows and the
actual SQL RPC. All four DoD categories have concrete assertions. The SQL suite
checks peak overlap, adjacent and one-microsecond boundaries, date precedence,
legacy booking fallback, undated commitments, own and terminal exclusions,
large totals, non-operational stock, shortfall, role denial and unchanged rows.

Five browser journeys in `e2e/equipment-availability.spec.ts` cover the complete
support check, all three stock statuses, missing dates at 390px, selected date
boundaries, refresh after a changed reservation, confirmed events and recovery
from a failed check. The desktop journey verifies 1440px. Both widths assert no
horizontal overflow. Browser storage is disposable; PostgreSQL tests establish
the real database behavior separately.

`docs/test-case-inventory.json` maps every current leaf declaration and SQL
sentinel to its category and acceptance criterion. `docs/regression-cases.json`
records the five SG2-54 journeys. Detailed current execution evidence and the
complete changed-test inventory are recorded in the PR and shared test register.
Independent teammate sign-off must be completed before merge.

The displayed check time identifies an advisory snapshot. Refreshing reruns
the check, and a failed refresh removes the previous calculation. A check does
not reserve equipment, promise future availability or overwrite the shortfall
manually recorded under SG2-53. SG2-55 will provide the reservation workflow.

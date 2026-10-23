# Registrations (SG2-63, SG2-60)

The registration picture for an event, and the Event Organiser's control of
its registration settings (SG2-63), and attendees registering (SG2-60, see
[Registering](#registering-sg2-60)). Being refused when full and withdrawing
are SG2-61 and SG2-62; they write the same `public.registrations` rows.

## Who sees what

| Who | Sees the picture | Contact details | Changes the settings |
| --- | --- | --- | --- |
| The organiser who created the event | Yes | Yes | Yes |
| Another organiser in the same organisation (SG2-26) | Yes | No | No |
| The assigned Event Coordinator | Yes | Yes | No (replaces SG2-39 AC4) |
| Anyone else | 404 | — | — |

AC4 says contact details go only to users authorised to see them. The people
running the event, its creator and its coordinator, are authorised;
organisation colleagues see names only. This reading is flagged to the PO.

The picture is shown on the event detail (organisers and the assigned
coordinator) and in the coordinator's work queue pane, for events that need
registration and are past Draft.

## The picture (AC1, AC2, AC7)

- **Registered** counts every registration that is not cancelled, the same rule
  SG2-66's change impact uses. **Places remaining** is capacity minus that count,
  never below zero, or "No capacity set".
- Where registration stands uses SG2-58's window: registration is open only for
  a Confirmed event, from its opening time until its closing time.
- Each attendee is listed earliest first with name, organisation and when they
  registered, plus email and phone for those allowed to see them. Only an
  email-shaped address is made a `mailto:` link; anything else is shown as text.
- A capacity above a booked venue's capacity (any pending or approved booking
  request) is allowed. A warning names each venue it exceeds, as the organiser
  types and after saving.

## The settings (AC5, AC6, AC8, AC9)

The creating organiser sets capacity and opening and closing times (Singapore
time) at any time before the event starts, in any status but Completed,
Cancelled or Rejected, including once it is Confirmed.

- **Close early:** *Close registration now* sets the closing time to now. It is
  offered only while registration is open.
- **Reopen or extend:** save a later closing time. A new closing time must be in
  the future.
- Registration closes after it opens, and both times are before the event starts.
- Once the event is Confirmed, capacity and times can be changed but not cleared:
  clearing one would end registration with no notice and undo what confirmation
  needed (SG2-57). *Close registration now* is the way to stop it. Before
  confirmation they can still be cleared.
- Capacity can come down to the number already registered, but not below it:
  `2 people are already registered, so the capacity cannot be lower than 2.` No
  story says who would lose their place (SG2-61 AC4 only speaks of raising it), so
  this is refused rather than warned. The form, the server and the database
  function (under the event row lock) all check it. This reading is flagged to the PO.
- Only what changed is sent. Each changed setting adds one history row with the
  organiser's name and the time (SG2-40's history shows it).
- The coordinator's planning drawer shows the settings read-only. The planning
  route refuses them with 403.

## Notices (AC10)

When a Confirmed event's registration opens or closes, the organiser and the
assigned coordinator each get one notice (see [Notifications](notifications.md)):
`Registration for <Event> is now open.`, `Registration for <Event> has closed.`
or, when the organiser closes it, `… was closed early by the organiser.`

`events.registration_announced` remembers what was last announced, so nothing
is sent twice. Changes the organiser makes announce at once. Scheduled times
are caught by `public.process_registration_windows()`, which pg_cron runs every
minute on Supabase. Plain PostgreSQL in CI lacks pg_cron and calls the function
directly in its database suite. Events that are not Confirmed announce nothing:
registration is not open to attendees until then.

## Where it lives

- Migration `supabase/migrations/202610200004_event_registration_settings.sql`:
  `update_registration_settings`, `event_registration_overview`,
  `announce_registration_window`, `process_registration_windows`, the two
  notice kinds, `registrations.registered_at` and `events.registration_announced`.
  Apply it on hosted Supabase before or with the release.
- Server: `server/src/events/registrationRoutes.ts`,
  `server/src/events/registrationSettings.ts`, `server/src/db/registrations.ts`.
- Client: `client/src/components/RegistrationPanel.tsx`,
  `client/src/api/registrations.ts`.
- Tests: `supabase/tests/event_registration_settings.sql`,
  `server/src/registrationRoutes.test.ts`, `e2e/registrations.spec.ts` and the
  SG2-63 integration test in `integration/api.test.ts`.

## Registering (SG2-60)

An attendee registers from an open event's details on **Find events**
(SG2-59). `POST /api/registrable-events/:eventId/registrations` runs
`public.register_for_event()` with the attendee's own JWT; it rechecks that
the acting role is `attendee` (`lock_acting_role()`, SG2-104).

| Check, in order | Answer |
| --- | --- |
| Contact phone missing or not a Singapore number (8 digits, optional `+65`, separators ignored, at most 40 characters); needs over 500 characters (AC4) | 400, before the database is asked; the database checks again |
| Not an event an attendee may find: not confirmed, no registration, times or date unset, missing | 404, as SG2-59's detail |
| The attendee already holds an active registration (AC2) | 409 `duplicate` |
| At or after the closing time, or the event has started (AC3) | 409 `closed` |
| Before the opening time (AC3) | 409 `not_open`, with the opening time |
| Every place is taken (AC1) | 409 `full` |
| Otherwise | 201: the place is held |

- **Team decision (23 Oct 2026), AC4's "required registration information":**
  a contact phone is required, filled in from the attendee's profile; any
  accessibility or dietary needs are optional. Name and email come from the
  account. Both are stored on the registration (`contact_phone`, `needs`).
- **Capacity** is the one the organiser set (SG2-63); a cancelled registration
  holds no place. The function locks the event row before it checks anything,
  the same lock SG2-63's settings changes take, so two attempts on the last
  place are decided one at a time
  (`.github/scripts/test-registration-concurrency.mjs`). SG2-61 adds the full
  badge, the capacity-reached notices and the waiting list.
- **One active registration per attendee per event:** checked by the function
  and backed by the partial unique index `registrations_one_active_per_attendee`.
  After a withdrawal (SG2-62) the attendee may register again.
- **Confirmation (AC1):** the screen shows the place held with the date, time
  and venue, and the attendee is sent a `registration_confirmed` notice
  ("You are registered for Harbour Lecture on 20 Jul 2030 19:00 SGT at
  Regression Hall."). An event already registered for shows that instead of
  the form, and the list marks it **Registered**.
- **The organiser's picture** shows the phone given at registration (the
  profile phone for earlier registrations) and the needs, to the same people
  who see contact details.

Migration `202610230001_event_registration.sql`; tests
`supabase/tests/event_registration.sql`, the concurrency script above,
`server/src/registerForEvent.test.ts`,
`client/src/screens/FindEvents.registration.test.tsx`, integration
`native registration holds one place per attendee…` and browser journeys
`SG2-60-P01` and `SG2-60-N01`.

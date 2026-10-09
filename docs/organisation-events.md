# Organisation event access (SG2-26)

Event Organisers see the events belonging to their client organisation, including
events created by colleagues. The organisation is read from the signed-in user's
database profile on each request. A client-supplied organisation, user ID or
cached browser value cannot select the organisation to read.

## Behaviour

- `GET /api/event-requests` lists events with the exact same nonblank
  `organisation` value as the caller's `public.users` row. Status filters retain
  that boundary. `scope=mine` further restricts the list to the creator and is
  combined with `status=draft` by **My drafts**. Non-draft requests stay in
  **My events**; they are not shown in the draft list or its count.
- `GET /api/event-requests/:eventId` applies the same organisation boundary.
  Unrelated and nonexistent events both return 404. Missing, null or blank
  membership returns an empty list and 404 for details.
- Read responses include `can_manage`. It is true only for the event's creator.
  Colleagues can read, but the existing creator checks still protect editing,
  submission and deletion on the server. Those operations also recheck current
  membership, so moving an account to another organisation removes access to its
  former organisation’s events. Creation without membership is refused with 403.
- The organiser dashboard and event detail use actual API data. A missing
  selection never falls back to a fictional event from another company.
- Only Event Organisers can access the event list and detail UI or API.
  Coordinators, venue staff, technical support and attendees receive 403 from
  these endpoints. Coordinator assignment and review remain separate stories.

## Event status lifecycle (SG2-100)

An event moves through a 7-step stepper, shown on the event detail screen
alongside a plain-language stage and a "waiting on" card naming the persona
and action that moves it forward:

1. **Draft** — the organiser is still completing the request.
2. **Awaiting Assignment** (`unassigned`) — submitted with no coordinator yet;
   the Event Coordinator Lead assigns one. A fresh draft's submission lands
   here, not in `submitted`, which gives the Lead's assignment queue an
   indexable predicate instead of a `status = 'submitted' and coordinator_id
   is null` sniff. A request that already has a coordinator (resubmitted
   after a clarification question or a rejection) goes straight back to
   `submitted` instead — see step 3.
3. **Under Review** — covers both `submitted` (assigned, not yet opened) and
   `under_review` (the coordinator has opened it); `submitted` has no step of
   its own. `needs_clarification` also sits at this step while the organiser
   answers the coordinator's question and resubmits — which lands back in
   `submitted`, preserving the coordinator's hold on the request, not in
   `unassigned`.
4. **Arrangements** (`approved`/`planning`, `stage_key: 'in_planning'`) — the
   coordinator arranges the venue and equipment.
5. **Safety Check** (`awaiting_safety_check`) — the Safety Officer completes
   the operational safety check; `safety_rejected` is a stop at this step with
   no waiting-on card, not a recoverable state.
6. **Preparation** (`preparation`) — arrangements and the safety check are
   done; the event is being readied.
7. **Confirmed** (`confirmed`) — ready to be held. Once its end time has
   passed — derived from `max(venue_bookings.ends_at)` over its confirmed
   bookings, since `public.events` has no end-time column of its own — the
   assigned coordinator marks it **Completed**, which records who and when
   and removes it from the active work queue.

   The coordinator does this from their **Work Queue**: opening the event
   under **My assigned events** shows a **Mark as Completed** step once the
   event's end time has passed, and the event leaves the queue when it is
   done. The queue's event items carry that end time as `ends_at`
   (`internal_work_items`), so the button is only offered once it applies;
   the server re-checks ownership, status and the end time on every call.

`cancelled` and `rejected` are terminal off-stepper outcomes, same as
`completed`. The legal transition table enforcing which of these moves are
allowed lives in `server/src/events/fields.ts` (`STATUS_TRANSITIONS`,
`canTransition`).

## Who an event is waiting on (SG2-38, SG2-31)

The dashboard cards and the **Action** column of **My events** use one helper,
`eventActionLabel` in `client/src/mock/viewModel.ts`, so both screens say the
same thing. It follows the stage API's waiting-on persona
(`server/src/events/stageCalculator.ts`) from the request's status and
coordinator:

| Request | Action text |
| --- | --- |
| A colleague's event (`can_manage` false) | View only |
| Waiting on its creator (`draft`, `needs_clarification`, `rejected`) | Waiting on you |
| `confirmed`, `completed`, `cancelled`, `rejected`, `safety_rejected` | No action needed |
| `awaiting_safety_check` | With safety officer |
| `unassigned`, or any other active status with no coordinator | Awaiting coordinator assignment |
| Any other active status with a coordinator | With coordinator |

On the detail screen, a request its creator can no longer edit explains where
it is (`lockedRequestNotice`, same module) — awaiting assignment, with the
coordinator for review, being arranged, at the safety check, in preparation,
confirmed, completed or cancelled — instead of always saying it was just
submitted to a coordinator.

A colleague's view-only detail does not show **View Change History** or the
stage tracker, and does not request `GET /:eventId/stage` or
`GET /:eventId/history`: the server refuses both to any organiser other than
the event's creator, so asking would only return 403. The stage is requested
only after the detail confirms the viewer is the creator or a coordinator.

On a phone the seven steps are wider than the stepper track, which scrolls on
its own. The track scrolls its current step to its centre on render and on
every window resize — by setting the track's `scrollLeft`, never by scrolling
the page — fades out whichever end hides more steps, and shows
"Swipe sideways to see all 7 steps." while any step is out of view.

## Provisioning and rollout

Apply the SG2-26 migration in `supabase/migrations` alongside the application
release. It protects event reads with row-level security and prevents direct
client writes to event records and user membership. The server's service role
continues to perform validated operations. Do not expose that key in the browser.

The existing schema uses organisation text as its membership identifier. An
administrator must assign exactly matching, nonblank values to colleague
accounts and their organisation's events. Different spellings, case or whitespace
are not merged automatically. Do not reuse an organisation value for unrelated
clients. Existing null memberships and events are deliberately not inferred or
backfilled: review and provision them explicitly before expecting shared access.

## Verification

Backend tests cover organisation scoping and unavailable membership lookups.
The browser cases `SG2-26-P01` and `SG2-26-N01` exercise colleague visibility,
read-only details, owner-only drafts, unrelated direct reads and an unassigned
account through the real application with isolated test providers.
`SG2-26-P02` also checks that a colleague's detail makes no stage or history
request, and `SG2-100-P01` checks the **My events** action text, the locked
notice and the phone stepper position as a request moves through its stages.
Database policy tests separately verify the Postgres boundary; the in-memory browser
fixture does not emulate row-level security.

SG2-26 is organisation isolation. The older regression register incorrectly
associated the logout case `PW-AUTH-03` with this ticket; logout remains covered
as a separate authentication regression.

The local checkout needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in `server/.env` to use the real database. Production
reads use Supabase; test preview records belong exclusively to the isolated
browser test provider. No mock record fallback is used by the organiser view.

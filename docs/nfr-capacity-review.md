# Non-functional checks and year-3 capacity review (SG2-96)

Evidence recorded on 26 Oct 2026 against main b7e2b1a plus the SG2-96 working tree. The customer left performance benchmarks to the team (SG2-96), so the targets below are the team's. The capacity measurements are from the original local Linux run; the later macOS regression and signed-in staging checks are recorded separately below. A final commit and its hosted CI run remain required for release evidence.

| Requirement (Week 1 brief §8) | Team target | Result |
|---|---|---|
| Performance: common operations complete within a reasonable time | View an event, search venues, open a venue calendar, check equipment and register within **2 s** | **API evidence only.** Recorded single-user endpoint p95 values were at most 64 ms at year-3 volume and 129 ms at twice that. Browser-to-visible-result timing remains to be measured; registration submission is not implemented (SG2-60). |
| Scalability: three years of growth | Year-3 data volumes and peak concurrent users below stay within the 2 s target | **Documented capacity review completed.** The local API workload recorded p95 78 ms and no errors at the assumed year-3 peak. This is not a hosted capacity result; twice the users produced some actions above 2 s. |
| Usability: every role completes its common activities without training | An unaided participant completes each role's main task; pages fit supported screen widths | **Human acceptance pending.** Automated task coverage passes. After the header fix, the branch passed 172 page views across seven roles and all three multi-role combinations at 320–1440 px, with no overflow. Deployed staging still needs the fixed commit and a retest. |
| Maintainability: processes evolve | The design notes show how to add a role or a status | **Documented.** See [`design/c4-notes.md`](design/c4-notes.md#extensibility-adding-a-role-or-a-status-sg2-96-nfr). |

## Year-3 assumptions

The brief gives one figure: about 500 staff today, and growth in "events, users, client organisations, venues, equipment, and registrations" over three years. The rest are team assumptions, sized generously. Volumes are cumulative after three years, because nothing is archived.

| Data | Year 3 | Basis |
|---|---|---|
| Staff accounts | 800 (300 coordinators, 200 venue staff, 250 technical support, 20 Leads, 30 Safety Officers) | 500 today, about 17% growth a year |
| Client organisations / organiser accounts | 600 / 1,500 | about 2.5 organisers per client |
| Attendee accounts | 60,000 | |
| Venues / equipment items | 40 / 1,000 | "several" facilities today, doubling |
| Events | 9,500 over three years (about 3,200 a year) | 2–5 of the catalogue's venues booked on a typical day |
| Venue booking requests and bookings | about 10,000 each | a quarter of events use two venues (SG2-82) |
| Equipment requests / reservations | 24,000 / 23,000 | three items per event |
| Registrations | 529,000 | 70% of events take registration, filled to about 90% |
| Event history / notifications | 223,000 / 179,000 | 25 history rows and 20 notices per event |

**Peak concurrent users: 575.** That is a quarter of the staff (200), 5% of organisers (75) and 300 attendees arriving when a popular event's registration opens. Each active person does something about every 10 seconds, about 58 requests a second in total. The head-room check doubles both the data and the users.

## Method

- [`integration/capacity-seed.sql`](../integration/capacity-seed.sql) loads the volumes above into a disposable local PostgreSQL 16 with every migration (`-v scale=1`; `scale=2` doubles it).
- [`integration/capacity-check.ts`](../integration/capacity-check.ts) runs the real Express app and production database adapters through PostgREST 12.2.12, signed in as each role.
- These timings measure HTTP request through response consumption, not a browser click through a usable rendered result. Single-user timing: each endpoint 3 warm-ups then 30 samples. Load: virtual users repeat the mixed actions, waiting 0–20 s (mean 10 s) between them; the stress runs wait 0 s.
- Everything ran on one 2-vCPU workspace: app, PostgREST, PostgreSQL and the load generator together. Hosted figures add network time between the browser, Vercel and Supabase, so they will be higher; Vercel also runs several API instances at once where this test had one.
- Never run the seed against Supabase. It writes tens of thousands of rows with triggers off.

## Results

### Single user, year-3 volume (ms)

| API operation | p50 before | p95 before | p50 after | p95 after |
|---|---|---|---|---|
| View an event: organiser detail | 12 | 15 | 12 | 16 |
| View an event: coordinator stage / confirmation / arrangements | 10 / 17 / 28 | 14 / 21 / 34 | 8 / 15 / 23 | 16 / 19 / 29 |
| Search available venues | 15 | 22 | 12 | 18 |
| Open a venue calendar: all venues, one month / one venue | 15 / 10 | 24 / 14 | 14 / 8 | 21 / 18 |
| Check equipment availability | 11 | 13 | 6 | 18 |
| Browse events open to an attendee | **227** | **267** | 19 | 25 |
| Event search | 45 | 56 | 43 | 64 |
| Safety check queue | **462** | **592** | 30 | 48 |
| Lead queue / oversight, work queue, inbox, history | ≤ 15 | ≤ 22 | ≤ 14 | ≤ 23 |
| Raise an event request (write) | 10 | 16 | 10 | 11 |

"Before" is main b7e2b1a; "after" adds the index migration below. Submitting a registration is not built yet (SG2-60). The attendee list and event-page reads measure browsing only and do not satisfy the registration-action target.

### Concurrent users (after the fixes)

| Run | Data | Users | Requests/s | p50 | p95 | Slowest action p95 | Errors |
|---|---|---|---|---|---|---|---|
| Year-3 peak | year 3 | 575, 10 s think | 58 | 20 ms | **78 ms** | 115 ms (event search) | 0 |
| Twice the users | year 3 | 1,150, 10 s think | 114 | 103 ms | 1,121 ms | 2,810 ms (inbox) | 0 |
| Twice the data | 2× year 3 | 575, 10 s think | 59 | 33 ms | **199 ms** | 465 ms (arrangements) | 0 |
| Stress, before indexes | year 3 | 50, no think | 40 | 1,005 ms | 3,355 ms | 4,370 ms | 0 |
| Stress, after indexes | year 3 | 50, no think | 130 | 345 ms | 751 ms | 997 ms | 0 |
| Stress, after indexes | year 3 | 200, no think | 141 | 787 ms | 4,041 ms | 19,411 ms | 0 |

This single local instance saturates at about 130–140 requests a second, more than twice the year-3 peak. Twice the peak still answers 95% of requests within 1.2 s, though its slowest actions pass 2 s. The no-think stress runs are deliberately past saturation and show queueing, not expected use.

### Single user, twice the year-3 data (ms, after the fixes)

Every action stays under 130 ms at p95: event search 129, Lead queue 48, safety queue 63, attendee list 59, all-venue calendar 28.

## What the review found and changed

1. **Per-event lookups had no index** on `venue_bookings`, `venue_booking_requests`, `equipment_requests` and `equipment_reservations`. Only partial (pending-only) or venue-first indexes existed, so every event in a list scanned the whole table. The safety check queue took 462 ms and the attendee event list 227 ms for one user. Under load, the database was the bottleneck at 40 requests a second.
   - Fix: [`202610260002_event_lookup_indexes.sql`](../supabase/migrations/202610260002_event_lookup_indexes.sql). The release gate now checks the four indexes exist.
   - Effect: those two reads dropped to 30 ms and 19 ms, and stress throughput rose from 40 to 130 requests a second.
   - Included as a branch migration file. It has not been applied to any shared database during this validation.
2. **The coordinator list put every coordinator id into one URL.** At 600 coordinators the Lead's unassigned queue answered 503, and so would the assignable list and the oversight page, which share the query.
   - Fix: `listCoordinators` asks in batches of 100 ids (`server/src/db/accountRoles.ts`, with unit tests).
   - Effect: at twice the year-3 volume, the Lead's queue now loads in 25 ms.
3. **Four screens scrolled sideways on a 320 px phone**: the organiser's new-request form, and the attendee's registrations and event pages. A grid column had a fixed minimum (300–320 px) wider than the screen.
   - Fix: the grids use `minmax(min(100%, …), 1fr)`, as the rest of the app already did.
   - New browser case: SG2-71-B01 (`e2e/small-phone.spec.ts`) visits every page of every role at 320 px.

## Automated task coverage and visual inspection

The original local inspection used the production build with the browser test fixture's single-role accounts. Each of the seven roles opened every page in its navigation at 320, 375, 768 and 1440 px: 140 screenshots, no console errors, and after fix 3 no sideways scrolling. Contact sheets of every role at phone size, and a sample at tablet and desktop, were also checked by eye. One thing they showed: the attendee's My registrations and Event page still display the prototype's sample data (J. Halloran, Northbridge Investor Forum, a Withdraw button) until SG2-60/62 are built. The subsequent staging inspection below covered real-data layouts and multi-role accounts and found additional defects.

The macOS baseline passed all 159 browser cases in 187.7 s; the final full rerun after the header and regression fixes passed all 159 in **186.5 s**, including the expanded SG2-71-B01 and the full Week 7 journey. The cases below exercise the implemented main tasks. Scripted navigation does not establish that a person can discover and complete a task without guidance.

| Role | Main task | Case |
|---|---|---|
| Event Organiser | Raise and submit a request | SG2-28-P01 |
| Event Coordinator Lead | Assign or reassign a coordinator | SG2-88-P01 |
| Event Coordinator | Review and approve; confirm a ready event | SG2-37-P01, SG2-58-P01 |
| Venue Staff | Decide a venue booking request | SG2-49-P01 |
| Technical Support Staff | Reserve equipment | SG2-55-P01 |
| Safety Officer | Review and decide a safety check | SG2-91-P01, SG2-92-P01 |
| Attendee | Find an event open for registration | SG2-59-P01 |

The whole Week 7 journey (submit, Lead assigns, venue and equipment confirmed, safety check, Preparation, Confirmed) also runs as one browser case, SG2-96-E2E01 (`e2e/week7-journey.spec.ts`), through six people's screens. Against PostgreSQL itself it runs as SG2-96-INT01, where the database's own triggers start the safety check.

### Local remediation verification

After fixing the multi-role header, the production build passed the stricter local walkthrough: **172 page views**, six fixture accounts covering all seven roles, all three multi-role combinations, and 320/375/768/1440 px widths. No overflow, console/page or readiness failures were recorded. The expanded SG2-71-B01 checks both held roles and verifies that the selector, Profile menu and Notifications remain usable at 320/375 px. Manual inspection confirmed the 320 px layout; see [`regression-evidence-2026-10-26.md`](regression-evidence-2026-10-26.md#verification-after-remediation).

The walkthrough now waits for role permissions and representative navigation, and reports loading timeouts or error pages as failures. Its navigation timings remain diagnostic, even when under 2 s; they are not the 30-sample deployed browser benchmark below. These are local branch results, not a passing retest of the unchanged staging deployment or an unaided participant result.

## Unaided walkthrough protocol — pending

Use the staging demo accounts and disposable test records with a participant unfamiliar with the screen being assessed. Give the participant only the goal below and its starting data, with no navigation instructions or demonstration. Observe silently; record any assistance as a failed unaided attempt. Do not count an automated run as a participant result.

| Role | Goal given to the participant | Completion evidence | Result |
|---|---|---|---|
| Event Organiser | Create and submit a complete event request from the supplied brief | Request is submitted and shows its next responsible role | Pending |
| Event Coordinator Lead | Assign the supplied unassigned request to the named coordinator | Request leaves the unassigned queue and shows that coordinator | Pending |
| Event Coordinator | Review and approve the supplied request, then confirm the separate event whose arrangements and safety approval are ready | Approval and confirmation are visible with the correct stages | Pending |
| Venue Staff | Review and approve the supplied suitable venue request | Booking is confirmed and the request shows the decision | Pending |
| Technical Support Staff | Arrange and reserve the supplied equipment requirement | Placement, quantity and reservation are visible | Pending |
| Safety Officer | Review the supplied event's venues and equipment and record approval | Event moves to Preparation and the decision is visible | Pending |
| Attendee | Find the supplied event that is open for registration and inspect its details | Correct event and registration availability are identified | Pending; registration submission remains outside implemented scope (SG2-60) |

For each attempt record participant code, date, tested commit/deployment, role, device/viewport, starting record, success or failure, elapsed time, assistance, errors and observations. Accept the usability target only when every implemented main task succeeds without assistance. Record the absent registration task as an outstanding scope dependency rather than an achieved result.

## Browser response-time protocol — pending

On an identified deployed commit and documented seed dataset, time each action from its initiating click to the expected visible result: open event detail, search available venues, open the venue calendar and check equipment availability. Use three warm-ups and 30 measured samples per action, record browser/network conditions, failures, p50, p95 and maximum, and compare with the team's 2 s target. Measure registration submission when SG2-60 exists. Keep these measurements separate from the local API capacity table and from navigation-script timings that include settling waits.

## Staging

The 26 Oct signed-in inspection covered **164 page views**, **six accounts**, all **seven roles**, and widths **320, 375, 768 and 1440 px**, including the three multi-role accounts. It recorded no console or page errors, but **46 page views overflowed horizontally**. These are failures of the deployed staging version, not passing responsive acceptance. The local fixture's earlier clean result did not expose the multi-role header and real-data layouts seen on staging.

The walkthrough also reported **40 navigation timings above 2 s**. They include script settling waits and do not provide a precise click-to-result benchmark. The response-time protocol above remains pending. Session-only raw evidence is `/tmp/sg2-96-validation-staging/report.json`, its per-account screenshots and `/tmp/sg2-96-staging-walkthrough.log`; these temporary files are not durable release evidence. Preserve the final hosted CI artifact and its run URL before closing SG2-96. See [`regression-evidence-2026-10-26.md`](regression-evidence-2026-10-26.md) for the regression record and remaining release checks.

## Re-running

```sh
# disposable local PostgreSQL with the auth fixture and every migration, then:
psql -d <disposable db> -v ON_ERROR_STOP=1 -v scale=1 -f integration/capacity-seed.sql
# PostgREST on that database (anon role "anon", a local JWT secret), then from server/:
CAPACITY_REST_URL=http://127.0.0.1:<port> CAPACITY_JWT_SECRET=<secret> \
  npx tsx ../integration/capacity-check.ts --samples 30 --users 575 --seconds 60 --think 10000
```

# Test case review — 1 October 2026

Reviewed by LIM JUN WEI.

I went through all 85 current test files against the supplied DoD, Week 4 test-case guidance and Week 6 automated-testing guidance. I checked the actual acceptance criteria in the SPM Jira project, rather than assigning requirements from test names. The PDFs are reference material for this review; their illustrative feature rules are not new requirements for this repository.

The complete [method inventory](test-case-inventory.json) lists each method or SQL assertion, source file and line, category and story/AC reference. The [Jira catalogue](test-acceptance-criteria.json) records the requirement text and original feature PRs. Jira's bullets are not numbered; AC1, AC2 and so on follow their displayed order on 1 October. Named references such as `SG2-20:prototype-view-model` are supporting technical contracts, not claims that an entire Jira AC passes.

The review contains 1,138 executable test declarations and 154 SQL assertion contracts. Parameterized declarations expand to several runner cases. These are supporting checks, not 1,292 independent user acceptance workflows. Every current file is included in the diff; useful cases were retained and corrected where needed.

## Changes that matter

- Added story/AC and meaningful normal, boundary, conflict and failure tags to every test method and SQL assertion. The method ledger runs through the existing build command and fails CI if source mappings drift, assertions disappear or tests are focused/skipped.
- Replaced output type checks and values recomputed from production helpers with fixed timestamps, literal colours, complete responses and independently specified stored records.
- Strengthened rapid repeated actions to assert one actual request, and obsolete-response cases to prove that a previous account or selection cannot overwrite the current view.
- Added exact ID, description, capacity, date-window, expiry and pagination edges, including the immediately adjacent rejected value and no-write or saved-state assertions.
- Added real HTTP authorization checks and public SDK/provider state checks for stale draft mutations, reopened reviews and repeated decisions. Fixture state guards are not proof of live database concurrency isolation.
- Strengthened SQL assertions with null-safe comparisons, complete stored values and actual denied reads/writes/deletes/truncates. All seven suites run in transactions against disposable PostgreSQL and roll back.
- Kept specification, expected result, actual execution and evidence separate. Current regression entries retain their earlier execution history.

## Validation

| Check | Result | Scope |
| --- | --- | --- |
| `npm run ci` | Build clean; server 780/780, client 624/624, security-review tooling 19/19, inventory guard 9/9 | 100% statements, branches, functions and lines for every application file; existing thresholds unchanged |
| `npm run test:e2e` | 28/28 browser journeys and 13/13 report-gate checks | Production React build and real Express routes on loopback, reset memory providers, separate Chromium runtime, no retries |
| PostgreSQL policy suites | 7/7 suites; 154 assertion contracts | Auth fixture and all committed migrations, disposable PostgreSQL 17.4; container removed after execution |
| `npm run test:inventory` | Current ledger; no omitted tags, unknown ACs, duplicate IDs or skipped/focused declarations | 78 executable source files and seven SQL suites |

Local execution used Node 24.10.0/npm 11.6.1 on 1 October 2026. The PR's GitHub Actions run verifies Node 22 and PostgreSQL 17 on the pushed head; its links belong in the PR and workbook execution record. A browser prerequisite initially failed because the Playwright runtime was absent; after installing it in `/tmp`, every journey passed. One earlier server run had two HTTP transport failures; both isolated files and subsequent full runs passed without weakening assertions or adding retries.

## What this review cannot mark done

- SG2-33 AC4 and SG2-34 AC4: assignment actor/time and assignment history were deferred in original PR #48. There is no invented passing test for that missing feature.
- SG2-40: SQL history payload and immutability checks support the requirement; this checkout has no mounted history API or history-view workflow. SQL evidence does not establish the complete user-facing history ACs.
- SG2-39: the existing audit-error case proves that an event update can remain saved if the following audit insert fails. Atomic event/history persistence remains an implementation gap. The impact-confirmation path itself refuses changes until confirmation.
- Venue layout replacement uses separate delete/insert provider calls. Passing adapter tests do not establish transactional replacement under real competing database writes.
- Some sample booking, equipment and attendee screens remain prototype contracts. Their tests are explicitly labelled supporting contracts, rather than acceptance evidence for future features.
- SG2-19 repository access, branch protection and team agreement require repository/team evidence. A failing aggregate check is tested, but current branch-protection configuration has not been independently revalidated here. SG2-20's fresh-clone onboarding procedure also needs a separate manual check.
- There is no configured linter, so a clean TypeScript/Vite build is not claimed as a lint result. This review does not reconstruct historical test-first TDD or claim deployed Supabase/staging validation.
- Independent peer review is outstanding. The reviewer should use the [structured audit template](test-peer-review-template.md) and decide whether these feature gaps block the reviewed scope.

## Story / category matrix

Counts below are source method/assertion memberships, including supporting contracts. A method can have several categories or stories. An AC reference identifies the requirement an assertion supports; it does not automatically mean every clause is implemented.

| Story | Normal | Boundary | Conflict | Failure | AC references absent from automation |
| --- | ---: | ---: | ---: | ---: | --- |
| [SG2-19](https://smu-spm-group.atlassian.net/browse/SG2-19) | 0 | 0 | 0 | 0 | AC1, AC2, AC3, AC4 |
| [SG2-20](https://smu-spm-group.atlassian.net/browse/SG2-20) | 58 | 8 | 7 | 21 | None (see scope limits above) |
| [SG2-22](https://smu-spm-group.atlassian.net/browse/SG2-22) | 5 | 7 | 4 | 23 | AC1, AC4 |
| [SG2-23](https://smu-spm-group.atlassian.net/browse/SG2-23) | 16 | 4 | 5 | 28 | None (see scope limits above) |
| [SG2-24](https://smu-spm-group.atlassian.net/browse/SG2-24) | 16 | 3 | 3 | 30 | None (see scope limits above) |
| [SG2-25](https://smu-spm-group.atlassian.net/browse/SG2-25) | 11 | 1 | 4 | 72 | None (see scope limits above) |
| [SG2-26](https://smu-spm-group.atlassian.net/browse/SG2-26) | 19 | 10 | 7 | 55 | None (see scope limits above) |
| [SG2-27](https://smu-spm-group.atlassian.net/browse/SG2-27) | 22 | 12 | 2 | 37 | None (see scope limits above) |
| [SG2-28](https://smu-spm-group.atlassian.net/browse/SG2-28) | 23 | 17 | 3 | 30 | None (see scope limits above) |
| [SG2-29](https://smu-spm-group.atlassian.net/browse/SG2-29) | 19 | 8 | 4 | 29 | None (see scope limits above) |
| [SG2-30](https://smu-spm-group.atlassian.net/browse/SG2-30) | 19 | 6 | 13 | 26 | None (see scope limits above) |
| [SG2-31](https://smu-spm-group.atlassian.net/browse/SG2-31) | 21 | 6 | 1 | 22 | None (see scope limits above) |
| [SG2-32](https://smu-spm-group.atlassian.net/browse/SG2-32) | 7 | 1 | 9 | 17 | None (see scope limits above) |
| [SG2-33](https://smu-spm-group.atlassian.net/browse/SG2-33) | 15 | 9 | 7 | 30 | AC4 |
| [SG2-34](https://smu-spm-group.atlassian.net/browse/SG2-34) | 10 | 5 | 2 | 23 | AC4 |
| [SG2-35](https://smu-spm-group.atlassian.net/browse/SG2-35) | 7 | 1 | 8 | 10 | None (see scope limits above) |
| [SG2-37](https://smu-spm-group.atlassian.net/browse/SG2-37) | 13 | 4 | 5 | 17 | None (see scope limits above) |
| [SG2-38](https://smu-spm-group.atlassian.net/browse/SG2-38) | 29 | 4 | 1 | 24 | None (see scope limits above) |
| [SG2-39](https://smu-spm-group.atlassian.net/browse/SG2-39) | 35 | 27 | 15 | 44 | None (see scope limits above) |
| [SG2-40](https://smu-spm-group.atlassian.net/browse/SG2-40) | 7 | 2 | 1 | 12 | None (see scope limits above) |
| [SG2-41](https://smu-spm-group.atlassian.net/browse/SG2-41) | 18 | 8 | 4 | 20 | None (see scope limits above) |
| [SG2-42](https://smu-spm-group.atlassian.net/browse/SG2-42) | 8 | 9 | 6 | 20 | None (see scope limits above) |
| [SG2-43](https://smu-spm-group.atlassian.net/browse/SG2-43) | 15 | 12 | 3 | 29 | None (see scope limits above) |
| [SG2-44](https://smu-spm-group.atlassian.net/browse/SG2-44) | 23 | 16 | 1 | 45 | None (see scope limits above) |
| [SG2-45](https://smu-spm-group.atlassian.net/browse/SG2-45) | 17 | 10 | 17 | 26 | None (see scope limits above) |
| [SG2-46](https://smu-spm-group.atlassian.net/browse/SG2-46) | 17 | 11 | 2 | 12 | None (see scope limits above) |

## Every file reviewed

| File | Methods / SQL contracts | Normal | Boundary | Conflict | Failure |
| --- | ---: | ---: | ---: | ---: | ---: |
| [.github/scripts/regression-gate.test.mjs](../.github/scripts/regression-gate.test.mjs) | 10 | 1 | 1 | 1 | 7 |
| [.github/scripts/security-review.test.mjs](../.github/scripts/security-review.test.mjs) | 19 | 2 | 5 | 2 | 10 |
| [.github/scripts/test-inventory.test.mjs](../.github/scripts/test-inventory.test.mjs) | 9 | 2 | 1 | 1 | 6 |
| [client/src/App.test.tsx](../client/src/App.test.tsx) | 39 | 30 | 1 | 0 | 8 |
| [client/src/HealthCheck.test.tsx](../client/src/HealthCheck.test.tsx) | 5 | 1 | 0 | 0 | 4 |
| [client/src/api/eventRequests.test.ts](../client/src/api/eventRequests.test.ts) | 96 | 16 | 7 | 8 | 65 |
| [client/src/api/profile.test.ts](../client/src/api/profile.test.ts) | 10 | 2 | 0 | 0 | 8 |
| [client/src/api/workQueue.test.ts](../client/src/api/workQueue.test.ts) | 15 | 4 | 0 | 0 | 11 |
| [client/src/auth/access.test.ts](../client/src/auth/access.test.ts) | 6 | 2 | 0 | 0 | 4 |
| [client/src/auth/session.test.ts](../client/src/auth/session.test.ts) | 7 | 2 | 1 | 0 | 4 |
| [client/src/components/EventStageTracker.test.tsx](../client/src/components/EventStageTracker.test.tsx) | 4 | 3 | 1 | 0 | 0 |
| [client/src/hooks/useInertiaScroll.test.tsx](../client/src/hooks/useInertiaScroll.test.tsx) | 8 | 3 | 2 | 2 | 1 |
| [client/src/hooks/useParticleOrb.test.tsx](../client/src/hooks/useParticleOrb.test.tsx) | 9 | 4 | 1 | 2 | 2 |
| [client/src/main.test.tsx](../client/src/main.test.tsx) | 3 | 3 | 0 | 0 | 0 |
| [client/src/mock/viewModel.test.ts](../client/src/mock/viewModel.test.ts) | 28 | 22 | 4 | 2 | 0 |
| [client/src/screens/AvailabilityCalendar.test.tsx](../client/src/screens/AvailabilityCalendar.test.tsx) | 10 | 6 | 1 | 0 | 3 |
| [client/src/screens/CoordinatorAssignment.test.tsx](../client/src/screens/CoordinatorAssignment.test.tsx) | 9 | 3 | 1 | 3 | 2 |
| [client/src/screens/Dashboard.test.tsx](../client/src/screens/Dashboard.test.tsx) | 5 | 2 | 1 | 1 | 1 |
| [client/src/screens/DraftRequests.test.tsx](../client/src/screens/DraftRequests.test.tsx) | 13 | 2 | 2 | 5 | 4 |
| [client/src/screens/EventDetail.test.tsx](../client/src/screens/EventDetail.test.tsx) | 24 | 7 | 4 | 3 | 10 |
| [client/src/screens/EventPlanningDrawer.test.tsx](../client/src/screens/EventPlanningDrawer.test.tsx) | 24 | 7 | 7 | 4 | 6 |
| [client/src/screens/EventsTable.test.tsx](../client/src/screens/EventsTable.test.tsx) | 12 | 3 | 2 | 1 | 6 |
| [client/src/screens/Login.test.tsx](../client/src/screens/Login.test.tsx) | 6 | 2 | 0 | 1 | 3 |
| [client/src/screens/Profile.test.tsx](../client/src/screens/Profile.test.tsx) | 12 | 4 | 3 | 2 | 3 |
| [client/src/screens/RequestForm.test.tsx](../client/src/screens/RequestForm.test.tsx) | 43 | 16 | 6 | 5 | 16 |
| [client/src/screens/VenueSearch.test.tsx](../client/src/screens/VenueSearch.test.tsx) | 10 | 4 | 4 | 1 | 1 |
| [client/src/screens/WorkQueue.test.tsx](../client/src/screens/WorkQueue.test.tsx) | 19 | 8 | 1 | 6 | 4 |
| [client/src/ui.test.tsx](../client/src/ui.test.tsx) | 6 | 4 | 1 | 1 | 0 |
| [client/src/venues/VenueBlocks.test.tsx](../client/src/venues/VenueBlocks.test.tsx) | 13 | 3 | 3 | 3 | 4 |
| [client/src/venues/VenueLayouts.test.tsx](../client/src/venues/VenueLayouts.test.tsx) | 13 | 3 | 4 | 2 | 4 |
| [client/src/venues/Venues.test.tsx](../client/src/venues/Venues.test.tsx) | 19 | 2 | 4 | 5 | 8 |
| [client/src/venues/availability.test.ts](../client/src/venues/availability.test.ts) | 5 | 1 | 0 | 0 | 4 |
| [client/src/venues/blocksApi.test.ts](../client/src/venues/blocksApi.test.ts) | 9 | 4 | 0 | 3 | 2 |
| [client/src/venues/calendarView.test.ts](../client/src/venues/calendarView.test.ts) | 8 | 3 | 5 | 0 | 0 |
| [client/src/venues/layoutsApi.test.ts](../client/src/venues/layoutsApi.test.ts) | 6 | 2 | 1 | 0 | 3 |
| [client/src/venues/searchApi.test.ts](../client/src/venues/searchApi.test.ts) | 5 | 1 | 1 | 0 | 3 |
| [client/src/venues/searchPrefill.test.ts](../client/src/venues/searchPrefill.test.ts) | 4 | 2 | 2 | 0 | 0 |
| [e2e/regression.spec.ts](../e2e/regression.spec.ts) | 28 | 14 | 5 | 6 | 10 |
| [server/src/app.test.ts](../server/src/app.test.ts) | 6 | 5 | 0 | 0 | 2 |
| [server/src/assignCoordinator.test.ts](../server/src/assignCoordinator.test.ts) | 19 | 3 | 2 | 1 | 13 |
| [server/src/authorization.test.ts](../server/src/authorization.test.ts) | 24 | 5 | 1 | 4 | 16 |
| [server/src/db/accountRoles.test.ts](../server/src/db/accountRoles.test.ts) | 14 | 5 | 2 | 0 | 8 |
| [server/src/db/auditLogs.test.ts](../server/src/db/auditLogs.test.ts) | 8 | 2 | 3 | 0 | 3 |
| [server/src/db/client-config.test.ts](../server/src/db/client-config.test.ts) | 7 | 2 | 0 | 0 | 5 |
| [server/src/db/eventPlanning.test.ts](../server/src/db/eventPlanning.test.ts) | 11 | 5 | 1 | 0 | 5 |
| [server/src/db/eventRequests.test.ts](../server/src/db/eventRequests.test.ts) | 52 | 20 | 5 | 9 | 18 |
| [server/src/db/profile.test.ts](../server/src/db/profile.test.ts) | 9 | 3 | 0 | 0 | 6 |
| [server/src/db/supabase.test.ts](../server/src/db/supabase.test.ts) | 9 | 2 | 0 | 0 | 7 |
| [server/src/db/user-client.test.ts](../server/src/db/user-client.test.ts) | 5 | 1 | 0 | 0 | 4 |
| [server/src/db/users.test.ts](../server/src/db/users.test.ts) | 5 | 2 | 0 | 0 | 3 |
| [server/src/db/venueBlocks.test.ts](../server/src/db/venueBlocks.test.ts) | 11 | 3 | 0 | 3 | 5 |
| [server/src/db/venueLayouts.test.ts](../server/src/db/venueLayouts.test.ts) | 5 | 1 | 1 | 0 | 3 |
| [server/src/db/venues.test.ts](../server/src/db/venues.test.ts) | 4 | 1 | 0 | 1 | 4 |
| [server/src/db/workQueue.test.ts](../server/src/db/workQueue.test.ts) | 4 | 1 | 2 | 0 | 1 |
| [server/src/decideEventRequest.test.ts](../server/src/decideEventRequest.test.ts) | 18 | 4 | 3 | 1 | 10 |
| [server/src/deleteEventRequestDraft.test.ts](../server/src/deleteEventRequestDraft.test.ts) | 12 | 2 | 1 | 1 | 8 |
| [server/src/eventRequests.test.ts](../server/src/eventRequests.test.ts) | 33 | 9 | 11 | 0 | 13 |
| [server/src/events/updatePlanning.test.ts](../server/src/events/updatePlanning.test.ts) | 43 | 15 | 13 | 3 | 19 |
| [server/src/getEventStage.test.ts](../server/src/getEventStage.test.ts) | 10 | 3 | 0 | 0 | 7 |
| [server/src/getEventStageAuth.test.ts](../server/src/getEventStageAuth.test.ts) | 6 | 4 | 0 | 0 | 2 |
| [server/src/index.test.ts](../server/src/index.test.ts) | 1 | 1 | 0 | 0 | 0 |
| [server/src/listAssignable.test.ts](../server/src/listAssignable.test.ts) | 8 | 2 | 0 | 0 | 6 |
| [server/src/listEventRequests.test.ts](../server/src/listEventRequests.test.ts) | 21 | 7 | 2 | 0 | 12 |
| [server/src/login.test.ts](../server/src/login.test.ts) | 18 | 3 | 2 | 1 | 12 |
| [server/src/logout.test.ts](../server/src/logout.test.ts) | 6 | 2 | 1 | 1 | 3 |
| [server/src/organisationEventRequests.test.ts](../server/src/organisationEventRequests.test.ts) | 14 | 4 | 1 | 2 | 9 |
| [server/src/profile.test.ts](../server/src/profile.test.ts) | 37 | 11 | 8 | 0 | 20 |
| [server/src/reviewEventRequest.test.ts](../server/src/reviewEventRequest.test.ts) | 10 | 2 | 1 | 1 | 6 |
| [server/src/roles.test.ts](../server/src/roles.test.ts) | 8 | 2 | 0 | 0 | 7 |
| [server/src/stageCalculator.test.ts](../server/src/stageCalculator.test.ts) | 14 | 10 | 3 | 0 | 1 |
| [server/src/submitEventRequest.test.ts](../server/src/submitEventRequest.test.ts) | 17 | 4 | 1 | 2 | 10 |
| [server/src/updateEventRequestDraft.test.ts](../server/src/updateEventRequestDraft.test.ts) | 17 | 4 | 2 | 1 | 10 |
| [server/src/venue-availability.test.ts](../server/src/venue-availability.test.ts) | 31 | 6 | 7 | 0 | 21 |
| [server/src/venue-blocks.test.ts](../server/src/venue-blocks.test.ts) | 11 | 3 | 3 | 2 | 6 |
| [server/src/venue-layouts.test.ts](../server/src/venue-layouts.test.ts) | 9 | 3 | 3 | 0 | 6 |
| [server/src/venue-search.test.ts](../server/src/venue-search.test.ts) | 16 | 7 | 4 | 1 | 6 |
| [server/src/venues.test.ts](../server/src/venues.test.ts) | 8 | 1 | 3 | 0 | 6 |
| [server/src/workQueue.test.ts](../server/src/workQueue.test.ts) | 6 | 2 | 0 | 1 | 4 |
| [supabase/tests/account_roles.sql](../supabase/tests/account_roles.sql) | 18 | 3 | 2 | 2 | 11 |
| [supabase/tests/event_organisation_isolation.sql](../supabase/tests/event_organisation_isolation.sql) | 24 | 7 | 2 | 1 | 14 |
| [supabase/tests/event_planning_and_audit.sql](../supabase/tests/event_planning_and_audit.sql) | 26 | 7 | 4 | 3 | 12 |
| [supabase/tests/internal_work_queue.sql](../supabase/tests/internal_work_queue.sql) | 24 | 7 | 5 | 2 | 10 |
| [supabase/tests/venue_availability.sql](../supabase/tests/venue_availability.sql) | 21 | 4 | 3 | 1 | 13 |
| [supabase/tests/venue_blocks.sql](../supabase/tests/venue_blocks.sql) | 19 | 3 | 4 | 4 | 8 |
| [supabase/tests/venue_layouts.sql](../supabase/tests/venue_layouts.sql) | 22 | 5 | 3 | 1 | 13 |

## Reproduce and maintain the register

Run `npm run ci` and `npm run test:e2e`. Database setup and all seven suites are defined in `.github/workflows/ci.yml`; use a disposable PostgreSQL instance. Before committing changed tests, run `npm run test:inventory:update`, inspect the mapped requirements/categories, then `npm run test:inventory`. Export specification details with `node .github/scripts/test-inventory.mjs --details /tmp/spm-test-details.json`.

The course workbook is [SPM Test Cases](https://docs.google.com/spreadsheets/d/1SPPWhdqrtvg7xQVbJaUia2ZbZDjwtciceW6-RgrzI8o/edit). The 1 October review tab records the exhaustive current inventory after validation and PR push, while earlier tabs remain historical execution snapshots. Its author and executor fields use LIM JUN WEI and its actual-result fields identify the runner and environment.

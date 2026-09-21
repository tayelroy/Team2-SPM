# Purposeful regression cases

The current register is [`regression-cases.json`](regression-cases.json): **26
scenarios: 17 browser journeys, 4 supporting backend cases, 3 SQL cases and 2
hosted CI cases**. A scenario groups assertions around one observable outcome;
it is not a list of every unit test. Positive, negative and boundary partitions
can share a case when they establish the same rule. Counts are not a coverage
or quality target.

Each record contains a stable ID, title, type, story, purpose, preconditions,
steps, data, expected result and evidence path. `status`, `actual` and
`execution_evidence` are separate execution fields. Use **Not
Executed** until verified; update results only from a matching run with its command/run URL,
revision and environment. A source path is automation mapping, not proof of a
passing execution. The catalog is suitable for filling the course Google Sheet;
the register does not automatically write to that Sheet.

## What each layer proves

| Layer | Purpose and limit |
| --- | --- |
| Playwright, 17 cases | Chromium drives the built React app over HTTP through real Express handlers. Test-only identity and storage providers are replaced by [`e2e/server.ts`](../e2e/server.ts) and [`MemoryDatabase`](../e2e/support/memory-database.ts). Persistence means data survives page reload in that running fixture. It does not prove durable database storage, deployed Supabase Auth/RLS, real session expiry, or cross-browser compatibility. |
| Backend, 4 cases | Existing unit/API suites retain denied credentials/outages, changed-role decisions, draft validation and storage-failure behavior using controlled providers/stores. They are not Playwright cases. |
| PostgreSQL, 3 cases | The committed SQL scripts apply policy/constraint assertions to disposable PostgreSQL with the Auth identity fixture. These are actual SQL checks, but not deployed Supabase tests or a full application transaction. |
| Hosted CI, 2 cases | Check the required aggregate and workflow event behavior, including the new browser job. Local script inspection or a past workflow run cannot establish current hosted execution or branch protection. |

Run `npm run test:regression` for the browser journeys after installing Chromium
with `npx playwright install chromium`. The regression command builds the app;
Playwright starts the fixture server. Run `npm run ci` for build, application coverage
and reviewer checks. SQL checks run separately in the workflow's disposable
PostgreSQL service. See [CI details](ci.md) for the browser job, artifacts and
required check. Test-only reset endpoints and memory storage are never mounted
in the production composition root.

The browser selection follows the user workflows: role login, refused login,
logout, venue create/edit/search, permissions, capacity/name limits, fresh event
submission, incomplete draft saving, editing/submitting, confirmed deletion,
profile save, phone limits and month navigation. Supporting tests retain
failure and policy behavior that these journeys intentionally do not repeat.

## Historical 36-to-22 consolidation

The previous register had 13 backend, 14 frontend and 9 database/CI scenarios.
The mapping below accounts for all **36 historical IDs**. “Supporting suite”
means the distinct lower-level test remains valuable in its committed suite,
without claiming a separate current acceptance workflow. This is a register
redesign, not deletion of those automated tests. A reused ID may have a broader
current scenario; the current specification is authoritative.

| Historical ID(s) | Current destination / decision |
| --- | --- |
| SG2-25-TC-001 | PW-AUTH-01 and SG2-42-P01 provide permitted application controls; existing guarded-organiser assertions remain in the supporting authorization suite. |
| SG2-25-TC-002 | SG2-42-N01 covers visible/API write denial; BE-AUTH-01 retains role/forged-field partitions. |
| SG2-25-TC-003 | SG2-42-N01 covers a missing-token venue write; BE-AUTH-01 retains middleware credential partitions. |
| SG2-25-TC-004 | BE-AUTH-01 consolidates provider credential rejection and outage cases. |
| SG2-25-TC-005 | BE-AUTH-02 retains the same-token role-change decision. |
| BE-HEALTH-01 | Startup/liveness remain supporting backend checks; no independent business-workflow claim. |
| BE-HEALTH-02 | Connected/unconfigured readiness remain supporting backend checks. |
| BE-HEALTH-03 | Configuration validation remains supporting backend checks. |
| BE-HEALTH-04 | Safe health-provider failure remains supporting backend checks; it is not represented as business persistence coverage. |
| SG2-28-P01 | Same ID now covers fresh create-and-submit/readback; draft creation also participates in SG2-28-B01. |
| SG2-28-B01 | Same ID covers incomplete saving, repeat save and blocked submission through the browser/API. |
| SG2-28-B02 | BE-EVENT-01 preserves direct malformed/text-length validation; browser-specific numeric limits have their own feature cases. |
| SG2-28-N01 | BE-AUTH-01 and BE-PERSIST-01 retain unauthorized/unavailable creation handling. |
| FE-UI-01 | PW-AUTH-01 covers all seeded role landings; detailed navigation matrix remains supporting frontend coverage. |
| FE-UI-02 | SG2-28-P01, SG2-29-P01 and SG2-32-P01 cover implemented request journeys; prototype-only review/amend assertions remain supporting frontend scope. |
| FE-UI-03 | SG2-42-P01 and SG2-44-P01 cover venue maintenance and API-backed fixture calendar; prototype handoff remains supporting scope. |
| FE-UI-04 | Prototype equipment reservation remains supporting frontend scope; no durable equipment acceptance claim is introduced. |
| FE-UI-05 | Prototype attendee registration/withdrawal remains supporting frontend scope; no persisted attendee workflow claim is introduced. |
| FE-HEALTH-01 | Health-success UI remains a supporting frontend check. |
| FE-HEALTH-02 | HTTP failure UI remains a supporting frontend check. |
| FE-HEALTH-03 | Structured/unstructured network failure UI remains supporting frontend checks. |
| FE-HEALTH-04 | Malformed JSON handling remains a supporting frontend check. |
| SG2-42-P01 | Same ID retains create/edit/search/reload as one browser journey. |
| SG2-42-N01 | Same ID retains staff-only writes with both UI and API evidence. |
| SG2-42-B01 | Same ID focuses browser capacity boundaries; route-ID partitions remain in backend venue tests. |
| SG2-42-B02 | Same ID focuses the 255/256 name boundary; required-field and allowlist checks remain in backend venue tests. |
| SG2-42-N02 | BE-PERSIST-01 retains safe store failures; interrupted/pending/duplicate-operation component assertions remain supporting frontend checks. |
| DB-ROLE-01, DB-ROLE-02, DB-ROLE-03, DB-ROLE-04, DB-ROLE-05 | DB-ROLE-01 groups the five assertions already executed by account_roles.sql: own-role read, denied writes, anonymous denial, changed role and schema integrity. |
| CI-REG-01 | Same ID includes every required job, now including browser regression. |
| CI-REG-02 | Same ID retains exact merge revision, overlapping merge retention and unmerged-close behavior. |
| CI-REG-03 | CI-REG-01 combines failure blocking, evidence retention and restoration with the aggregate contract. |
| CI-REG-04 | Reviewer unit tests remain a distinct supporting job, required by CI-REG-01; they do not become an application acceptance workflow. |

New explicit workflow records are PW-AUTH-01/02/03, SG2-29-P01, SG2-32-P01,
SG2-27-P01/B01, SG2-44-P01 and DB-AVAIL-01. They cover actual current browser
journeys or the existing venue SQL script, without treating all historical
prototype/helper rows as redundant.

## Execution evidence and historical notes

Numbers and results in [`testing.md`](testing.md) and dated sections of
[`ci.md`](ci.md) describe earlier revisions, including the old 36-case register,
343-test inventory and then-absent browser job. They must not be copied as
current Pass results. Current runner totals can differ from 26 because each
scenario is supported by multiple lower-level assertions and parameterized
cases.

Existing hosted SQL evidence may be retained only with its original run and a
verified match of the SQL/migration inputs. The newly changed browser job and
hosted lifecycle/required-check cases remain **Not Executed** until the updated
workflow is actually run and verified. Browser fixture success does not upgrade
SQL, deployed Supabase, hosted CI or deployment status.

Known broader gaps are outside these 22 selected scenarios: real deployed
Auth/database integration, additional browser engines and availability interval-edge
semantics against PostgreSQL. The approved event-name/attendance limits and
malformed-login validation fixes are covered by the supporting backend cases.
A passing register is evidence for its stated scope, not complete
proof of every project requirement.

## Verified 20 September 2026

`npm run ci:full` passed on Node 22.21.0 against main base
`0ea5d34a216f98bdafde91df0ac101ed9f5df404` plus the local changes:
**431 backend + 388 frontend + 19 reviewer + 14 Chromium tests = 852 passing tests**.
Backend and frontend coverage passed the existing 100% thresholds. The aggregate
decision script also passed 16 local success/failure/cancelled/skipped combinations.
The run log is `/tmp/team2-approved-final-ci.log`; browser JSON, JUnit, HTML and
attachment evidence is generated under `test-results/` and `playwright-report/`.
The verified run was archived at `/tmp/team2-final-regression-evidence/` before
restoring the repository's previously tracked generated report files, keeping
generated report changes out of this implementation diff.

The two SQL records retain the [successful hosted job](https://github.com/tayelroy/Team2-SPM/actions/runs/35371407367/job/105686001947)
from 18 September 16:56 UTC (19 September 00:56 SGT), which checked out the exact
base above. All SQL, fixture and migration files remain unchanged. They were not
rerun locally. The two changed-workflow CI records remain **Not Executed**.

The [course test register](https://docs.google.com/spreadsheets/d/1SPPWhdqrtvg7xQVbJaUia2ZbZDjwtciceW6-RgrzI8o/edit)
uses the same 22 records, with 20 scoped Pass results and 2 Not Executed results.
A [native backup](https://docs.google.com/spreadsheets/d/1ARJ1zCmmhUYmjFdLUaM1SyMhEElS9oUalpjffTbQ9B0/edit)
preserves the previous workbook before consolidation. The blank template and
existing tab layout are retained.

## SG2-26 additions

`SG2-26-P01` covers organisation sharing and creator-only actions; `SG2-26-N01`
covers unrelated and unassigned accounts. `DB-ORG-01` covers direct database
reads and protected membership. `PW-AUTH-03` remains the logout regression; its
previous SG2-26 mapping was incorrect.

`SG2-26-N02` checks all four non-organiser roles are denied the organisation
event API and do not receive My events navigation.

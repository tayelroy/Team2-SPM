# Full regression and staging validation — 26 October 2026 (SG2-96)

SG2-96 requires the full Week 7 journey and regression results after the Week 7 stories merge, with a date, tested commit and hosted CI run link for the Managing Changes guide.

**Release status: integrated local regression verified; hosted sign-off pending.** The multi-role phone header was repaired, main a9eb363 was integrated, and the full combined regression passes. The passing hosted CI run for the published revision, deployed retest, hosted migration evidence and unaided human walkthrough remain outstanding. Historical baseline results are separated from the integrated-tree verification below.

**Revisions:** SG2-96's pre-merge baseline was committed as `eef4121` on `feature/SG2-96-week7-release-checks`, based on main [`b7e2b1a`](https://github.com/tayelroy/Team2-SPM/tree/b7e2b1a) (PR #113, SG2-93). Main `a9eb363` includes PR #112 (SG2-60) and PR #114 (SG2-64). The integrated application was tested at **`739f285aae0cb4b70fab17c7edf4df172c840bba`**; the following commit only updates design/release evidence. The published revision still requires its own hosted CI run.

**Date:** 26 Oct 2026 (Asia/Singapore).

**Rerun environment:** macOS, Node **24.10.0**, Playwright Chromium, disposable Docker **PostgreSQL 17** and **PostgREST 12.2.12**. Database checks replayed the current CI workflow against disposable databases. This differs from the earlier Linux/PostgreSQL 16 capacity benchmark, which remains a separate recorded run in [`nfr-capacity-review.md`](nfr-capacity-review.md).

**Hosted CI evidence: pending.** After the final changes are committed, **Build and test** generates a `regression-evidence-<run ID>-<attempt>` artifact with the exact checked-out SHA, UTC date, real run-attempt link and every required job result. Copy that verified record here and into the Managing Changes guide before its 14-day retention expires; see [`ci.md`](ci.md#regression-evidence-sg2-96). Do not substitute the base commit's run for the final branch.

## Design evidence attached to the PR

The updated design models and notes are attached to [PR #115's design-evidence comment](https://github.com/tayelroy/Team2-SPM/pull/115#issuecomment-6411646334). The comment includes a source/manifest/patch ZIP, five native-size PDFs and previews: seven C4 pages, three class pages, four data-model pages, one status page and five sequence pages. All 20 pages were rendered and visually checked. The source tree in the implementation diff is restored to main; the reviewed design updates remain available in those attachments and the ignored local `output/sg2-96-design-evidence/` directory.

## First hosted CI attempt and bounded retry

[CI run 40289474412](https://github.com/tayelroy/Team2-SPM/actions/runs/40289474412) verified application coverage, database policies and browser smoke on published `51fb262`, but the browser-regression job reached its 15-minute job limit. Browser/OS dependency installation consumed **10 m 18 s**, leaving **4 m 46 s** for regression execution; the visible log reached 150 passing cases before cancellation. This run is not a passing full-regression record.

The browser job now reserves **25 minutes** overall, with **12 minutes** for installation and **10 minutes** for regression execution, leaving time for setup and report uploads. Assertions, required cases and failure gates are unchanged; the five evidence, 13 regression-gate and 19 reviewer-tool tests passed after the configuration change. The new published revision still requires a successful hosted run.

The first automated AI security review stopped before inference because the original diff required **21 chunks**, above the configured limit of 20. Moving the design evidence to the comment, including the CI-budget fix and its evidence updates, reduces the implementation diff to **nine chunks** without changing the scanner's configuration. Its new review result must be checked separately from the application CI result.

## Local baseline rerun

These results precede both the fixes prompted by the signed-in staging inspection and the later merge of main a9eb363.

| Suite | Command or scope | Result |
|---|---|---|
| Build, inventory, unit and component tests with coverage | `npm run ci:full` (build/coverage portion) | Passed. Server **1,844** tests and client **1,890** tests; **100%** statements, branches, functions and lines in both. Inventory/policy and reviewer checks passed. |
| Browser regression and gate | `npm run ci:full` → `npm run test:e2e` | **159 / 159 passed in 187.7 s**, including SG2-96-E2E01 and SG2-71-B01. Regression gate passed, including required SG2-26 cases. |
| Native API integration | `npm run test:integration` | **25 / 25 passed**, including SG2-96-INT01, the Week 7 journey against the real database. |
| Database contracts and races | Replay of `.github/workflows/ci.yml` database job | Passed: **71 migrations**, **46 SQL contract script invocations**, **11 concurrency scripts** and **27 release-readiness checks**. |
| Legacy database upgrade | Replay of the CI upgrade steps | Passed: legacy fixtures, migration application, hold-link migration reapplication and **two SQL verification scripts**. |

SG2-96-E2E01 carries the browser journey through organiser submission, Lead assignment, coordinator approval, venue and equipment confirmation, safety approval, Preparation and coordinator confirmation. It also checks that confirmation is unavailable before safety approval. Its loopback fixture mirrors the safety hand-off; SG2-96-INT01 separately verifies the journey with PostgreSQL triggers and two venues.

Session-only logs: `/tmp/sg2-96-ci-full-approved.log`, `/tmp/sg2-96-integration-approved.log` and `/tmp/sg2-96-database-regression.log`. They document this validation session but are temporary and do not replace retained CI artifacts.

## Signed-in staging inspection

Target: `https://team2-spm-server.vercel.app` as deployed during this validation; deployment SHA was not independently established. This tests the deployed version, not the uncommitted branch.

- **164 page views** across **six accounts**, covering all **seven roles** and the three supplied multi-role accounts at **320, 375, 768 and 1440 px**.
- No console or page errors were recorded.
- **46 page views overflowed horizontally**. Visual inspection confirmed that the multi-role header pushed the profile control beyond the phone viewport. The earlier local single-role fixture result did not cover that condition.
- **40 navigation timings exceeded 2 s**. These include the walkthrough's settling waits, so they are warnings rather than precise end-user performance measurements. The browser response-time target remains unverified.

Session-only report and screenshots: `/tmp/sg2-96-validation-staging/report.json` and its per-account screenshot folders; summary log: `/tmp/sg2-96-staging-walkthrough.log`. The `Staging check` workflow can retain subsequent results when `SPM_STAGING_PASSWORD` is configured; see [`ci.md`](ci.md#staging-check-sg2-96).

## Verification after remediation

- The header controls now wrap, and the role selector takes its own row on phones. Profile and Notifications remain visible and usable.
- SG2-71-B01 now covers all three multi-role combinations, both held roles and 320/375 px widths. It checks control bounds, role-specific navigation and actual Profile/Notifications interactions, in addition to the original seven-role page checks. The expanded case reproduced **62 px** of overflow before the fix and passes after it.
- The repaired walkthrough waits for permissions, checks representative role-specific navigation and fails unfinished/error pages instead of ignoring loading timeouts. It avoids dispatching an artificial same-role selection change.
- A local production-build walkthrough opened **172 page views** across six fixture accounts covering all seven roles and three multi-role combinations at **320, 375, 768 and 1440 px**, with **zero overflow, console/page or readiness failures**. A manual 320 px visual check confirmed that the header controls fit. This verifies branch code; it does not change the deployed staging site.
- **Pre-merge full regression after remediation: passed.** `npm run ci:full` exited 0: server **1,844 / 1,844**, client **1,890 / 1,890**, both at **100%** statements/branches/functions/lines, and browser **159 / 159** in **186.5 s**, with zero failures, skips or flaky cases. The expanded phone case and full Week 7 journey passed, as did the required SG2-26 gate, 22 inventory/policy checks, 19 reviewer checks and 13 regression-gate tests. Browser run started **26 Oct 2026, 07:01:53.907 UTC** (15:01 SGT).
- The five new CI-evidence tests passed. Pre-merge inventory contained **235 executable files, 3,197 methods and 1,372 SQL assertions**. Log: `/tmp/sg2-96-ci-full-final.log`; browser JSON/JUnit, HTML report and coverage were generated in the usual report directories. These counts and database baseline results describe the pre-merge tree only.

## Verification after merging main a9eb363

The main merge adds real registration writes (SG2-60) and persisted organiser change requests (SG2-64), including their migrations, API/component tests, browser cases and database checks. Both sets of scenarios are retained alongside SG2-96's cases: **248 unique regression cases**. The regenerated inventory contains **244 executable files, 3,251 methods and 1,413 SQL assertions**.

| Integrated check | Result on 739f285 |
|---|---|
| `npm run ci:full` | Passed, exit 0 |
| Production build | Passed without warnings; React runtime 141.74 kB and app 382.44 kB in separate chunks |
| Server / client | **1,874 / 1,874** and **1,914 / 1,914** passed; **100%** statements, branches, functions and lines in both |
| Browser regression | **163 / 163** passed in **168.2 s**, with zero failures, skips or flaky cases; full Week 7 journey, registration, change requests, expanded phone case and mandatory SG2-26 gate passed |
| Native API integration | **26 / 26** passed against PostgreSQL/PostgREST |
| Database / concurrency / upgrades | **73 migrations**, **48 SQL suites**, **12 concurrency scripts**, **27 readiness checks**, legacy fixtures and two upgrade SQL checks passed |
| CI evidence generator | **5 / 5** passed |
| Exact DoD widths | **92 page views** across all seven roles and three multi-role pairs at **390 / 1440 px**, plus eight registration/change-request form and success screenshots; no overflow, page errors or visual regressions |

The browser run started **26 Oct 2026, 07:47:34.049 UTC** (15:47 SGT). An initial run overlapped the database checks and stalled in one existing test worker; it was interrupted. That file passed **43 / 43** in isolation, and the complete clean rerun passed without changing application or test source. No linter is configured; build/TypeScript success is not an independent lint result.

Final session logs: `/tmp/sg2-96-ci-full-merged-rerun.log`, `/tmp/sg2-96-integration-merged.log`, `/tmp/sg2-96-database-regression-merged.log` and `/tmp/sg2-96-evidence-tests-merged.log`. Responsive screenshots/report: `/tmp/sg2-96-merged-responsive-390-1440/`. These temporary files do not replace the retained hosted artifacts.

The PR remains a draft until the applicable DoD gates are met. Hosted rehearsal, rollback, apply and release readiness are pending; successful disposable-database checks do not establish those hosted results.

Session-only repaired walkthrough evidence: `/tmp/sg2-96-remediation-walkthrough-verified/report.json`; visual proof: `/tmp/sg2-96-repaired-phone.jpg`. An intermediate repeated local walkthrough hit the normal sign-in rate limit; resetting only the disposable fixture allowed a clean run. Shared staging rate limits were not changed.

## Release checks still required

1. Retest staging after the fixed commit is deployed, including the three multi-role accounts; a local fix does not repair the current deployment.
2. Record the published revision's successful hosted CI run URL and retained artifacts. The local combined application is verified above; hosted evidence must cover the published revision, including SG2-60 and SG2-64.
3. Complete the unaided human task walkthrough and the browser response-time protocol in [`nfr-capacity-review.md`](nfr-capacity-review.md), including the now-implemented SG2-60 registration submission. Browsing an event does not satisfy the registration-action check.
4. Rehearse and apply `202610260002_event_lookup_indexes.sql` to the shared environment using [`release-readiness.md`](release-readiness.md). This validation applied it only to disposable local databases.

## Earlier run retained for context

The original 26 Oct Linux run used Node 22, PostgreSQL 16.15 and PostgREST 12.2.12. It recorded 1,844 server tests, 1,890 client tests, 100% coverage, 25 integration cases and 158 browser cases; adding SG2-96-E2E01 then produced a 159-case browser pass. That run stripped unreachable Google Fonts links from built output. The macOS reruns above provide later pre-merge baselines; none of those counts or timings is final evidence for the subsequent main merge.

See [`nfr-capacity-review.md`](nfr-capacity-review.md) for capacity assumptions, performance scope and the human walkthrough protocol, and [`requirements-alignment.md`](requirements-alignment.md) for implemented scope.

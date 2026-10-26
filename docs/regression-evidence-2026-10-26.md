# Full regression and staging validation — 26 October 2026 (SG2-96)

SG2-96 requires the full Week 7 journey and regression results after the Week 7 stories merge, with a date, tested commit and hosted CI run link for the Managing Changes guide.

**Release status: local remediation verified; hosted sign-off pending.** The multi-role phone header has been repaired and checked locally. The final SG2-96 commit, its passing hosted CI run, the deployed retest and an unaided human walkthrough remain outstanding. A local run against an uncommitted tree is not immutable release evidence.

**Revision:** main [`b7e2b1a`](https://github.com/tayelroy/Team2-SPM/tree/b7e2b1a) (PR #113, the last Week 7 story, SG2-93), plus the SG2-96 working tree. No final branch commit is recorded yet.

**Date:** 26 Oct 2026 (Asia/Singapore).

**Rerun environment:** macOS, Node **24.10.0**, Playwright Chromium, disposable Docker **PostgreSQL 17** and **PostgREST 12.2.12**. Database checks replayed the current CI workflow against disposable databases. This differs from the earlier Linux/PostgreSQL 16 capacity benchmark, which remains a separate recorded run in [`nfr-capacity-review.md`](nfr-capacity-review.md).

**Hosted CI evidence: pending.** After the final changes are committed, **Build and test** generates a `regression-evidence-<run ID>-<attempt>` artifact with the exact checked-out SHA, UTC date, real run-attempt link and every required job result. Copy that verified record here and into the Managing Changes guide before its 14-day retention expires; see [`ci.md`](ci.md#regression-evidence-sg2-96). Do not substitute the base commit's run for the final branch.

## Local baseline rerun

These results precede the fixes prompted by the signed-in staging inspection.

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
- **Final full regression after remediation: passed.** `npm run ci:full` exited 0: server **1,844 / 1,844**, client **1,890 / 1,890**, both at **100%** statements/branches/functions/lines, and browser **159 / 159** in **186.5 s**, with zero failures, skips or flaky cases. The expanded phone case and full Week 7 journey passed, as did the required SG2-26 gate, 22 inventory/policy checks, 19 reviewer checks and 13 regression-gate tests. Browser run started **26 Oct 2026, 07:01:53.907 UTC** (15:01 SGT).
- The five new CI-evidence tests pass. Inventory contains **235 executable files, 3,197 methods and 1,372 SQL assertions**. Final log: `/tmp/sg2-96-ci-full-final.log`; browser JSON/JUnit, HTML report and coverage are generated in the usual report directories. Database code did not change during this remediation, so the successful integration/database baseline above remains the relevant database verification.

Session-only repaired walkthrough evidence: `/tmp/sg2-96-remediation-walkthrough-verified/report.json`; visual proof: `/tmp/sg2-96-repaired-phone.jpg`. An intermediate repeated local walkthrough hit the normal sign-in rate limit; resetting only the disposable fixture allowed a clean run. Shared staging rate limits were not changed.

## Release checks still required

1. Retest staging after the fixed commit is deployed, including the three multi-role accounts; a local fix does not repair the current deployment.
2. Record the final tested commit SHA, successful hosted CI run URL and retained artifacts. The full regression must cover that final commit.
3. Complete the unaided human task walkthrough and the browser response-time protocol in [`nfr-capacity-review.md`](nfr-capacity-review.md). Registration submission remains an unimplemented SG2-60 dependency; browsing an event does not satisfy that check.
4. Rehearse and apply `202610260002_event_lookup_indexes.sql` to the shared environment using [`release-readiness.md`](release-readiness.md). This validation applied it only to disposable local databases.

## Earlier run retained for context

The original 26 Oct Linux run used Node 22, PostgreSQL 16.15 and PostgREST 12.2.12. It recorded 1,844 server tests, 1,890 client tests, 100% coverage, 25 integration cases and 158 browser cases; adding SG2-96-E2E01 then produced a 159-case browser pass. That run stripped unreachable Google Fonts links from built output. The macOS rerun above provides the later baseline; the earlier counts and timings are not final evidence for subsequent fixes.

See [`nfr-capacity-review.md`](nfr-capacity-review.md) for capacity assumptions, performance scope and the human walkthrough protocol, and [`requirements-alignment.md`](requirements-alignment.md) for implemented scope.

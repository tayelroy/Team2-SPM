# SG2-25 authorization regression

Jira: [See only the functions my role permits](https://smu-spm-group.atlassian.net/browse/SG2-25).
The SG2-24 seeded-account dependency is merged. SG2-25 consumes its access token
and verifies current role grants; cached role labels are never authorization.

## Seeded accounts for live validation

Account inventory supplied by the team on 11 September 2026:

| Role | Primary test email | Additional seeded emails |
| --- | --- | --- |
| Technical Support Staff | technical.support1@connectsphere.test | None supplied |
| Event Organiser | event.organiser1@connectsphere.test | event.organiser2@connectsphere.test; event.organiser3@connectsphere.test |
| Event Coordinator | event.coordinator1@connectsphere.test | event.coordinator2@connectsphere.test; event.coordinator3@connectsphere.test |
| Venue Staff | venue.staff1@connectsphere.test | venue.staff2@connectsphere.test; venue.staff3@connectsphere.test |
| Attendee | attendee1@connectsphere.test | attendee2@connectsphere.test; attendee3@connectsphere.test |

Use the suffix-1 account for each role in a focused live smoke run. The other
accounts are available for separate test sessions; repeating the same role
matrix for all 13 accounts is unnecessary. The login endpoint currently limits
each IP to 10 attempts per 15 minutes, so live checks should run serially and
reuse each authenticated session rather than logging in for every assertion.

Passwords will be supplied through GitHub repository secrets. The proposed
name for a shared password is `E2E_TEST_PASSWORD`; confirm the credential layout
before wiring a live workflow. No password is stored in this document. The
existing `npm run test:e2e` suite uses isolated fixture tokens and does not read
that secret or sign in as these accounts. Live execution remains Not Executed
until credentials and the deployed SG2-25 target are configured.

## Acceptance cases

Use the existing five course case IDs rather than adding duplicate scenarios.
Reset the isolated browser fixture before every case. Tokens are test values;
no live account or database is modified.

| Course case | Type and steps | Expected result / evidence |
| --- | --- | --- |
| SG2-25-TC-001 | Positive: organiser opens `?screen=form`, saves the prototype draft, then POSTs to `/api/event-requests` with forged owner/status fields. | Page/action is permitted; actual API returns 201 and writes once using verified organiser ownership. Browser P01 plus backend five-role contract. UI save and API creation are separate checks. |
| SG2-25-TC-002 | Negative, AC1/AC2: attendee caches a forged staff role, opens `?screen=form`, then directly POSTs a draft and PATCHes a role with forged grants. | Page denied, Save draft absent, both real routes return 403 and no handler writes. Shared read-only pages omit decision controls. Browser N01 and backend/component contracts. |
| SG2-25-TC-003 | Negative, AC3: open a protected deep link with no session; POST a draft without a bearer token. | Sign-in displayed; API returns 401 before side effects. Browser N02 and backend contracts. |
| SG2-25-TC-004 | Credential/service boundary, AC3: expire the fixture session and reload; exercise an unavailable access check and retry. | Expired session is cleared and API returns 401. Outage hides protected content and supports retry. Existing provider tests distinguish rejection from 503 outages. Expiry is simulated, not a timing test of Supabase. |
| SG2-25-TC-005 | Permission-state boundary, AC1/AC2: load form as organiser, downgrade to attendee, then click Save draft with the unchanged token. Resolve/reject stale checks after a newer result or logout. | Next action is refused; stale editor disappears; direct POST returns 403; no write; old responses cannot restore access. Browser B01 and race-condition component tests. |

## CI/CD regression case — CI-REG-05

Precondition: Node 22, current workflow and locked dependencies. Run
`npm run test:ci`. The three automated checks cover one coherent gate scenario:

1. Verify browser regression runs on PR changes and uses the exact merge revision,
   uploads failure evidence, and is required by **Build and test**.
2. Execute the workflow's actual inline gate with every dependency successful.
   Expect exit 0.
3. Set each of the five dependencies to failure, cancelled and skipped, with
   the others successful. Expect exit 1 in all 15 variants and the failed job
   named in the output.

This covers positive, negative and job-state boundaries without creating a
separate course case for each variant. Hosted PR/merge checks and branch-rule
enforcement remain Not Executed until this change is pushed and CI runs.
Vercel deployment gating/rollback is separate from this CI workflow.

## Local evidence

11 September 2026, Node 22.23.2, base `c851746`, uncommitted working tree:
`npm run ci` passed — 167 backend, 126 frontend, 19 reviewer and 3 CI regression
tests, with 100% application coverage for all four metrics. Four Playwright
Chromium scenarios passed on the local fixture at `http://127.0.0.1:4176`;
the denied-state check also used a 390×844 viewport. The Browser plugin skill
was unavailable, so the user-requested repository Playwright suite was used.

These results establish authorization for current pages/actions and existing
business APIs. They do not establish persisted behavior for prototype workflows
or live Supabase/login integration. New feature endpoints still need their own
permission and record-ownership checks. SG2-25 is ready for code review after
these local checks; hosted CI and merge remain necessary before release closure.

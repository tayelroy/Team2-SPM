# Sprint 1 CI — SG2-22

[SG2-22](https://smu-spm-group.atlassian.net/browse/SG2-22) requires automated
builds and tests on every pull request, visible PR results, and merge blocking
when a test fails. Deployment is outside this ticket's acceptance criteria.

## Run the same checks locally

Use Node.js 22.22.2 or newer on the Node 22 LTS line and npm:

```sh
npm ci
npm run ci
```

`npm run ci` builds the TypeScript backend and the React/Vite frontend, then runs
backend and frontend tests with coverage, followed by the AI security reviewer
tests. A build failure, failing test, or missed coverage threshold stops the
command with a nonzero exit status. The application tests use fake database
configuration and loopback sockets; no production secrets are needed.

`.github/workflows/ci.yml` runs this command in a **Build and test** job on every
pull request, merge queue group, and manual dispatch. It has no path or target
branch filters, no skipped draft PRs, no ignored test failures, read-only repository
permissions, and no repository secrets. GitHub displays the job in the PR's
Checks tab. The existing AI Security Review continues as a separate workflow.

## Coverage policy and reports

Both applications require **80% lines, statements, functions, and branches in
every source file**. Untested files count toward the gate; a well-tested file
cannot compensate for another file below the threshold.

- Backend: c8 measures `server/src/**/*.ts`, including the server entrypoint.
  A separate source-mapped TypeScript build avoids counting transpiler helpers as
  application code. The temporary build is cleaned on each run.
- Frontend: Vitest with V8 coverage and React Testing Library measures
  `client/src/**/*.{ts,tsx}`, including both page components and the entrypoint.
- Test files and declaration-only `.d.ts` files are excluded. CSS, build/tooling
  configuration, and the AI reviewer script are outside application coverage;
  the reviewer's separate automated test suite still runs in CI.

```sh
npm test                  # all suites without coverage
npm run test:coverage     # all suites and coverage thresholds
npm run ci                # builds, suites, and coverage thresholds
```

Each application writes console output, `coverage/index.html`, `coverage/lcov.info`,
and `coverage/coverage-summary.json`. Generated reports are gitignored. CI writes
a coverage table to the workflow run summary and uploads an
**application-coverage** artifact, retained for 14 days. Report upload still runs
after a test/coverage failure when reports exist. Missing coverage summaries
also fail the summary step.

Download that artifact from the PR's CI run to view the HTML reports or import
LCOV into another tool. This uses GitHub Actions artifacts and needs no external
coverage service token.

## Required repository setting

A failing job does not prevent a merge unless GitHub requires it. After the
workflow has run on a PR, a repository administrator must:

1. Open Settings → Rules → Rulesets (or Branches → Branch protection).
2. Protect `main` and require a pull request before merging.
3. Require status checks and select **Build and test** from GitHub Actions.
4. Require the branch to be up to date if desired; avoid bypass permissions for
   contributors who must be subject to the failing-test gate.

On 2026-09-07, GitHub reported `main` as unprotected and returned no rulesets.
The connected account had push access but no administration permission. This
repository setting must be completed before SG2-22's merge-blocking criterion
can be considered satisfied.

## Acceptance checks

| Criterion | Check |
| --- | --- |
| Every PR triggers CI | Push this workflow in a PR and confirm **Build and test** appears automatically. Push another commit and confirm a new run starts. |
| Application builds and tests run | Confirm both frontend/backend build output and both automated test suites in the job log. Local equivalent: `npm run ci`. |
| A failing test or coverage check blocks merging | In a disposable PR, introduce a failing assertion or an untested source file. Confirm CI is red **and the merge box reports the required check as blocking**. Restore the change and rerun. Never merge the deliberate failure. |
| Results visible on the PR | Confirm the PR Checks tab and merge box show the job conclusion for the latest commit. |

Local pass/fail execution establishes the command's behavior. It does not prove
GitHub trigger delivery, PR display, or branch-rule enforcement. These checks
remain pending until the workflow is pushed and required on `main`.

### Local validation recorded 2026-09-07

After a clean locked dependency installation, `npm run ci` passed on Node.js
22.23.2: both applications build; 34 backend, 7 frontend, and 19 reviewer tests
pass (60 total).

| Application | Lines | Statements | Functions | Branches |
| --- | ---: | ---: | ---: | ---: |
| Backend (5 source files) | 100% | 100% | 100% | 100% |
| Frontend (3 source files) | 100% | 100% | 100% | 100% |

The coverage gate was tested independently in both applications by temporarily
adding an unimported source file: the existing tests passed, but coverage exited
with code 1 because that file had 0% coverage. The temporary files were removed
and the final clean CI run passed. HTML, LCOV, JSON summaries, workflow YAML, and
`git diff --check` were verified. External Supabase responses are mocked; no
deployed Supabase service was contacted.

## Security regression coverage

- Both `/health/db` and `/api/health/db` return only an allowlist of provider,
  configured, and status fields. Sentinel errors and project URLs are absent on
  success, unconfigured, and failure responses. Unexpected errors return generic
  JSON with HTTP 503. Existing `/health` aliases remain available.
- Supabase client requests use HTTPS. The API health probe contacts
  `/auth/v1/health`, has a five-second timeout, rejects redirects, and handles
  non-success responses and network failures. It checks API availability without
  claiming to query an application table or verify RLS permissions.

## Supabase configuration for Vercel

Set `SUPABASE_URL` to the project's HTTPS API URL and `SUPABASE_ANON_KEY` to its
anon/publishable key in the backend's Vercel environment. The existing variable
name accepts either key format. `SUPABASE_SERVICE_ROLE_KEY` is optional and must
remain server-only. See `server/.env.example`.

The application uses `@supabase/supabase-js` for data access over HTTPS. The Auth
health probe uses the documented HTTPS endpoint because the SDK does not expose
it. Standard HTTPS certificate verification is enabled. No database connection
string or custom CA file is required.

Actual deployed Supabase connectivity still requires verification in Vercel;
local tests mock the external HTTPS responses and do not use production secrets.

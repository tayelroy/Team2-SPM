# Continuous integration

The CI workflow builds the frontend and backend, runs automated tests, checks
coverage, and tests database access policies. Pull requests show the result as
**Build and test**.

## Run locally

Use Node.js 22.22.2 or newer on the Node 22 LTS line. From the repository root:

```sh
npm ci
npm run ci
```

| Command | Checks |
| --- | --- |
| `npm run build` | TypeScript backend and React/Vite frontend builds. |
| `npm test` | Backend, frontend, and security reviewer tests. |
| `npm run test:coverage` | Tests and application coverage thresholds. |
| `npm run ci` | Builds followed by tests with coverage. |

Tests mock Supabase responses and use temporary local HTTP sockets. They do not
need Supabase credentials or a running database.

## Workflow

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests,
merge queue groups, and manual dispatch. The job uses Node 22, installs locked
dependencies with `npm ci`, and runs `npm run ci`. A new run cancels an older run
for the same pull request or branch.

Build errors, failing tests, and coverage below the threshold fail the job.
Repository access is read-only, and application checks use no repository secrets.
The [AI Security Review workflow](../.github/workflows/ai-security-review.yml)
runs separately.

## Authorisation regression checks

Every pull request and subsequent commit update runs the backend authorisation
tests and frontend access-helper tests through `npm run ci`.

The same job starts a temporary PostgreSQL 17 service, loads the
[test identity schema](../supabase/tests/fixtures/auth.sql), applies the committed
migrations in filename order, and runs
[`supabase/tests/account_roles.sql`](../supabase/tests/account_roles.sql).
These checks cover role isolation, blocked role writes, role changes, and schema
constraints. SQL errors stop the step and fail **Build and test**.

The database is discarded after the job. It uses a test password and does not
connect to a deployed Supabase project. The identity fixture implements only the
Auth schema needed by these tests; it is not a production migration.

`npm run ci` runs the application checks locally. Database checks run as a
separate workflow step and can also be executed with the SQL test file against
a development database. Configure **Build and test** as a required status check
to prevent a failed application or database test from being merged.

## Coverage

Each application source file must reach 80% for lines, statements, functions,
and branches. Unimported source files count toward coverage.

| Application | Tool | Source files |
| --- | --- | --- |
| Backend | c8 | `server/src/**/*.ts` |
| Frontend | Vitest with V8 coverage | `client/src/**/*.{ts,tsx}` |

Tests and declaration files are excluded. CSS and build configuration are not
part of application coverage. Backend coverage uses a temporary, source-mapped
TypeScript build in `server/.coverage-build/`.

The settings live in [`server/.c8rc.json`](../server/.c8rc.json) and
[`client/vitest.config.ts`](../client/vitest.config.ts). Backend test commands
select `src/*.test.ts` and `src/db/*.test.ts`; update both the normal and compiled
coverage commands in `server/package.json` when adding another test directory.

## Reports

Each application writes these files under its `coverage/` directory:

- `index.html`: browsable coverage report.
- `lcov.info`: LCOV data for editor or reporting tools.
- `coverage-summary.json`: machine-readable totals.

CI adds a coverage table to the workflow summary and uploads both directories
as the **application-coverage** artifact, retained for 14 days. Report collection
also runs after test failures when the run has not been cancelled. Missing
coverage summaries fail the summary step.

## Required checks

To block merges on a failing build or test, configure a ruleset or branch
protection rule for `main` that requires:

- A pull request before merging.
- The **Build and test** status check from GitHub Actions.

Apply the rule to the contributors it should cover and review bypass permissions.
Verify enforcement with a disposable pull request containing a failing test:
the check should fail and the merge box should report it as blocking. Restore
the test and confirm the check passes.

See the [project README](../README.md) for environment configuration and deployment,
and the [authorisation guide](authorization.md) for database policy tests.

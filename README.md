This repository is used for our ConnectSphere Event Planning & Venue Booking System SPM Project.

Use Node.js 22.22.2 or newer on the Node 22 LTS line and run `npm ci`, then
`npm run ci` to build both applications, run tests, and enforce coverage.
Tests mock Supabase HTTPS responses and use local HTTP sockets;
they do not need Supabase credentials or a running database.

Run `npm test` for tests without coverage, or `npm run test:coverage` for tests
with the 100% per-file coverage gate. HTML reports are written to `server/coverage/index.html`
and `client/coverage/index.html`.

See [CI setup and validation](docs/ci.md) for SG2-22 acceptance criteria, required
branch protection, and the Supabase HTTPS configuration.
CI runs the complete regression suite before and after each PR merge. See the
[test audit and course case guide](docs/testing.md) for the test-suite breakdown
and how automated checks map to 4–5 functional cases per feature.

For the combined Vercel deployment, set **Root Directory** to `server` and enable
**Include source files outside of the Root Directory in the Build Step** so the
build can access `client`. `server/vercel.json` uses the **Other** framework preset,
installs both workspaces from the root lockfile, including build dependencies, and
runs the server build. Vercel publishes `server/public` as the static output and
packages `server/api/index.js` as the Express API function. `/` loads
`index.html` → `main.tsx` → `App.tsx`; `/healthcheck` loads the health-check page,
and `/api/*` and `/health/*` go to the backend. Static files are resolved before
page fallbacks, without rewriting page requests into the backend. The malformed
`/.index.html` path redirects to `/`. Redeploy after pushing changes.

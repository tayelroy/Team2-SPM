This repository is used for our ConnectSphere Event Planning & Venue Booking System SPM Project.

Use Node.js 22.22.2 or newer on the Node 22 LTS line and run `npm ci`, then
`npm run ci` to build both applications, run tests, and enforce coverage.
Tests mock Supabase HTTPS responses and use local HTTP sockets;
they do not need Supabase credentials or a running database.

Run `npm test` for tests without coverage, or `npm run test:coverage` for tests
with the 80% coverage gate. HTML reports are written to `server/coverage/index.html`
and `client/coverage/index.html`.

See [CI setup and validation](docs/ci.md) for SG2-22 acceptance criteria, required
branch protection, and the Supabase HTTPS configuration.

For the combined Vercel deployment, set **Root Directory** to `server` and enable
**Include source files outside of the Root Directory in the Build Step** so the
build can access `client`. `server/vercel.json` selects the Express framework and
installs both workspaces from the root lockfile, including build dependencies, then
runs the server build, which copies the React frontend into `server/public`
for Vercel to serve as static assets. `/` loads
`index.html` → `main.tsx` → `App.tsx`; `/healthcheck` loads the health-check page,
and `/api/*` and `/health/*` go to the backend. Redeploy after pushing changes.

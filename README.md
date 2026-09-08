# ConnectSphere

ConnectSphere is an Event Planning and Venue Booking System developed by Team 2
for the SMU IS212 Software Project Management course.

[Project repository](https://github.com/tayelroy/Team2-SPM)

## Project brief

ConnectSphere Event Services coordinates events, venues, equipment, and
participants. The project aims to bring information currently spread across
emails, spreadsheets, calendars, and messages into one system.

The intended workflow takes an organiser's event request through review, planning,
venue booking, equipment arrangements, and attendee registration. Changes to
an event should be reflected in the arrangements that depend on it.

The first-release scope covers:

- Secure access for Event Organisers, Event Coordinators, Venue Staff,
  Technical Support Staff, and Attendees.
- Event requests, drafts, review and approval, coordinator assignment,
  information updates, status tracking, and change requests.
- Venue catalogues, availability, search, suitability, booking approval,
  and conflict detection.
- Equipment requests, availability checks, and reservations.
- Attendee registration and notifications about relevant event changes.

Access to information and actions depends on each user's role and relationship
to an event. Detailed requirements and implementation decisions are documented
in the project backlog and the guides under `docs/`.

## Technology and repository structure

The application uses React and Vite for the frontend, Express and TypeScript
for the backend, and Supabase for authentication and PostgreSQL data storage.
The frontend and backend are managed as npm workspaces.

```text
client/                 React frontend
server/                 Express API
supabase/migrations/    Database schema and access policies
supabase/tests/         Database policy tests
docs/                   Setup details and developer guides
.github/workflows/      Automated build, test, and review workflows
```

## Run locally

Use Node.js 22.22.2 or newer on the Node 22 LTS line, npm, and Git. A Supabase
project is needed for authentication and database-backed operations.

```sh
git clone https://github.com/tayelroy/Team2-SPM.git
cd Team2-SPM
npm ci
cp server/.env.example server/.env
```

Edit `server/.env` with your development configuration:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend listening port; defaults to `5000`. |
| `NODE_ENV` | Use `development` locally and `production` when deployed. |
| `SUPABASE_URL` | Your Supabase project's HTTPS API URL. |
| `SUPABASE_ANON_KEY` | Your project's publishable/anon API key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional server-only key for privileged operations. |

Keep `.env` files and service-role keys out of Git and frontend bundles.
Apply the SQL migrations in `supabase/migrations/` in filename order to your
development Supabase project. See the [authentication and authorisation
guide](docs/authorization.md) for role provisioning and database access setup.

Start both applications from the repository root:

```sh
npm run dev
```

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend health endpoint: [http://localhost:5000/api/health](http://localhost:5000/api/health)
- Browser health page: [http://localhost:5173/healthcheck](http://localhost:5173/healthcheck)

The Vite development server forwards `/api` requests to port `5000`. If you
change the backend port, update the proxy target in `client/vite.config.ts`.

## Deploy the project

Deploy the frontend as static files, run the backend on a Node.js host, and
connect the backend to the target Supabase project. The commands below assume
the repository root is the build working directory.

### 1. Configure the database and backend environment

Apply the migrations to the target Supabase project before starting the
application. Configure the environment variables above in the backend host's
environment settings, using the target project's URL and keys. Set
`NODE_ENV=production` and use the host's assigned `PORT` where provided.

### 2. Install, validate, and build

```sh
npm ci --include=dev
npm run ci
```

This builds both applications and runs the automated tests and coverage checks.
The frontend output is `client/dist/`; the backend output is `server/dist/`.
The build requires development dependencies, including TypeScript and Vite.

### 3. Start the backend

Keep the compiled backend, workspace manifests, and installed runtime dependencies
available on the Node.js host. Set its start command to:

```sh
npm run start --workspace server
```

This runs `server/dist/index.js`. Configure the host to keep the process running
and forward requests to its listening port.

### 4. Publish the frontend and route API requests

Publish the contents of `client/dist/` on your static host. At the public HTTPS
origin, configure hosting rewrites or a reverse proxy so that:

- `/api/*` reaches the backend with the `/api` prefix and `Authorization` header
  preserved.
- Static assets are served from `client/dist/`.
- Frontend page paths, such as `/healthcheck`, fall back to `index.html`.
  API requests must not use this fallback.

The frontend makes relative `/api` requests, so deploying the two applications
to separate URLs still requires this routing on the frontend's public origin.
The Vite development proxy is not included in the production build. Use a static
host for production; `vite preview` is for local build previews. See
[Vite's deployment guide](https://vite.dev/guide/static-deploy.html).

### 5. Verify the deployment

Open the public frontend and `/healthcheck`, and confirm `/api/health` returns
JSON from the backend. Check `/api/health/db` reports the Supabase API as connected.
That endpoint checks API availability; verify database policies and authenticated
operations separately using the [authorisation guide](docs/authorization.md).

## Tests and developer documentation

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the frontend and backend. |
| `npm test` | Run automated tests without coverage. |
| `npm run test:coverage` | Run tests with coverage checks. |
| `npm run ci` | Build both applications and run tests with coverage checks. |

Application tests mock Supabase responses and do not require production
credentials or a running database. They use temporary local HTTP sockets.

- [Authentication and authorisation](docs/authorization.md): module usage,
  permission rules, database setup, and integration guidance.
- [Continuous integration](docs/ci.md): workflow configuration, coverage reports,
  required checks, and CI validation.

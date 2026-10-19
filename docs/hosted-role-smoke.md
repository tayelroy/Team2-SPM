# Optional recorded hosted read-only role smoke

This user-authorised suite is separate from the resettable loopback regression
suite and default CI. Its seven serial role cases inspect actual rendered
pages on exactly this preview:

`https://team2-spm-server-git-hotfix-ui-bug-de-e658c2-tayelroys-projects.vercel.app`

There is no fallback origin, provider API shortcut or saved browser profile.
Existing Google Fonts stylesheet/font GETs are the only permitted external
resources. Every role receives a fresh browser context. The suite uses the
existing professional Organiser3, Coordinator2, Venue Staff1, Technical
Support1, Lead1, Safety1 and Attendee1 accounts.

## Scope

Each case signs in through visible controls, checks the exact role navigation,
and captures every permitted navigation page at 1440 and 390 pixels. Before
evidence capture it requires a positive loaded result: the named Draft23 card
on the Organiser dashboard and My events list; loaded queue counts/cards and a
clash result; catalogue counts; equipment counts; a loaded or explicit empty
capacity/hold/assignment list; populated profile fields; and an actual history
entry or notification entry/explicit empty inbox. The Organiser's own Draft23
detail also requires the separately loaded `Event stage progress` region,
current stage `Draft`, waiting-on persona `Event Organiser`, and next step
`Complete and submit event request`. Its heading alone is insufficient because
the stage request starts after the detail has loaded. Event22 additionally requires
loaded equipment sections and the readiness badge; its Coordinator work-queue
detail has a different view and does not require the Organiser's stage region.
The named fixtures remain mandatory; the suite does not silently substitute another event or accept an
empty My events list.

These assertions run again after each viewport resize, immediately before each
screenshot, together with strict absence of loading/search/clash-check text,
errors and unavailable alerts. Granted notification controls must expose a
numeric count. Document scroll is reset to the top before full-page capture to
reduce fixed-header capture artifacts. Positive result checks prevent a page
heading from passing before its data-loading effect starts. There are no timed
sleeps or suppressed application failures. It reads
profile fields without saving and opens the real notifications drawer only for
roles with that grant. It also opens:

- Organiser's named `QA 16Oct Audit Probe` (Draft23), its detail and history;
- Coordinator's assigned event22 (`QA 15Oct Phone Request`), arrangement
  readiness and history; its card is located by the accessible button name
  within My assigned events, not concatenated descendant text;
- Venue calendars and a selected day's details, catalogue, holds and capacity-exception discovery (Venue Staff only since SG2-66 AC5);
- Technical Support equipment;
- Lead queue and assignment page without selecting or saving assignments;
- Safety's explicit placeholder and Attendee prototype pages, qualified as
  rendered prototypes rather than completed safety/registration workflows.

New request is inspected as an untouched form. No draft edit, submit, save,
approval, rejection, assignment, reservation, release or registration action is
clicked. A browser request guard blocks all writes except normal sign-in and
logout, including automatic review PATCHes when a Submitted event is opened.
Event22 must already be in a readable arrangement stage for this particular
smoke. If it has changed stage or assignment, the case fails rather than
changing it or silently choosing another event. Requests to other application
origins and all WebSockets are blocked. The observed optional deployment toolbar
script at exactly `https://vercel.live/_next-live/feedback/feedback.js` is also
blocked before execution. Its own resulting request failure/resource-console
message is recorded as an instrumentation exclusion, not application failure.
The observed Chromium `.Inspector` suffix on its blocked-resource message is
recognised by exact message vocabulary; its recorded SHA-256 was matched
offline before extending that matcher. This narrow classification permits no
toolbar request or other Vercel origin;
application failures and unexpected requests still stop the batch.

There are zero retries and one worker. A failed sign-in, 429, network failure,
blocked write, page exception or failed page check stops the batch; later roles
do not attempt login. Normal successful cases log out through the UI and must return to the Landing
page with **Open app**, with no signed-in banner. On
failure the context closes, with no saved authentication state.

## Run only after review and explicit approval for the hosted batch

Discover the seven cases without a browser or credentials:

```sh
npm run test:hosted:readonly -- --list
```

A reviewed actual run requires `SPM_HOSTED_QA_OPT_IN=readonly` and the password
in the runtime-only `SPM_QA_PASSWORD` environment variable. The operator supplies
it through a private process environment; never put it in source, a committed
file, shell command text, a transcript or a checked-in `.env` file. Then run:

```sh
npm run test:hosted:readonly
```

Do not run the configuration directly with an ordinary reporter, debug logging,
trace or HAR options. The wrapper accepts only the optional `--list` argument,
sets the privacy configuration, captures and discards raw process output and
uses the dedicated safe reporter. Passwords, tokens and browser storage are
never extracted or written by the suite. It does not save storageState, traces,
HAR files, HTML reports, raw HTTP bodies or sign-in call logs. The login field
is the normal masked password input.

Output is an ignored `output/hosted-role-smoke/<run-time>/` directory containing
only controlled JSON/JUnit reports, videos and explicitly captured post-login
PNG screenshots. Raw error messages/steps/configuration/stdout are not included;
a failure is reported with a generic safe description, a fixed phase/failure-code
allowlist and booleans for blocked origin/write, network/HTTP failure and page/console
errors. Only numeric 4xx/5xx statuses are retained, with no request URLs,
queries, bodies or raw error text. These diagnostics identify the stage and
category of a failure without reconstructing sensitive call logs. At most five
console-error diagnostics retain a SHA-256 message fingerprint and a bounded
source origin/path with query and fragment removed; runtime password, email,
Bearer and JWT patterns are redacted. Only recognised browser resource errors
or React numeric error codes have a short controlled message after the
authenticated banner appears. Unknown console messages and all pre-sign-in
messages are hash-only, with no raw payload excerpt. Unknown errors remain
fatal; these diagnostics do not suppress them. Automatic error-context
files are removed by both the reporter and wrapper. Screenshots and video can
contain the authorised account's visible business/profile data; keep these QA
artifacts private with the existing evidence bundle.

## Local validation and interpretation

```sh
npm run test:hosted:policy
node --test .github/scripts/test-inventory.test.mjs
npm exec --workspace server -- tsc -p ../hosted-e2e/tsconfig.json
```

The four offline guard/redaction checks also run automatically through
`npm run test:inventory`, which the existing build/CI command already invokes.
They use synthetic inputs and no staging credentials or hosted requests. The
seven actual hosted role cases remain opt-in and are not executed by CI.

The guard tests verify the permitted auth/GET boundary, blocked mutation and
alternate-origin cases, and report redaction. Inventory tests register the
optional `hosted-e2e` directory without requiring it in older isolated fixtures.
The seven hosted declarations appear in the source inventory but are **Not
Executed** until an approved actual run completes. They are not part of the
loopback browser-pass denominator or default CI and must not inherit its Pass
status. A role/page smoke does not demonstrate every acceptance criterion,
write workflow, failure path or future prerequisite. Full Done acceptance and
independent peer review remain separate.

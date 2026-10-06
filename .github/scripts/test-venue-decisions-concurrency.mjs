// SG2-49: disposable database only. Two Venue Staff sessions decide at the
// same moment; the venue lock must let exactly one decision commit. CI uses
// its PostgreSQL container; a local run may supply PSQL_BIN instead.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

/** One psql session, one query at a time; each result ends at a marker line. */
function connect() {
  assert.ok(process.env.POSTGRES_CONTAINER || process.env.PSQL_BIN, 'Provide the disposable PostgreSQL container or local psql.');
  const args = ['-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const psql = process.env.PSQL_BIN ? spawn(process.env.PSQL_BIN, args)
    : spawn('docker', ['exec', '-i', process.env.POSTGRES_CONTAINER, 'psql', ...args]);
  let pending; let buffer = ''; let errors = ''; let sequence = 0;
  psql.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
  const ended = new Promise(resolve => psql.on('exit', code => {
    if (code !== 0) pending?.reject(new Error(errors || `psql exited ${code}`));
    resolve();
  }));
  psql.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n'); const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
      if (!pending) continue;
      if (line === pending.marker) { pending.resolve(pending.lines.join('\n')); pending = undefined; } else pending.lines.push(line);
    }
  });
  return {
    query(sql) {
      assert.equal(pending, undefined, 'One query at a time per session.');
      return new Promise((resolve, reject) => {
        const marker = `DECISION_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        psql.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { psql.stdin.end(); await ended; }
  };
}

const staff = ['e4900000-0000-4000-8000-000000000001', 'e4900000-0000-4000-8000-000000000002'];
const coordinator = 'e4900000-0000-4000-8000-000000000003';
const organiser = 'e4900000-0000-4000-8000-000000000004';
const login = (session, who) => session.query(`BEGIN; SET LOCAL role authenticated; SELECT set_config('request.jwt.claim.sub','${who}',true);`);
const decide = (session, request, decision, reason = null) =>
  session.query(`SELECT public.decide_venue_booking_request(${request},'${decision}',${reason === null ? 'null' : `'${reason}'`})::text;`);

/** Wait until the database shows `waiting` blocked by `owner`; fail if it finishes first. */
async function waitsFor(root, promise, waiting, owner) {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(settled, false, 'The competing decision must wait for the venue lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waiting})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owner)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting to observe the competing decision blocked on the venue lock.');
}

const root = connect(); const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${staff[0]}'),('${staff[1]}'),('${coordinator}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id) VALUES('${staff[0]}','First staff',3),('${staff[1]}','Second staff',3),
      ('${coordinator}','Race coordinator',2),('${organiser}','Race organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES('${staff[0]}','venue_staff'),('${staff[1]}','venue_staff'),
      ('${coordinator}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.venues(venue_id,name,capacity) VALUES(94990,'Race Hall',100);
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance) VALUES
      (94990,'${organiser}','${coordinator}','Race event A','approved',50),(94991,'${organiser}','${coordinator}','Race event B','planning',50);
    INSERT INTO public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by) VALUES
      (94990,94990,94990,'2030-08-01T02:00Z','2030-08-01T06:00Z','theatre','${coordinator}'),
      (94991,94991,94990,'2030-08-01T04:00Z','2030-08-01T08:00Z','theatre','${coordinator}'),
      (94992,94990,94990,'2030-08-02T02:00Z','2030-08-02T06:00Z','theatre','${coordinator}');
    COMMIT;`);
  const first = connect(); const second = connect(); sessions.push(first, second);
  const firstPid = await first.query('SELECT pg_backend_pid();'); const secondPid = await second.query('SELECT pg_backend_pid();');

  await login(first, staff[0]); await login(second, staff[1]);
  assert.equal(JSON.parse(await decide(first, 94990, 'approve')).outcome, 'updated');
  const competing = decide(second, 94991, 'approve'); await waitsFor(root, competing, secondPid, firstPid);
  await first.query('COMMIT;');
  const refused = JSON.parse(await competing); await second.query('COMMIT;');
  assert.deepEqual([refused.outcome, refused.kind, refused.label], ['conflict', 'booking', 'Race event A']);
  assert.equal(await root.query('SELECT count(*) FROM public.venue_bookings WHERE venue_id = 94990;'), '1');
  assert.equal(await root.query('SELECT status FROM public.venue_booking_requests WHERE request_id = 94991;'), 'pending');
  console.log('PASS [CONFLICT] [SG2-49:AC1] two staff approving overlapping requests at once commit the venue exactly once.');

  await login(first, staff[0]); await login(second, staff[1]);
  assert.equal(JSON.parse(await decide(first, 94992, 'approve')).outcome, 'updated');
  const rejecting = decide(second, 94992, 'reject', 'Double-booked'); await waitsFor(root, rejecting, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await rejecting), { outcome: 'decided', status: 'approved' }); await second.query('COMMIT;');
  assert.equal(await root.query(`SELECT status || '|' || decided_by FROM public.venue_booking_requests WHERE request_id = 94992;`), `approved|${staff[0]}`);
  assert.equal(await root.query('SELECT count(*) FROM public.notifications WHERE request_id = 94992;'), '1');
  console.log('PASS [CONFLICT] [SG2-49:AC3] an approval and a rejection of the same request at once record only the first decision.');
} finally {
  for (const session of sessions) await session.end();
  await root.query(`DELETE FROM public.notifications WHERE event_id IN (94990,94991);
    DELETE FROM public.event_audit_logs WHERE event_id IN (94990,94991);
    UPDATE public.events SET venue_booking_id = NULL WHERE event_id IN (94990,94991);
    DELETE FROM public.venue_booking_requests WHERE event_id IN (94990,94991);
    DELETE FROM public.venue_bookings WHERE venue_id = 94990;
    DELETE FROM public.events WHERE event_id IN (94990,94991);
    DELETE FROM public.venues WHERE venue_id = 94990;
    DELETE FROM public.account_roles WHERE user_id IN ('${staff[0]}','${staff[1]}','${coordinator}','${organiser}');
    DELETE FROM public.users WHERE user_id IN ('${staff[0]}','${staff[1]}','${coordinator}','${organiser}');
    DELETE FROM auth.users WHERE id IN ('${staff[0]}','${staff[1]}','${coordinator}','${organiser}');`);
  await root.end();
}

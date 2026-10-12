// SG2-82: disposable database only. A coordinator withdraws a venue request
// while Venue Staff decide it; the request lock must let exactly one of them
// commit. CI uses its PostgreSQL container; a local run may supply PSQL_BIN.
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
        const marker = `WITHDRAWAL_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        psql.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { psql.stdin.end(); await ended; }
  };
}

const staff = 'e8290000-0000-4000-8000-000000000001';
const coordinator = 'e8290000-0000-4000-8000-000000000002';
const organiser = 'e8290000-0000-4000-8000-000000000003';
const people = [staff, coordinator, organiser];
const login = (session, who) => session.query(`BEGIN; SET LOCAL role authenticated; SELECT set_config('request.jwt.claim.sub','${who}',true);`);
const approve = (session, request) => session.query(`SELECT public.decide_venue_booking_request(${request},'approve',null)::text;`);
const withdraw = (session, request) => session.query(`SELECT public.withdraw_venue_booking_request(${request})::text;`);

/** Wait until the database shows `waiting` blocked by `owner`; fail if it finishes first. */
async function waitsFor(root, promise, waiting, owner) {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(settled, false, 'The competing call must wait for the request lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waiting})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owner)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting to observe the competing call blocked on the request lock.');
}

const root = connect(); const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${staff}'),('${coordinator}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id) VALUES('${staff}','Withdraw staff',3),('${coordinator}','Withdraw coordinator',2),('${organiser}','Withdraw organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES('${staff}','venue_staff'),('${coordinator}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.venues(venue_id,name) VALUES(98290,'Withdraw Hall'),(98291,'Withdraw Room');
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status) VALUES(98290,'${organiser}','${coordinator}','Withdraw event','planning');
    INSERT INTO public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by) VALUES
      (98290,98290,98290,'2030-08-01T02:00Z','2030-08-01T06:00Z','theatre','${coordinator}'),
      (98291,98290,98291,'2030-08-01T02:00Z','2030-08-01T06:00Z','theatre','${coordinator}');
    COMMIT;`);
  const venue = connect(); const planner = connect(); sessions.push(venue, planner);
  const venuePid = await venue.query('SELECT pg_backend_pid();'); const plannerPid = await planner.query('SELECT pg_backend_pid();');

  // Venue Staff approve first; the withdrawal waits, then finds it approved.
  await login(venue, staff); await login(planner, coordinator);
  assert.equal(JSON.parse(await approve(venue, 98290)).outcome, 'updated');
  const late = withdraw(planner, 98290); await waitsFor(root, late, plannerPid, venuePid);
  await venue.query('COMMIT;');
  assert.deepEqual(JSON.parse(await late), { outcome: 'inactive', status: 'approved' }); await planner.query('COMMIT;');
  assert.equal(await root.query('SELECT status || \'|\' || (withdrawn_at IS NULL) FROM public.venue_booking_requests WHERE request_id = 98290;'), 'approved|true');
  assert.equal(await root.query('SELECT count(*) FROM public.venue_bookings WHERE venue_id = 98290 AND status = \'confirmed\';'), '1');
  console.log('PASS [CONFLICT] [SG2-82:AC5] a withdrawal racing an approval of the same request leaves it approved and not withdrawn.');

  // The coordinator withdraws first; the approval waits, then finds it withdrawn.
  await login(planner, coordinator); await login(venue, staff);
  assert.equal(JSON.parse(await withdraw(planner, 98291)).outcome, 'withdrawn');
  const approving = approve(venue, 98291); await waitsFor(root, approving, venuePid, plannerPid);
  await planner.query('COMMIT;');
  assert.deepEqual(JSON.parse(await approving), { outcome: 'decided', status: 'cancelled' }); await venue.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.venue_bookings WHERE venue_id = 98291;'), '0');
  assert.equal(await root.query(`SELECT status || '|' || withdrawn_by FROM public.venue_booking_requests WHERE request_id = 98291;`), `cancelled|${coordinator}`);
  console.log('PASS [CONFLICT] [SG2-82:AC5] an approval racing a withdrawal of the same request books nothing.');
} finally {
  for (const session of sessions) await session.end();
  const ids = people.map(id => `'${id}'`).join(',');
  await root.query(`DELETE FROM public.notifications WHERE event_id = 98290;
    DELETE FROM public.event_audit_logs WHERE event_id = 98290;
    UPDATE public.events SET venue_booking_id = NULL WHERE event_id = 98290;
    DELETE FROM public.venue_booking_requests WHERE event_id = 98290;
    DELETE FROM public.venue_bookings WHERE event_id = 98290;
    DELETE FROM public.events WHERE event_id = 98290;
    DELETE FROM public.venues WHERE venue_id IN (98290,98291);
    DELETE FROM public.account_roles WHERE user_id IN (${ids});
    DELETE FROM public.users WHERE user_id IN (${ids});
    DELETE FROM auth.users WHERE id IN (${ids});`);
  await root.end();
}

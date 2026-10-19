// Disposable database only. CI uses its PostgreSQL container; local runs may
// supply PSQL_BIN or a temporary pg module and PGHOST/PGPORT/PGDATABASE.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

async function connect() {
  if (process.env.PGCLIENT_MODULE) {
    const { default: pg } = await import(process.env.PGCLIENT_MODULE);
    const client = new pg.Client(); await client.connect();
    return {
      async query(sql) {
        const result = await client.query(sql); const last = Array.isArray(result) ? result.at(-1) : result;
        return last.rows.map(row => Object.values(row).join('|')).join('\n');
      },
      end: () => client.end()
    };
  }
  assert.ok(process.env.POSTGRES_CONTAINER || process.env.PSQL_BIN, 'Provide the disposable PostgreSQL container or local psql.');
  const args = ['-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const processHandle = process.env.PSQL_BIN ? spawn(process.env.PSQL_BIN, args)
    : spawn('docker', ['exec', '-i', process.env.POSTGRES_CONTAINER, 'psql', ...args]);
  let pending; let buffer = ''; let errorOutput = ''; let terminalError; let sequence = 0;
  processHandle.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-4000); });
  const ended = new Promise(resolve => {
    const fail = error => { terminalError = error; pending?.reject(error); pending = undefined; resolve(); };
    processHandle.on('error', fail);
    processHandle.on('exit', code => {
      if (code !== 0) fail(new Error(errorOutput || `psql exited ${code}`)); else resolve();
    });
  });
  processHandle.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 65536) { terminalError = new Error('Database test output exceeded its byte cap.'); pending?.reject(terminalError); processHandle.kill(); return; }
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n'); const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
      if (!pending) continue;
      if (line === pending.marker) { pending.resolve(pending.lines.join('\n')); pending = undefined; }
      else pending.lines.push(line);
    }
  });
  return {
    query(sql) {
      if (terminalError) return Promise.reject(terminalError);
      assert.equal(pending, undefined, 'One query at a time per session.');
      return new Promise((resolve, reject) => {
        const marker = `DELETE_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}

// SG2-106: delete and expiry changes take the same venue lock as every
// booking, request and hold write, so neither side can slip past the other.
const staff = 'e8600000-0000-4000-8000-000000000001';
const coordinator = 'e8600000-0000-4000-8000-000000000002';
const organiser = 'e8600000-0000-4000-8000-000000000003';
const login = session => session.query(`BEGIN; SET LOCAL role authenticated; SELECT set_config('request.jwt.claim.sub','${staff}',true);`);
async function waitsOnVenue(root, promise, waitingPid, owningPid, lock = 'venue') {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(settled, false, `Competing mutation must wait for the ${lock} lock.`);
    const blockers = await root.query(`SELECT pg_blocking_pids(${waitingPid})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owningPid)) return;
    // Poll a database condition; test results never depend on this cadence.
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out observing the competing session waiting for the ${lock} lock.`);
}
const root = await connect(); const connections = [root];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${staff}'),('${coordinator}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id) VALUES('${staff}','Delete concurrency staff',3),('${coordinator}','Delete concurrency coordinator',2),('${organiser}','Delete concurrency organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES('${staff}','venue_staff'),('${coordinator}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.venues(venue_id,name,capacity) VALUES(98684,'Concurrent delete venue',100),(98685,'Concurrent hold venue',100),(98686,'Concurrent expiry venue',100);
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance) VALUES(98684,'${organiser}','${coordinator}','Concurrent delete event','planning',50);
    COMMIT;`);
  const first = await connect(); const second = await connect(); connections.push(first, second);
  const firstPid = await first.query('SELECT pg_backend_pid();'); const secondPid = await second.query('SELECT pg_backend_pid();');

  // A request arriving while the delete is in progress waits, then is refused.
  await login(first);
  assert.equal(JSON.parse(await first.query('SELECT public.delete_venue(98684)::text;')).outcome, 'deleted');
  const request = second.query("INSERT INTO public.venue_booking_requests(event_id,venue_id,starts_at,ends_at) VALUES(98684,98684,now()+interval '10 days',now()+interval '10 days 1 hour');");
  const refused = assert.rejects(request, /has been deleted/); await waitsOnVenue(root, request, secondPid, firstPid);
  await first.query('COMMIT;'); await refused;
  assert.equal(await root.query('SELECT count(*) FROM public.venue_booking_requests WHERE venue_id = 98684;'), '0');
  console.log('PASS [CONFLICT] [SG2-106:AC1] [SG2-106:AC2] a booking request racing a venue delete waits and is then refused.');

  // psql with ON_ERROR_STOP exits after the expected error; use fresh sessions.
  const third = await connect(); const fourth = await connect(); connections.push(third, fourth);
  const thirdPid = await third.query('SELECT pg_backend_pid();'); const fourthPid = await fourth.query('SELECT pg_backend_pid();');
  // A hold placed first makes the waiting delete report it instead of deleting.
  await login(third); await login(fourth);
  const hold = JSON.parse(await third.query("SELECT public.create_venue_hold(98684,98685,now()+interval '10 days',now()+interval '10 days 2 hours',clock_timestamp()+interval '2 days')::text;"));
  assert.equal(hold.outcome, 'created');
  const deleting = fourth.query('SELECT public.delete_venue(98685)::text;'); await waitsOnVenue(root, deleting, fourthPid, thirdPid);
  await third.query('COMMIT;');
  const blocked = JSON.parse(await deleting); await fourth.query('COMMIT;');
  assert.equal(blocked.outcome, 'blocked');
  assert.deepEqual(blocked.blockers.map(item => [item.kind, item.id]), [['hold', hold.hold.hold_id]]);
  assert.equal(await root.query('SELECT (deleted_at IS NULL)::text FROM public.venues WHERE venue_id = 98685;'), 'true');
  console.log('PASS [CONFLICT] [SG2-106:AC1] a delete waiting on a new hold lists that hold and keeps the venue.');

  // An approval waiting on an expiry change sees the new deadline, and a
  // change after the approval is refused.
  await login(third);
  const timed = JSON.parse(await third.query("SELECT public.create_venue_hold(98684,98686,now()+interval '11 days',now()+interval '11 days 2 hours',clock_timestamp()+interval '2 days')::text;"));
  await third.query('COMMIT;');
  await login(third); await login(fourth);
  assert.equal(JSON.parse(await third.query(`SELECT public.change_venue_hold_expiry(${timed.hold.hold_id},clock_timestamp()+interval '4 days')::text;`)).outcome, 'updated');
  const release = fourth.query(`SELECT public.change_venue_hold(${timed.hold.hold_id},'release')::text;`); await waitsOnVenue(root, release, fourthPid, thirdPid);
  await third.query('COMMIT;');
  assert.equal(JSON.parse(await release).outcome, 'updated'); await fourth.query('COMMIT;');
  await login(third);
  assert.equal(JSON.parse(await third.query(`SELECT public.change_venue_hold_expiry(${timed.hold.hold_id},clock_timestamp()+interval '6 days')::text;`)).outcome, 'inactive');
  await third.query('COMMIT;');
  assert.equal(await root.query(`SELECT count(*) FROM public.event_audit_logs WHERE field_name = 'venue_hold_expiry' AND event_id = 98684;`), '1');
  console.log('PASS [CONFLICT] [SG2-106:AC3] [SG2-106:AC5] an expiry change and a release serialize, and a released hold keeps its last expiry.');
} finally {
  for (const session of connections.slice(1)) await session.end().catch(() => {});
  await root.query(`DELETE FROM public.venue_hold_notifications WHERE event_id = 98684;
    DELETE FROM public.venue_holds WHERE event_id = 98684;
    DELETE FROM public.venue_booking_requests WHERE event_id = 98684;
    DELETE FROM public.event_audit_logs WHERE event_id = 98684;
    DELETE FROM public.events WHERE event_id = 98684;
    DELETE FROM public.venues WHERE venue_id IN(98684,98685,98686);
    DELETE FROM public.users WHERE user_id IN('${staff}','${coordinator}','${organiser}');
    DELETE FROM auth.users WHERE id IN('${staff}','${coordinator}','${organiser}');`);
  await root.end();
}

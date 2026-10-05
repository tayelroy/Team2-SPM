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
        const marker = `HOLD_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}

const staff = 'e8400000-0000-4000-8000-000000000001';
const coordinator = 'e8400000-0000-4000-8000-000000000002';
const organiser = 'e8400000-0000-4000-8000-000000000003';
const login = session => session.query(`BEGIN; SET LOCAL role authenticated; SELECT set_config('request.jwt.claim.sub','${staff}',true);`);
const place = (session, days) => session.query(`SELECT public.create_venue_hold(98584,98584,now()+interval '${days} days',now()+interval '${days} days 2 hours',clock_timestamp()+interval '2 days')::text;`);
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
    INSERT INTO public.users(user_id,name,role_id) VALUES('${staff}','Concurrency staff',3),('${coordinator}','Concurrency coordinator',2),('${organiser}','Concurrency organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES('${staff}','venue_staff'),('${coordinator}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.venues(venue_id,name,capacity) VALUES(98584,'Concurrent hold venue',100);
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance) VALUES(98584,'${organiser}','${coordinator}','Concurrent hold event','planning',50);
    COMMIT;`);
  const first = await connect(); const second = await connect(); connections.push(first, second);
  const firstPid = await first.query('SELECT pg_backend_pid();'); const secondPid = await second.query('SELECT pg_backend_pid();');
  await login(first); await login(second);
  const initial = JSON.parse(await place(first, 10)); assert.equal(initial.outcome, 'created');
  const competing = place(second, 10); await waitsOnVenue(root, competing, secondPid, firstPid);
  await first.query('COMMIT;'); assert.equal(JSON.parse(await competing).outcome, 'conflict'); await second.query('COMMIT;');
  console.log('PASS [CONFLICT] [SG2-84:AC3] simultaneous overlapping placements create exactly one hold.');

  await login(first);
  const other = JSON.parse(await place(first, 12)); assert.equal(other.outcome, 'created');
  const booking = second.query("INSERT INTO public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) VALUES(98584,98584,now()+interval '12 days',now()+interval '12 days 1 hour','confirmed');");
  const bookingFailure = assert.rejects(booking, /active tentative hold/); await waitsOnVenue(root, booking, secondPid, firstPid);
  await first.query('COMMIT;'); await bookingFailure;
  console.log('PASS [CONFLICT] [SG2-84:AC3] a concurrent direct booking waits and then refuses an active hold.');

  // psql with ON_ERROR_STOP exits after the expected exclusion error.
  const timer = await connect(); connections.push(timer);
  const id = initial.hold.hold_id;
  await root.query(`UPDATE public.venue_holds SET expires_at = clock_timestamp()+interval '2 hours' WHERE hold_id = ${id};`);
  await login(first);
  assert.equal(JSON.parse(await first.query(`SELECT public.change_venue_hold(${id},'convert')::text;`)).outcome, 'updated');
  // Batches skip locked venues; the next scheduled pass catches anything due.
  assert.equal(await timer.query('SELECT public.process_venue_hold_deadlines();'), '0');
  assert.equal(await root.query(`SELECT count(*) FROM public.venue_hold_notifications WHERE hold_id = ${id} AND kind = 'warning';`), '0');
  // Force the deadline past in this fixture transaction after valid approval;
  // no wall-clock sleep and no production test-only clock are needed.
  await first.query(`RESET ROLE; UPDATE public.venue_holds SET expires_at = created_at+interval '1 microsecond' WHERE hold_id = ${id}; COMMIT;`);
  await timer.query('SELECT public.process_venue_hold_deadlines();');
  assert.equal(await root.query(`SELECT status FROM public.venue_holds WHERE hold_id = ${id};`), 'converted');
  assert.equal(await root.query(`SELECT count(*) FROM public.venue_hold_notifications WHERE hold_id = ${id} AND kind = 'expired';`), '0');
  assert.equal(await root.query('SELECT count(*) FROM public.venue_bookings WHERE event_id = 98584;'), '1');
  console.log('PASS [CONFLICT] [SG2-84:AC5] [SG2-85:AC1] expiry racing an authorized pre-deadline conversion preserves its confirmed booking.');

  // Prove the deadline is checked again after waiting for the event lock.
  // Observe the database clock; no fixed sleep determines when the lock ends.
  await login(first);
  const delayed = JSON.parse(await place(first, 14)); assert.equal(delayed.outcome, 'created');
  await first.query('COMMIT;');
  const delayedId = delayed.hold.hold_id;
  await root.query(`UPDATE public.venue_holds SET expires_at = clock_timestamp()+interval '30 seconds' WHERE hold_id = ${delayedId};`);
  const rootPid = await root.query('SELECT pg_backend_pid();');
  await root.query('BEGIN; SELECT event_id FROM public.events WHERE event_id = 98584 FOR UPDATE;');
  await login(first);
  const delayedConversion = first.query(`SELECT public.change_venue_hold(${delayedId},'convert')::text;`);
  await waitsOnVenue(root, delayedConversion, firstPid, rootPid, 'event');
  assert.equal(await root.query(`SELECT (clock_timestamp()<expires_at)::text FROM public.venue_holds WHERE hold_id = ${delayedId};`), 'true', 'Conversion must have reached its event-lock wait before the deadline.');
  const clockPollLimit = Date.now() + 45000;
  while (await root.query(`SELECT (clock_timestamp()>=expires_at)::text FROM public.venue_holds WHERE hold_id = ${delayedId};`) !== 'true') {
    assert.ok(Date.now() < clockPollLimit, 'Timed out observing the database hold deadline.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await root.query('COMMIT;');
  assert.equal(JSON.parse(await delayedConversion).outcome, 'inactive'); await first.query('COMMIT;');
  assert.equal(await root.query(`SELECT status FROM public.venue_holds WHERE hold_id = ${delayedId};`), 'expired');
  assert.equal(await root.query(`SELECT r.status FROM public.venue_booking_requests r JOIN public.venue_holds h USING(request_id) WHERE h.hold_id = ${delayedId};`), 'cancelled');
  assert.equal(await root.query(`SELECT count(*) FROM public.venue_bookings WHERE venue_id = 98584 AND starts_at = (SELECT starts_at FROM public.venue_holds WHERE hold_id = ${delayedId});`), '0');
  assert.equal(await root.query(`SELECT count(*) FROM public.event_audit_logs WHERE event_id = 98584 AND actor_id IS NULL AND field_name = 'venue_hold_status' AND new_value = 'Expired hold ${delayedId}';`), '1');
  assert.equal(await root.query(`SELECT count(*) FROM public.venue_hold_notifications WHERE hold_id = ${delayedId} AND kind = 'expired';`), '1');
  console.log('PASS [SG2-85:post-event-lock-expiry] [BOUNDARY] [SG2-84:AC5] [SG2-85:AC1] [SG2-85:AC3] [SG2-85:AC4] [SG2-85:AC5] conversion crossing its deadline during an event-lock wait expires atomically.');
} finally {
  // Release a held event lock before closing any potentially waiting caller.
  await root.query('ROLLBACK;');
  for (const session of connections.slice(1)) await session.end();
  await root.query(`DELETE FROM public.venue_hold_notifications WHERE event_id = 98584;
    DELETE FROM public.venue_holds WHERE event_id = 98584;
    DELETE FROM public.venue_booking_requests WHERE event_id = 98584;
    DELETE FROM public.events WHERE event_id = 98584;
    DELETE FROM public.venue_bookings WHERE venue_id = 98584;
    DELETE FROM public.venues WHERE venue_id = 98584;
    DELETE FROM public.users WHERE user_id IN('${staff}','${coordinator}','${organiser}');
    DELETE FROM auth.users WHERE id IN('${staff}','${coordinator}','${organiser}');`);
  await root.end();
}

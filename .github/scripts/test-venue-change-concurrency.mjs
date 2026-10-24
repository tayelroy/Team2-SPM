// SG2-83: real PostgreSQL sessions against disposable local/CI fixtures only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

assert.ok(!process.env.PGHOST || /^(localhost|127\.0\.0\.1|::1)$|^\//.test(process.env.PGHOST), 'Use a disposable local PostgreSQL fixture only.');

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
        const marker = `VENUE_CHANGE_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}


// SG2-83 AC1: a change request and a cancellation of the booking it replaces,
// made at the same moment, never leave a pending change naming a cancelled
// booking. The change request's trigger share-locks the booking, so whichever
// comes second waits for the other.
const coordinator = 'e8380000-0000-4000-8000-000000000001';
const organiser = 'e8380000-0000-4000-8000-000000000002';
const people = `'${coordinator}','${organiser}'`;
const login = (session, user = coordinator) => session.query(`BEGIN; SET LOCAL role authenticated;
  SELECT set_config('request.jwt.claim.sub','${user}',true);`);
const release = (session, booking) => session.query(`SELECT public.release_venue_bookings(${booking},array[]::bigint[],'Venue no longer needed')::text;`);
// The API inserts change requests with the service role; the fixture session inserts as the owner.
const requestChange = (session, booking, day) => session.query(`BEGIN;
  INSERT INTO public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,layout,requested_by,replaces_booking_id,change_reason)
  VALUES(98380,98381,'2031-07-0${day}T09:00Z','2031-07-0${day}T17:00Z','theatre','${coordinator}',${booking},'Larger room');`);
async function waitsFor(root, promise, waitingPid, owningPid) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  const limit = Date.now() + 10000;
  while (Date.now() < limit) {
    assert.equal(settled, false, 'The competing request must wait for its database row lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waitingPid})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owningPid)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out observing a venue change lock wait.');
}
const pendingFor = booking => `SELECT count(*) FROM public.venue_booking_requests WHERE replaces_booking_id=${booking} AND status='pending';`;
const root = await connect();
const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${coordinator}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id) VALUES('${coordinator}','Change race coordinator',2),('${organiser}','Change race organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES('${coordinator}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.venues(venue_id,name) VALUES(98380,'Change race hall'),(98381,'Change race annex');
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status)
      VALUES(98380,'${organiser}','${coordinator}','Change race event','planning');
    INSERT INTO public.venue_bookings(booking_id,venue_id,event_id,starts_at,ends_at,status) VALUES
      (98381,98380,98380,'2031-07-01T09:00Z','2031-07-01T17:00Z','confirmed'),
      (98382,98380,98380,'2031-07-02T09:00Z','2031-07-02T17:00Z','confirmed');
    COMMIT;`);
  const rootPid = await root.query('SELECT pg_backend_pid();');

  // A: the cancellation holds the booking; the change raised meanwhile waits and is refused.
  const cancelling = await connect(); const changing = await connect();
  sessions.push(cancelling, changing);
  const cancellingPid = await cancelling.query('SELECT pg_backend_pid();');
  const changingPid = await changing.query('SELECT pg_backend_pid();');
  await login(cancelling);
  assert.equal(JSON.parse(await release(cancelling, 98381)).outcome, 'released');
  const late = requestChange(changing, 98381, 1);
  const refused = assert.rejects(late, /A change must replace a confirmed booking/);
  await waitsFor(root, late, changingPid, cancellingPid);
  await cancelling.query('COMMIT;');
  await refused;
  assert.equal(await root.query(pendingFor(98381)), '0');
  assert.equal(await root.query('SELECT status FROM public.venue_bookings WHERE booking_id=98381;'), 'cancelled');
  console.log('PASS [CONFLICT] [SG2-83:AC1] a change raised while its booking is being cancelled waits for the cancellation and is refused.');

  // B: the change holds the booking; the cancellation started meanwhile waits and then withdraws it.
  const raising = await connect(); const second = await connect();
  sessions.push(raising, second);
  const raisingPid = await raising.query('SELECT pg_backend_pid();');
  const secondPid = await second.query('SELECT pg_backend_pid();');
  await requestChange(raising, 98382, 2);
  await login(second);
  const cancel = release(second, 98382);
  await waitsFor(root, cancel, secondPid, raisingPid);
  await raising.query('COMMIT;');
  assert.equal(JSON.parse(await cancel).outcome, 'released');
  await second.query('COMMIT;');
  assert.equal(await root.query(pendingFor(98382)), '0');
  assert.equal(await root.query(`SELECT status||'|'||(withdrawn_by='${coordinator}')::text FROM public.venue_booking_requests WHERE replaces_booking_id=98382;`), 'cancelled|true');
  assert.equal(await root.query('SELECT status FROM public.venue_bookings WHERE booking_id=98382;'), 'cancelled');
  console.log('PASS [CONFLICT] [SG2-83:AC1] a cancellation started while a change is raised waits for it and then withdraws the change.');
  assert.ok(rootPid);
} finally {
  await root.query('ROLLBACK;');
  for (const session of sessions) await session.end().catch(() => {});
  await root.query(`DELETE FROM public.event_audit_logs WHERE event_id=98380;
    DELETE FROM public.notifications WHERE event_id=98380;
    DELETE FROM public.venue_booking_requests WHERE event_id=98380;
    UPDATE public.events SET venue_booking_id=null WHERE event_id=98380;
    DELETE FROM public.venue_bookings WHERE event_id=98380;
    DELETE FROM public.events WHERE event_id=98380;
    DELETE FROM public.venues WHERE venue_id IN(98380,98381);
    DELETE FROM public.account_roles WHERE user_id IN(${people});
    DELETE FROM public.users WHERE user_id IN(${people});
    DELETE FROM auth.users WHERE id IN(${people});`);
  await root.end();
}

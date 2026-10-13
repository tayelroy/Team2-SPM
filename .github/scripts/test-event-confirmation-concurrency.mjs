// SG2-58: real PostgreSQL sessions against disposable local/CI fixtures only.
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
        const marker = `CONFIRMATION_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}

const coordinator = 'e5800000-0000-4000-8000-000000000001';
const other = 'e5800000-0000-4000-8000-000000000002';
const organiser = 'e5800000-0000-4000-8000-000000000003';
const venueStaff = 'e5800000-0000-4000-8000-000000000004';
const people = `'${coordinator}','${other}','${organiser}','${venueStaff}'`;
const login = (session, user = coordinator) => session.query(`BEGIN; SET LOCAL role authenticated;
  SELECT set_config('request.jwt.claim.sub','${user}',true);`);
const confirm = (session, event) => session.query(`SELECT public.confirm_event(${event})::text;`);
const outstanding = keys => ({ outcome: 'outstanding', outstanding: keys });
const notices = event => `SELECT count(*) FROM public.notifications WHERE event_id=${event} AND kind='event_confirmed';`;
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
  throw new Error('Timed out observing a confirmation lock wait.');
}
const root = await connect();
const sessions = [];
try {
  // Every event starts ready: Preparation, one approved venue request, nothing else required.
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${coordinator}'),('${other}'),('${organiser}'),('${venueStaff}');
    INSERT INTO public.users(user_id,name,role_id) VALUES
      ('${coordinator}','Confirmation race coordinator',2),('${other}','Confirmation race alternate coordinator',2),
      ('${organiser}','Confirmation race organiser',1),('${venueStaff}','Confirmation race venue staff',3);
    INSERT INTO public.account_roles(user_id,role) VALUES
      ('${coordinator}','event_coordinator'),('${other}','event_coordinator'),
      ('${organiser}','event_organiser'),('${venueStaff}','venue_staff');
    INSERT INTO public.venues(venue_id,name) VALUES(95880,'Confirmation race hall');
    INSERT INTO public.equipment(equipment_id,name,quantity_total) VALUES(95880,'Confirmation race screens',10);
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status,registration_needed)
      SELECT 95880+n,'${organiser}','${coordinator}','Confirmation race '||n,'preparation',false FROM generate_series(0,5)n;
    INSERT INTO public.venue_bookings(booking_id,venue_id,event_id,starts_at,ends_at,status)
      SELECT 95880+n,95880,95880+n,'2031-12-01T09:00Z'::timestamptz+n*interval '1 day','2031-12-01T17:00Z'::timestamptz+n*interval '1 day',
        'confirmed' FROM generate_series(0,5)n;
    INSERT INTO public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
      SELECT 95880+n,95880,'2031-12-01T09:00Z'::timestamptz+n*interval '1 day','2031-12-01T17:00Z'::timestamptz+n*interval '1 day',
        'approved',95880+n FROM generate_series(0,5)n;
    INSERT INTO public.equipment_requests(request_id,event_id,equipment_id,quantity) VALUES(95882,95882,95880,2);
    UPDATE public.events SET registration_needed=true,registration_capacity=40,
      registration_opens_at='2031-11-01T00:00Z',registration_closes_at='2031-11-20T00:00Z' WHERE event_id=95883;
    COMMIT;`);
  const first = await connect(); const second = await connect();
  sessions.push(first, second);
  const rootPid = await root.query('SELECT pg_backend_pid();');
  const firstPid = await first.query('SELECT pg_backend_pid();');
  const secondPid = await second.query('SELECT pg_backend_pid();');

  await login(first, venueStaff);
  assert.equal(JSON.parse(await first.query(`SELECT public.release_venue_booking(95880,'Flooded')::text;`)).outcome, 'released');
  await login(second);
  const afterRelease = confirm(second, 95880);
  await waitsFor(root, afterRelease, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await afterRelease), outstanding(['venue']));
  await second.query('COMMIT;');
  assert.equal(await root.query("SELECT status||'|'||coalesce(confirmed_at::text,'null') FROM public.events WHERE event_id=95880;"), 'preparation|null');
  assert.equal(await root.query(notices(95880)), '0');
  console.log('PASS [CONFLICT] [SG2-58:AC2] a venue booking released while confirmation waits on the event lock refuses confirmation with the venue outstanding.');

  await login(first); await login(second);
  assert.equal(JSON.parse(await confirm(first, 95881)).outcome, 'ok');
  const duplicate = confirm(second, 95881);
  await waitsFor(root, duplicate, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await duplicate), { outcome: 'closed', status: 'confirmed' });
  await second.query('COMMIT;');
  assert.equal(await root.query(`SELECT status||'|'||confirmed_by FROM public.events WHERE event_id=95881;`), `confirmed|${coordinator}`);
  assert.equal(await root.query(notices(95881)), '1');
  assert.equal(await root.query("SELECT count(*) FROM public.event_audit_logs WHERE event_id=95881 AND field_name='status';"), '1');
  console.log('PASS [CONFLICT] [SG2-58:AC1] a simultaneous double confirmation confirms once, closes the other and notifies the organiser once.');

  await root.query(`BEGIN; SELECT 1 FROM public.events WHERE event_id=95882 FOR UPDATE;
    INSERT INTO public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at,request_id,reserved_at)
      VALUES(95882,95880,2,'2031-12-03T09:00Z','2031-12-03T17:00Z',95882,clock_timestamp());
    UPDATE public.equipment_requests SET status='approved',shortfall=0,placement_venue_id=95880,placement_position='Stage'
      WHERE request_id=95882;`);
  await login(first);
  const afterReservation = confirm(first, 95882);
  await waitsFor(root, afterReservation, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.equal(JSON.parse(await afterReservation).outcome, 'ok');
  await first.query('COMMIT;');
  assert.equal(await root.query("SELECT status FROM public.events WHERE event_id=95882;"), 'confirmed');
  assert.equal(await root.query(notices(95882)), '1');
  console.log('PASS [CONFLICT] [SG2-58:AC1] equipment reserved and placed while confirmation waits on the event lock is seen and the event confirms.');

  await root.query('BEGIN; UPDATE public.events SET registration_capacity=null WHERE event_id=95883;');
  await login(first);
  const afterPlanningEdit = confirm(first, 95883);
  await waitsFor(root, afterPlanningEdit, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await afterPlanningEdit), outstanding(['registration']));
  await first.query('COMMIT;');
  assert.equal(await root.query(notices(95883)), '0');
  console.log('PASS [CONFLICT] [SG2-58:AC2] a registration capacity cleared while confirmation waits is listed as outstanding.');

  await root.query(`BEGIN; UPDATE public.events SET coordinator_id='${other}' WHERE event_id=95884;`);
  await login(first);
  const afterReassignment = confirm(first, 95884);
  await waitsFor(root, afterReassignment, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await afterReassignment), { outcome: 'missing' });
  await first.query('COMMIT;');
  assert.equal(await root.query("SELECT status FROM public.events WHERE event_id=95884;"), 'preparation');
  console.log('PASS [FAILURE] [SG2-58:AC1] a coordinator reassigned away while confirmation waits can no longer confirm the event.');

  await root.query(`BEGIN; UPDATE public.account_roles SET role='attendee' WHERE user_id='${coordinator}';`);
  await login(second);
  const revoked = confirm(second, 95885);
  const denied = assert.rejects(revoked, /Access denied/);
  await waitsFor(root, revoked, secondPid, rootPid);
  await root.query('COMMIT;');
  await denied;
  assert.equal(await root.query("SELECT status FROM public.events WHERE event_id=95885;"), 'preparation');
  assert.equal(await root.query(notices(95885)), '0');
  console.log('PASS [FAILURE] [SG2-58:AC1] a stored role revocation committed during the role-lock wait denies the former coordinator.');
} finally {
  await root.query('ROLLBACK;');
  for (const session of sessions) await session.end();
  await root.query(`DELETE FROM public.equipment_reservations WHERE event_id BETWEEN 95880 AND 95885;
    DELETE FROM public.equipment_requests WHERE event_id BETWEEN 95880 AND 95885;
    DELETE FROM public.venue_booking_requests WHERE event_id BETWEEN 95880 AND 95885;
    UPDATE public.events SET venue_booking_id=null WHERE event_id BETWEEN 95880 AND 95885;
    DELETE FROM public.venue_bookings WHERE venue_id=95880;
    DELETE FROM public.events WHERE event_id BETWEEN 95880 AND 95885;
    DELETE FROM public.equipment WHERE equipment_id=95880;
    DELETE FROM public.venues WHERE venue_id=95880;
    DELETE FROM public.account_roles WHERE user_id IN(${people});
    DELETE FROM public.users WHERE user_id IN(${people});
    DELETE FROM auth.users WHERE id IN(${people});`);
  await root.end();
}

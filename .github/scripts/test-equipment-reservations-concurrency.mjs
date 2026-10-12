// SG2-55: real PostgreSQL sessions against disposable local/CI fixtures only.
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
        const marker = `RESERVATION_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}


const support = 'e5500000-0000-4000-8000-000000000001';
const coordinator = 'e5500000-0000-4000-8000-000000000002';
const other = 'e5500000-0000-4000-8000-000000000003';
const organiser = 'e5500000-0000-4000-8000-000000000004';
const login = session => session.query(`BEGIN; SET LOCAL role authenticated;
  SELECT set_config('request.jwt.claim.sub','${support}',true);`);
const reserve = (session, event, version) => session.query(`SELECT public.manage_equipment_reservations(
  'reserve',${event},${event},${version},'2031-10-10T09:00Z','2031-10-10T17:00Z')::text;`);
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
  throw new Error('Timed out observing a reservation lock wait.');
}
const root = await connect();
const sessions = [];
const version = id => root.query(`SELECT version FROM public.equipment_requests WHERE request_id=${id};`);
const cleanReceipts = () => root.query(`DELETE FROM public.equipment_reservations WHERE event_id BETWEEN 95590 AND 95594;
  UPDATE public.equipment_requests SET status='pending',quantity=6 WHERE event_id BETWEEN 95590 AND 95594;`);
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${support}'),('${coordinator}'),('${other}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id) VALUES
      ('${support}','Reservation race support',4),('${coordinator}','Reservation race coordinator',2),
      ('${other}','Reservation race alternate coordinator',2),('${organiser}','Reservation race organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES
      ('${support}','technical_support_staff'),('${coordinator}','event_coordinator'),
      ('${other}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status)
      SELECT 95590+n,'${organiser}','${coordinator}','Reservation race '||n,'planning' FROM generate_series(0,4)n;
    INSERT INTO public.equipment(equipment_id,name,quantity_total) VALUES(95590,'Reservation race microphones',10);
    INSERT INTO public.equipment_requests(request_id,event_id,equipment_id,quantity)
      SELECT 95590+n,95590+n,95590,6 FROM generate_series(0,4)n;
    COMMIT;`);
  const first = await connect(); const second = await connect();
  sessions.push(first, second);
  const rootPid = await root.query('SELECT pg_backend_pid();');
  const firstPid = await first.query('SELECT pg_backend_pid();');
  const secondPid = await second.query('SELECT pg_backend_pid();');

  await login(first); await login(second);
  assert.equal(JSON.parse(await reserve(first, 95590, 1)).outcome, 'ok');
  const contender = reserve(second, 95591, 1);
  await waitsFor(root, contender, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await contender), { outcome: 'insufficient' });
  await second.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*)||\'|\'||sum(quantity_reserved) FROM public.equipment_reservations WHERE equipment_id=95590;'), '1|6');
  assert.equal(await root.query("SELECT status||'|'||version FROM public.equipment_requests WHERE request_id=95591;"), 'pending|1');
  assert.equal(await root.query("SELECT count(*) FROM public.notifications WHERE event_id BETWEEN 95590 AND 95594 AND kind='equipment_reserved';"), '1');
  console.log('PASS [CONFLICT] [SG2-55:AC1] [SG2-55:AC3] competing events serialize shared stock and only one six-unit reservation fits ten units.');

  await cleanReceipts();
  const sameVersion = await version(95592);
  await login(first); await login(second);
  assert.equal(JSON.parse(await reserve(first, 95592, sameVersion)).outcome, 'ok');
  const duplicate = reserve(second, 95592, sameVersion);
  await waitsFor(root, duplicate, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await duplicate), { outcome: 'conflict' });
  await second.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_reservations WHERE request_id=95592;'), '1');
  assert.equal(await root.query("SELECT count(*) FROM public.notifications WHERE event_id=95592 AND kind='equipment_reserved';"), '1');
  console.log('PASS [CONFLICT] [SG2-55:AC1] [SG2-55:AC4] simultaneous replay produces exactly one receipt and one coordinator notification.');

  await cleanReceipts();
  let currentVersion = await version(95590);
  await root.query('BEGIN; UPDATE public.equipment SET quantity_total=5 WHERE equipment_id=95590;');
  await login(first);
  const reduced = reserve(first, 95590, currentVersion);
  await waitsFor(root, reduced, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await reduced), { outcome: 'insufficient' });
  await first.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_reservations WHERE request_id=95590;'), '0');
  console.log('PASS [CONFLICT] [SG2-55:AC3] a stock reduction committed during the equipment-lock wait is rechecked before reserving.');

  await root.query("UPDATE public.equipment SET quantity_total=10 WHERE equipment_id=95590; BEGIN; UPDATE public.equipment SET operational_status='maintenance' WHERE equipment_id=95590;");
  await login(first);
  const maintenance = reserve(first, 95590, currentVersion);
  await waitsFor(root, maintenance, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await maintenance), { outcome: 'insufficient' });
  await first.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_reservations WHERE request_id=95590;'), '0');
  console.log('PASS [CONFLICT] [SG2-55:AC3] equipment entering maintenance during the row-lock wait cannot be reserved.');

  await root.query("UPDATE public.equipment SET operational_status='operational' WHERE equipment_id=95590; BEGIN; UPDATE public.equipment_requests SET quantity=7 WHERE request_id=95590;");
  await login(first);
  const amended = reserve(first, 95590, currentVersion);
  await waitsFor(root, amended, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await amended), { outcome: 'conflict' });
  await first.query('COMMIT;');
  assert.equal(await root.query("SELECT quantity||'|'||status FROM public.equipment_requests WHERE request_id=95590;"), '7|pending');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_reservations WHERE request_id=95590;'), '0');
  console.log('PASS [CONFLICT] [SG2-55:AC1] a concurrent requirement amendment invalidates the prior version without reserving obsolete quantity.');

  currentVersion = await version(95590);
  await root.query("BEGIN; UPDATE public.events SET status='cancelled' WHERE event_id=95590;");
  await login(first);
  const closed = reserve(first, 95590, currentVersion);
  await waitsFor(root, closed, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await closed), { outcome: 'closed' });
  await first.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_reservations WHERE request_id=95590;'), '0');
  console.log('PASS [CONFLICT] [SG2-55:AC1] an event cancelled during the event-lock wait refuses reservation.');

  await root.query(`UPDATE public.events SET status='planning' WHERE event_id=95590;
    BEGIN; UPDATE public.events SET coordinator_id='${other}' WHERE event_id=95590;`);
  await login(first);
  const reassigned = reserve(first, 95590, currentVersion);
  await waitsFor(root, reassigned, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.equal(JSON.parse(await reassigned).coordinator_notified, true);
  await first.query('COMMIT;');
  assert.equal(await root.query("SELECT recipient_id FROM public.notifications WHERE event_id=95590 AND kind='equipment_reserved';"), other);
  assert.equal(await root.query(`SELECT count(*) FROM public.notifications WHERE event_id=95590 AND recipient_id='${coordinator}';`), '0');
  console.log('PASS [CONFLICT] [SG2-55:AC4] a coordinator reassigned during the event-lock wait receives the sole reservation notification.');

  await cleanReceipts();
  currentVersion = await version(95591);
  await root.query(`BEGIN; UPDATE public.account_roles SET role='attendee' WHERE user_id='${support}';`);
  await login(second);
  const revoked = reserve(second, 95591, currentVersion);
  const denied = assert.rejects(revoked, /Access denied/);
  await waitsFor(root, revoked, secondPid, rootPid);
  await root.query('COMMIT;');
  await denied;
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_reservations WHERE request_id=95591;'), '0');
  assert.equal(await root.query("SELECT status FROM public.equipment_requests WHERE request_id=95591;"), 'pending');
  console.log('PASS [CONFLICT] [SG2-55:AC1] a stored role revocation committed during the role-lock wait denies the former technician.');
} finally {
  await root.query('ROLLBACK;');
  for (const session of sessions) await session.end();
  await root.query(`DELETE FROM public.equipment_reservations WHERE event_id BETWEEN 95590 AND 95594;
    DELETE FROM public.events WHERE event_id BETWEEN 95590 AND 95594;
    DELETE FROM public.equipment WHERE equipment_id=95590;
    DELETE FROM public.account_roles WHERE user_id IN('${support}','${coordinator}','${other}','${organiser}');
    DELETE FROM public.users WHERE user_id IN('${support}','${coordinator}','${other}','${organiser}');
    DELETE FROM auth.users WHERE id IN('${support}','${coordinator}','${other}','${organiser}');`);
  await root.end();
}

// SG2-53: real PostgreSQL sessions against disposable local/CI fixtures only.
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
        const marker = `REQUIREMENT_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}


const coordinator = 'e5300000-0000-4000-8000-000000000001';
const support = 'e5300000-0000-4000-8000-000000000002';
const other = 'e5300000-0000-4000-8000-000000000003';
const organiser = 'e5300000-0000-4000-8000-000000000004';
const login = (session, identity) => session.query(`BEGIN; SET LOCAL role authenticated;
  SELECT set_config('request.jwt.claim.sub','${identity}',true);`);
const run = (session, action, id = null, version = null, values = null) => session.query(
  `SELECT public.manage_equipment_requirements('${action}',95390,${id ?? 'null'},${version ?? 'null'},${values === null ? 'null' : `'${JSON.stringify(values)}'::jsonb`})::text;`);
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
  throw new Error('Timed out observing a requirements lock wait.');
}
const root = await connect();
const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${coordinator}'),('${support}'),('${other}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id) VALUES
      ('${coordinator}','Race coordinator',2),('${support}','Race support',4),
      ('${other}','Other coordinator',2),('${organiser}','Race organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES
      ('${coordinator}','event_coordinator'),('${support}','technical_support_staff'),
      ('${other}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status)
      VALUES(95390,'${organiser}','${coordinator}','Requirements race','planning');
    INSERT INTO public.equipment(equipment_id,name,quantity_total) VALUES
      (95390,'Race microphones',10),(95391,'Race projectors',4);
    COMMIT;`);
  const first = await connect(); const second = await connect(); const technician = await connect();
  sessions.push(first, second, technician);
  const rootPid = await root.query('SELECT pg_backend_pid();');
  const firstPid = await first.query('SELECT pg_backend_pid();');
  const secondPid = await second.query('SELECT pg_backend_pid();');
  const techPid = await technician.query('SELECT pg_backend_pid();');
  await login(first, coordinator); await login(second, coordinator);
  const created = JSON.parse(await run(first, 'create', null, null, { equipment_id: 95390, quantity: 5, notes: 'Wireless' }));
  assert.equal(created.outcome, 'ok');
  const id = created.requests[0].request_id;
  const duplicate = run(second, 'create', null, null, { equipment_id: 95390, quantity: 2 });
  await waitsFor(root, duplicate, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await duplicate), { outcome: 'duplicate' });
  await second.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_requests WHERE event_id=95390;'), '1');
  console.log('PASS [CONFLICT] [SG2-53:AC1] concurrent duplicate creates persist exactly one pending requirement.');

  await login(first, coordinator); await login(technician, support);
  const amended = JSON.parse(await run(first, 'amend', id, 1, { equipment_id: 95390, quantity: 8, notes: 'Eight handhelds' }));
  assert.equal(amended.outcome, 'ok');
  const stale = run(technician, 'arrange', id, 1, { shortfall: 0, arrangement_notes: 'Five prepared' });
  await waitsFor(root, stale, techPid, firstPid);
  await first.query('COMMIT;');
  assert.deepEqual(JSON.parse(await stale), { outcome: 'conflict' });
  await technician.query('COMMIT;');
  assert.equal(await root.query(`SELECT quantity||'|'||version||'|'||(shortfall IS NULL)::text||'|'||(arrangement_notes IS NULL)::text
    FROM public.equipment_requests WHERE request_id=${id};`), '8|2|true|true');
  console.log('PASS [CONFLICT] [SG2-53:AC2] [SG2-53:AC5] concurrent amendment makes the old support version stale without restoring obsolete arrangements.');

  await root.query(`BEGIN; UPDATE public.equipment_requests SET status='approved' WHERE request_id=${id};`);
  await login(first, coordinator);
  const decided = run(first, 'amend', id, 2, { equipment_id: 95390, quantity: 9 });
  await waitsFor(root, decided, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await decided), { outcome: 'closed' });
  await first.query('COMMIT;');
  assert.equal(await root.query(`SELECT status||'|'||quantity||'|'||version FROM public.equipment_requests WHERE request_id=${id};`), 'approved|8|3');
  console.log('PASS [CONFLICT] [SG2-53:AC2] a request decided while an editor waits stays closed and keeps its quantity.');

  await root.query(`UPDATE public.equipment_requests SET status='pending' WHERE request_id=${id};
    BEGIN; UPDATE public.events SET status='confirmed' WHERE event_id=95390;`);
  await login(technician, support);
  const closed = run(technician, 'arrange', id, 4, { shortfall: 0 });
  await waitsFor(root, closed, techPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await closed), { outcome: 'closed' });
  await technician.query('COMMIT;');
  assert.equal(await root.query(`SELECT version||'|'||(shortfall IS NULL)::text FROM public.equipment_requests WHERE request_id=${id};`), '4|true');
  console.log('PASS [CONFLICT] [SG2-53:AC5] an event leaving arrangement stages while support waits refuses the update.');

  await root.query(`UPDATE public.events SET status='planning' WHERE event_id=95390;
    BEGIN; UPDATE public.events SET coordinator_id='${other}' WHERE event_id=95390;`);
  await login(first, coordinator);
  const reassigned = run(first, 'create', null, null, { equipment_id: 95391, quantity: 1 });
  await waitsFor(root, reassigned, firstPid, rootPid);
  await root.query('COMMIT;');
  assert.deepEqual(JSON.parse(await reassigned), { outcome: 'missing' });
  await first.query('COMMIT;');
  assert.equal(await root.query('SELECT count(*) FROM public.equipment_requests WHERE event_id=95390;'), '1');
  console.log('PASS [CONFLICT] [SG2-53:AC1] reassignment committed during an event-lock wait removes the former coordinator access.');

  await root.query(`BEGIN; UPDATE public.account_roles SET role='attendee' WHERE user_id='${support}';`);
  await login(technician, support);
  const revoked = run(technician, 'arrange', id, 4, { shortfall: 0 });
  const denied = assert.rejects(revoked, /Access denied/);
  await waitsFor(root, revoked, techPid, rootPid);
  await root.query('COMMIT;');
  await denied;
  assert.equal(await root.query(`SELECT version||'|'||(shortfall IS NULL)::text FROM public.equipment_requests WHERE request_id=${id};`), '4|true');
  console.log('PASS [CONFLICT] [SG2-53:AC5] a stored role change committed during a role-lock wait denies the former support writer.');
} finally {
  await root.query('ROLLBACK;');
  for (const session of sessions) await session.end();
  await root.query(`DELETE FROM public.events WHERE event_id=95390;
    DELETE FROM public.equipment WHERE equipment_id IN(95390,95391);
    DELETE FROM public.account_roles WHERE user_id IN('${coordinator}','${support}','${other}','${organiser}');
    DELETE FROM public.users WHERE user_id IN('${coordinator}','${support}','${other}','${organiser}');
    DELETE FROM auth.users WHERE id IN('${coordinator}','${support}','${other}','${organiser}');`);
  await root.end();
}

// SG2-60: disposable database only. Two attendees registering for an
// event's last place at the same moment: register_for_event() locks the event
// row first, so the second waits for the first, then counts its place and is
// refused as full. The same attendee registering twice at once holds one
// place. CI uses its PostgreSQL container; a local run may supply PSQL_BIN.
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
        const marker = `REGISTRATION_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        psql.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { psql.stdin.end(); await ended; }
  };
}

const first = 'e6010000-0000-4000-8000-000000000001';
const second = 'e6010000-0000-4000-8000-000000000002';
const organiser = 'e6010000-0000-4000-8000-000000000003';
const people = [first, second, organiser];
const events = [96090, 96091];
const login = (session, who) => session.query(`BEGIN; SET LOCAL role authenticated; SELECT set_config('request.jwt.claim.sub','${who}',true);`);
const register = (session, event) => session.query(`SELECT public.register_for_event(${event},'91234567',null)->>'outcome';`);
const held = (session, event) => session.query(`SELECT count(*) FROM public.registrations WHERE event_id = ${event};`);

/** Wait until the database shows `waiting` blocked by `owner`; fail if it finishes first. */
async function waitsFor(root, promise, waiting, owner) {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(settled, false, 'The competing registration must wait for the event lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waiting})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owner)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting to observe the competing registration blocked on the event lock.');
}

const root = connect(); const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) SELECT unnest(array['${people.join("','")}'])::uuid;
    INSERT INTO public.users(user_id,name,role_id) VALUES('${first}','Race attendee one',5),('${second}','Race attendee two',5),
      ('${organiser}','Race organiser',1);
    INSERT INTO public.account_roles(user_id,role) VALUES('${first}','attendee'),('${second}','attendee'),('${organiser}','event_organiser');
    INSERT INTO public.events(event_id,organiser_id,name,status,proposed_date,registration_needed,registration_capacity,
      registration_opens_at,registration_closes_at)
      SELECT n,'${organiser}','Race event '||n,'confirmed',now()+interval '30 days',true,1,now()-interval '1 day',now()+interval '9 days'
      FROM unnest(array[${events.join(',')}]) n;
    COMMIT;`);
  const one = connect(); const two = connect(); sessions.push(one, two);
  const onePid = await one.query('SELECT pg_backend_pid();'); const twoPid = await two.query('SELECT pg_backend_pid();');

  await login(one, first); await login(two, second);
  assert.equal(await register(one, 96090), 'ok');
  const racing = register(two, 96090); await waitsFor(root, racing, twoPid, onePid);
  await one.query('COMMIT;');
  assert.equal(await racing, 'full'); await two.query('COMMIT;');
  assert.equal(await held(root, 96090), '1');
  console.log('PASS [CONFLICT] [SG2-60:AC1] two attendees registering for the last place at once: one holds it, the other is refused as full.');

  await login(one, first); await login(two, first);
  assert.equal(await register(one, 96091), 'ok');
  const again = register(two, 96091); await waitsFor(root, again, twoPid, onePid);
  await one.query('COMMIT;');
  assert.equal(await again, 'duplicate'); await two.query('COMMIT;');
  assert.equal(await held(root, 96091), '1');
  assert.equal(await root.query(`SELECT count(*) FROM public.notifications WHERE event_id = 96091;`), '1');
  console.log('PASS [CONFLICT] [SG2-60:AC2] the same attendee registering twice at once holds one place and is confirmed once.');
} finally {
  for (const session of sessions) await session.end();
  const ids = people.map(id => `'${id}'`).join(',');
  const eventIds = events.join(',');
  await root.query(`ROLLBACK;
    DELETE FROM public.notifications WHERE event_id IN (${eventIds});
    DELETE FROM public.registrations WHERE event_id IN (${eventIds});
    DELETE FROM public.events WHERE event_id IN (${eventIds});
    DELETE FROM public.account_roles WHERE user_id IN (${ids});
    DELETE FROM public.users WHERE user_id IN (${ids});
    DELETE FROM auth.users WHERE id IN (${ids});`);
  await root.end();
}

// SG2-69: independent real PostgreSQL sessions; disposable local fixtures only.
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
        const marker = `NOTIFICATION_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        processHandle.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { processHandle.stdin.end(); await ended; }
  };
}

const coordinator = 'e6900000-0000-4000-8000-000000000081';
const other = 'e6900000-0000-4000-8000-000000000082';
const organiser = 'e6900000-0000-4000-8000-000000000083';
const people = `'${coordinator}','${other}','${organiser}'`;
const event = 96980;
const scheduler = session => session.query('SELECT public.send_outstanding_arrangement_reminders();');
const login = session => session.query(`BEGIN; SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub','${coordinator}',true);
  SELECT set_config('request.headers','{"x-acting-role":"event_coordinator"}',true);`);
async function waitsFor(root, promise, waitingPid, owningPid) {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  const limit = Date.now() + 10000;
  while (Date.now() < limit) {
    assert.equal(settled, false, 'The scheduler or receipt mutation must wait for its row lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waitingPid})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owningPid)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out observing the notification lock wait.');
}
const root = await connect();
const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${coordinator}'),('${other}'),('${organiser}');
    INSERT INTO public.users(user_id,name,role_id,organisation) VALUES
      ('${coordinator}','Reminder race coordinator',2,'Reminder Org'),('${other}','Reminder race new coordinator',2,'Reminder Org'),
      ('${organiser}','Reminder race organiser',1,'Reminder Org');
    INSERT INTO public.account_roles(user_id,role) VALUES('${coordinator}','attendee'),('${coordinator}','event_coordinator'),('${other}','event_coordinator'),('${organiser}','event_organiser');
    INSERT INTO public.venues(venue_id,name,capacity) VALUES(${event},'Reminder race hall',100);
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,organisation,name,status,proposed_date,registration_needed)
      VALUES(${event},'${organiser}','${coordinator}','Reminder Org','Reminder race event','planning',clock_timestamp()+interval '100 days',false);
    COMMIT;`);
  const first = await connect(); const second = await connect(); sessions.push(first, second);
  const rootPid = await root.query('SELECT pg_backend_pid();');
  const firstPid = await first.query('SELECT pg_backend_pid();');
  const secondPid = await second.query('SELECT pg_backend_pid();');
  const count = () => root.query(`SELECT count(*) FROM public.notifications WHERE event_id=${event} AND kind='outstanding_arrangements';`);
  const reset = () => root.query(`DELETE FROM public.notifications WHERE event_id=${event}; DELETE FROM public.notification_reminder_receipts WHERE event_id=${event};`);

  await first.query('BEGIN;');
  assert.equal(await scheduler(first), '1');
  await second.query('BEGIN;');
  assert.equal(await scheduler(second), '0');
  await second.query('COMMIT;'); await first.query('COMMIT;');
  assert.equal(await count(), '1');
  assert.equal(await root.query(`SELECT count(*) FROM public.notification_reminder_receipts WHERE event_id=${event};`), '1');
  console.log('PASS [SG2-69:simultaneous-sweeps] [SG2-69:AC6] [SG2-104:AC1] [CONFLICT] Simultaneous scheduler sessions publish one reminder and receipt for a multi-role coordinator without a web acting role.');

  for (const days of [1, 3]) {
    await reset();
    await root.query(`INSERT INTO public.notification_reminder_settings(user_id,frequency_days) VALUES('${coordinator}',${days})
      ON CONFLICT(user_id) DO UPDATE SET frequency_days=excluded.frequency_days;
      INSERT INTO public.notification_reminder_receipts(event_id,recipient_id,last_sent_at)
      VALUES(${event},'${coordinator}',date_trunc('hour',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        -make_interval(days=>${days})+interval '59 minutes 59 seconds');`);
    await first.query('BEGIN;'); assert.equal(await scheduler(first), '1');
    await second.query('BEGIN;'); assert.equal(await scheduler(second), '0');
    await second.query('COMMIT;'); await first.query('COMMIT;');
    assert.equal(await scheduler(second), '0');
    assert.equal(await count(), '1');
    assert.equal(await root.query(`SELECT count(*) FROM public.notification_reminder_receipts WHERE event_id=${event};`), '1');
    console.log(`PASS [SG2-69:hour-aligned-${days}-day-sweeps] [SG2-69:AC6] [CONFLICT] Concurrent ${days}-day sweeps in the due UTC hour publish once, then a repeat sweep stays suppressed.`);
  }
  await root.query(`DELETE FROM public.notification_reminder_settings WHERE user_id='${coordinator}';`);

  await reset();
  await root.query(`BEGIN; UPDATE public.events SET status='cancelled' WHERE event_id=${event};`);
  await first.query('BEGIN;'); const cancelled = scheduler(first);
  await waitsFor(root, cancelled, firstPid, rootPid); await root.query('COMMIT;');
  assert.equal(await cancelled, '0'); await first.query('COMMIT;');
  assert.equal(await count(), '0');
  console.log('PASS [SG2-69:cancellation-during-sweep] [SG2-69:AC6] [CONFLICT] Cancellation committed during the event lock wait prevents the reminder.');

  // SG2-67 AC5 refuses reinstating a cancelled event, so this fixture reset
  // turns that one rule off for its own statement.
  await root.query(`ALTER TABLE public.events DISABLE TRIGGER keep_cancelled_events_cancelled;
    UPDATE public.events SET status='planning' WHERE event_id=${event};
    ALTER TABLE public.events ENABLE TRIGGER keep_cancelled_events_cancelled;
    BEGIN; UPDATE public.events SET coordinator_id='${other}' WHERE event_id=${event};`);
  await first.query('BEGIN;'); const reassigned = scheduler(first);
  await waitsFor(root, reassigned, firstPid, rootPid); await root.query('COMMIT;');
  assert.equal(await reassigned, '1'); await first.query('COMMIT;');
  assert.equal(await root.query(`SELECT recipient_id FROM public.notifications WHERE event_id=${event} AND kind='outstanding_arrangements';`), other);
  console.log('PASS [SG2-69:reassignment-during-sweep] [SG2-69:AC7] [CONFLICT] Assignment committed during the row wait sends only to the new coordinator.');

  await reset();
  await root.query(`UPDATE public.events SET coordinator_id='${coordinator}' WHERE event_id=${event};
    BEGIN; SELECT 1 FROM public.events WHERE event_id=${event} FOR UPDATE;
    INSERT INTO public.venue_bookings(booking_id,event_id,venue_id,starts_at,ends_at,status)
      VALUES(${event},${event},${event},clock_timestamp()+interval '100 days',clock_timestamp()+interval '100 days 4 hours','confirmed');
    INSERT INTO public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
      VALUES(${event},${event},${event},clock_timestamp()+interval '100 days',clock_timestamp()+interval '100 days 4 hours','approved',${event});`);
  await first.query('BEGIN;'); const nowReady = scheduler(first);
  await waitsFor(root, nowReady, firstPid, rootPid); await root.query('COMMIT;');
  assert.equal(await nowReady, '0'); await first.query('COMMIT;');
  assert.equal(await count(), '0');
  console.log('PASS [SG2-69:arrangement-completion-during-sweep] [SG2-69:AC5] [CONFLICT] Readiness committed during the event lock wait stops the due reminder.');

  await root.query(`UPDATE public.venue_booking_requests SET status='pending',venue_booking_id=null WHERE request_id=${event};
    BEGIN; DELETE FROM public.account_roles WHERE user_id='${coordinator}' AND role='event_coordinator';`);
  await first.query('BEGIN;'); const roleRevoked = scheduler(first);
  await waitsFor(root, roleRevoked, firstPid, rootPid); await root.query('COMMIT;');
  assert.equal(await roleRevoked, '0'); await first.query('COMMIT;');
  assert.equal(await count(), '0');
  console.log('PASS [SG2-69:role-revocation-during-sweep] [SG2-69:AC7] [FAILURE] A role revocation committed while the scheduler waits prevents delivery to the former coordinator.');

  await root.query(`INSERT INTO public.account_roles(user_id,role) VALUES('${coordinator}','event_coordinator');
    BEGIN; DELETE FROM public.account_roles WHERE user_id='${coordinator}' AND role='event_coordinator';`);
  await login(first);
  const preferenceAfterRevocation = first.query(`DO $$ BEGIN
    BEGIN
      PERFORM public.set_notification_reminder_preferences(30);
      RAISE EXCEPTION 'Removed coordinator role must not authorize a preference write';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END $$;`);
  await waitsFor(root, preferenceAfterRevocation, firstPid, rootPid); await root.query('COMMIT;');
  assert.equal(await preferenceAfterRevocation, ''); await first.query('COMMIT;');
  assert.equal(await root.query(`SELECT count(*) FROM public.notification_reminder_settings WHERE user_id='${coordinator}';`), '0');
  console.log('PASS [SG2-69:preference-role-revocation] [SG2-69:AC6] [SG2-104:AC2] [CONFLICT] Revoking the selected coordinator role during its lock wait prevents preference changes while the attendee role remains.');

  await root.query(`INSERT INTO public.account_roles(user_id,role) VALUES('${coordinator}','event_coordinator');
    INSERT INTO public.notifications(notification_id,recipient_id,event_id,kind,message)
      VALUES(9698001,'${coordinator}',${event},'event_submitted','Existing unread notice');
    BEGIN; SELECT 1 FROM public.notifications WHERE notification_id=9698001 FOR UPDATE;`);
  await login(first); const clear = first.query('SELECT public.read_all_notifications()::text;');
  await waitsFor(root, clear, firstPid, rootPid);
  await root.query(`INSERT INTO public.notifications(notification_id,recipient_id,event_id,kind,message)
    VALUES(9698002,'${coordinator}',${event},'event_submitted','New arrival during clear'); COMMIT;`);
  assert.deepEqual(JSON.parse(await clear), {unread_count:1}); await first.query('COMMIT;');
  assert.equal(await root.query('SELECT notification_id||\'|\'||(read_at IS NULL)::text FROM public.notifications WHERE notification_id IN(9698001,9698002) ORDER BY notification_id;'), '9698001|false\n9698002|true');
  console.log('PASS [SG2-69:new-arrival-during-clear] [SG2-69:AC4] [BOUNDARY] Mark all clears its snapshot and leaves a later arrival unread.');

  await login(first); const firstRead = JSON.parse(await first.query("SELECT public.read_notification('event',9698002)::text;"));
  await login(second); const duplicateRead = second.query("SELECT public.read_notification('event',9698002)::text;");
  await waitsFor(root, duplicateRead, secondPid, firstPid); await first.query('COMMIT;');
  const afterRead = JSON.parse(await duplicateRead); await second.query('COMMIT;');
  assert.equal(afterRead.notification.read_at, firstRead.notification.read_at);
  assert.equal(afterRead.unread_count, 0);
  console.log('PASS [SG2-69:simultaneous-read-receipt] [SG2-69:AC3] [CONFLICT] Simultaneous opens preserve one original read receipt and an authoritative unread count.');

  await reset(); await first.query('BEGIN;'); assert.equal(await scheduler(first),'1'); await first.query('ROLLBACK;');
  assert.equal(await count(),'0');
  assert.equal(await root.query(`SELECT count(*) FROM public.notification_reminder_receipts WHERE event_id=${event};`),'0');
  assert.equal(await scheduler(second),'1'); assert.equal(await count(),'1');
  console.log('PASS [SG2-69:atomic-notice-cadence-rollback] [SG2-69:AC6] [FAILURE] Aborted delivery rolls back notice and cadence so a subsequent sweep can deliver.');
} finally {
  await root.query('ROLLBACK;');
  for (const session of sessions) await session.end();
  await root.query(`DELETE FROM public.venue_booking_requests WHERE event_id=${event};
    DELETE FROM public.events WHERE event_id=${event}; DELETE FROM public.venues WHERE venue_id=${event};
    DELETE FROM public.account_roles WHERE user_id IN(${people}); DELETE FROM public.users WHERE user_id IN(${people});
    DELETE FROM auth.users WHERE id IN(${people});`);
  await root.end();
}

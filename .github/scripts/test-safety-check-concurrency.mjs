// SG2-91: disposable database only. Arrangements that complete, or change,
// at the same moment must leave each event in exactly one place: awaiting its
// safety check with one history row, or back in Planning. Every move locks the
// event row, so a safety decision (SG2-92) that locks it too waits for any
// change in flight and then sees the new status and revision.
// CI uses its PostgreSQL container; a local run may supply PSQL_BIN.
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
        const marker = `SAFETY_CHECK_TEST_DONE_${++sequence}`; pending = { marker, lines: [], resolve, reject };
        psql.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { psql.stdin.end(); await ended; }
  };
}

const staff = 'e9100000-0000-4000-8000-000000000001';
const coordinator = 'e9100000-0000-4000-8000-000000000002';
const organiser = 'e9100000-0000-4000-8000-000000000003';
const support = 'e9100000-0000-4000-8000-000000000004';
const officer = 'e9100000-0000-4000-8000-000000000005';
const people = [staff, coordinator, organiser, support, officer];
const events = [99190, 99191, 99192];
const login = (session, who) => session.query(`BEGIN; SET LOCAL role authenticated; SELECT set_config('request.jwt.claim.sub','${who}',true);`);
const approve = (session, request) => session.query(`SELECT public.decide_venue_booking_request(${request},'approve',null)::text;`);
/** Technical Support reserves an event's one equipment request (same id as the event) on `day`. */
async function reserve(session, event, day) {
  const read = JSON.parse(await session.query(`SELECT public.manage_equipment_requirements('read',${event})::text;`));
  const version = read.requests.find(row => row.request_id === event).version;
  return session.query(
    `SELECT public.manage_equipment_reservations('reserve',${event},${event},${version},'${day}T02:00Z','${day}T06:00Z')::text;`);
}
const statusOf = (session, event) => session.query(`SELECT status || '|' || safety_check_revision FROM public.events WHERE event_id = ${event};`);
const moves = (session, event) => session.query(
  `SELECT coalesce(string_agg(old_value || '>' || new_value, ',' ORDER BY log_id), '') FROM public.event_audit_logs WHERE event_id = ${event} AND field_name = 'status';`);

/** Wait until the database shows `waiting` blocked by `owner`; fail if it finishes first. */
async function waitsFor(root, promise, waiting, owner) {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(settled, false, 'The competing call must wait for the event lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waiting})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owner)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting to observe the competing call blocked on the event lock.');
}

const root = connect(); const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) SELECT unnest(array['${people.join("','")}'])::uuid;
    INSERT INTO public.users(user_id,name,role_id) VALUES('${staff}','Safety race staff',3),('${coordinator}','Safety race coordinator',2),
      ('${organiser}','Safety race organiser',1),('${support}','Safety race support',4),('${officer}','Safety race officer',7);
    INSERT INTO public.account_roles(user_id,role) VALUES('${staff}','venue_staff'),('${coordinator}','event_coordinator'),
      ('${organiser}','event_organiser'),('${support}','technical_support_staff'),('${officer}','safety_officer');
    INSERT INTO public.venues(venue_id,name,capacity) VALUES(99190,'Safety race hall',500),(99191,'Safety race room',500),(99192,'Safety race annex',500);
    INSERT INTO public.equipment(equipment_id,name,quantity_total) VALUES(99190,'Safety race lights',10);
    INSERT INTO public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance)
      SELECT n,'${organiser}','${coordinator}','Safety race event '||n,'planning',50 FROM unnest(array[${events.join(',')}]) n;
    -- 99190: two venues awaiting decisions by two members of Venue Staff.
    INSERT INTO public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by) VALUES
      (99190,99190,99190,'2031-09-01T02:00Z','2031-09-01T06:00Z','theatre','${coordinator}'),
      (99191,99190,99191,'2031-09-01T02:00Z','2031-09-01T06:00Z','theatre','${coordinator}');
    -- 99191 and 99192: a booked venue, and equipment placed but not yet reserved.
    INSERT INTO public.venue_bookings(booking_id,venue_id,event_id,starts_at,ends_at,status) VALUES
      (99191,99192,99191,'2031-09-03T02:00Z','2031-09-03T06:00Z','confirmed'),
      (99192,99192,99192,'2031-09-05T02:00Z','2031-09-05T06:00Z','confirmed');
    INSERT INTO public.equipment_requests(request_id,event_id,equipment_id,quantity,shortfall,placement_venue_id,placement_position) VALUES
      (99191,99191,99190,1,0,99192,'Stage'),(99192,99192,99190,1,0,99192,'Stage');
    INSERT INTO public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by,status,decided_by,decided_at,venue_booking_id) VALUES
      (99192,99191,99192,'2031-09-03T02:00Z','2031-09-03T06:00Z','theatre','${coordinator}','approved','${staff}',now(),99191),
      (99193,99192,99192,'2031-09-05T02:00Z','2031-09-05T06:00Z','theatre','${coordinator}','approved','${staff}',now(),99192);
    COMMIT;`);
  for (const event of events) assert.equal(await statusOf(root, event), 'planning|0');
  const first = connect(); const second = connect(); sessions.push(first, second);
  const firstPid = await first.query('SELECT pg_backend_pid();'); const secondPid = await second.query('SELECT pg_backend_pid();');

  // Each approval alone leaves the other venue pending. The second waits for
  // the first's event lock, then sees both approved and moves the event once.
  await login(first, staff); await login(second, staff);
  assert.equal(JSON.parse(await approve(first, 99190)).status, 'approved');
  const racing = approve(second, 99191); await waitsFor(root, racing, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.equal(JSON.parse(await racing).status, 'approved'); await second.query('COMMIT;');
  assert.equal(await statusOf(root, 99190), 'awaiting_safety_check|1');
  assert.equal(await moves(root, 99190), 'planning>awaiting_safety_check');
  console.log('PASS [CONFLICT] [SG2-91:AC1] two venue approvals committed together move the event to Awaiting Safety Check exactly once.');

  // 99191 joins the list, then the coordinator adds equipment while the
  // Safety Officer is looking at it. Until the change commits the officer's
  // list still shows the event; a decision that locks the event (as SG2-92
  // must) waits for the change, then sees Planning and a new revision.
  await login(first, support);
  assert.equal(JSON.parse(await reserve(first, 99191, '2031-09-03')).outcome, 'ok');
  await first.query('COMMIT;');
  const [listedStatus, listedRevision] = (await statusOf(root, 99191)).split('|');
  assert.equal(listedStatus, 'awaiting_safety_check');
  await login(first, coordinator);
  const added = JSON.parse(await first.query(
    `SELECT public.manage_equipment_requirements('create',99191,null,null,'{"equipment_id":99190,"quantity":2,"notes":"Spare"}')::text;`));
  assert.equal(added.outcome, 'ok'); assert.equal(added.event.status, 'planning');
  await login(second, officer);
  const listed = JSON.parse(await second.query('SELECT public.safety_check_queue()::text;'));
  assert.equal(listed.find(item => item.event_id === 99191)?.safety_check_revision, Number(listedRevision));
  await second.query('COMMIT;');
  await second.query('BEGIN;');
  const deciding = second.query('SELECT status || \'|\' || safety_check_revision FROM public.events WHERE event_id = 99191 FOR UPDATE;');
  await waitsFor(root, deciding, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.equal(await deciding, `planning|${Number(listedRevision) + 1}`); await second.query('COMMIT;');
  await login(second, officer);
  assert.equal(JSON.parse(await second.query('SELECT public.safety_check_queue()::text;')).some(item => item.event_id === 99191), false);
  await second.query('COMMIT;');
  console.log('PASS [CONFLICT] [SG2-91:AC2] a safety decision waits for an arrangement change in flight, then sees the event back in Planning with a new revision.');

  // The last reservation and a new hold race for 99192. The hold waits for
  // the reservation's event lock, is accepted against the now-awaiting event,
  // and returns it to Planning: both moves are recorded, in order.
  await login(first, support); await login(second, staff);
  assert.equal(JSON.parse(await reserve(first, 99192, '2031-09-05')).outcome, 'ok');
  const holding = second.query(
    `SELECT public.create_venue_hold(99192,99190,'2031-09-07T02:00Z','2031-09-07T06:00Z',clock_timestamp()+interval '3 days')::text;`);
  await waitsFor(root, holding, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.equal(JSON.parse(await holding).outcome, 'created'); await second.query('COMMIT;');
  assert.equal((await statusOf(root, 99192)).split('|')[0], 'planning');
  assert.equal(await moves(root, 99192), 'planning>awaiting_safety_check,awaiting_safety_check>planning');
  console.log('PASS [CONFLICT] [SG2-91:AC1] a hold placed while the last equipment is reserved waits, then returns the event to Planning.');
} finally {
  for (const session of sessions) await session.end();
  const ids = people.map(id => `'${id}'`).join(',');
  const eventIds = events.join(',');
  await root.query(`ROLLBACK;
    DELETE FROM public.notifications WHERE event_id IN (${eventIds});
    DELETE FROM public.venue_hold_notifications WHERE event_id IN (${eventIds});
    DELETE FROM public.event_audit_logs WHERE event_id IN (${eventIds});
    UPDATE public.events SET venue_booking_id = NULL WHERE event_id IN (${eventIds});
    DELETE FROM public.equipment_reservations WHERE event_id IN (${eventIds});
    DELETE FROM public.equipment_requests WHERE event_id IN (${eventIds});
    DELETE FROM public.venue_holds WHERE event_id IN (${eventIds});
    DELETE FROM public.venue_booking_requests WHERE event_id IN (${eventIds});
    DELETE FROM public.venue_bookings WHERE event_id IN (${eventIds});
    DELETE FROM public.events WHERE event_id IN (${eventIds});
    DELETE FROM public.equipment WHERE equipment_id = 99190;
    DELETE FROM public.venues WHERE venue_id IN (99190,99191,99192);
    DELETE FROM public.account_roles WHERE user_id IN (${ids});
    DELETE FROM public.users WHERE user_id IN (${ids});
    DELETE FROM auth.users WHERE id IN (${ids});`);
  await root.end();
}

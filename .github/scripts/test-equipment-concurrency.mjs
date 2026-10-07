// SG2-52: two real PostgreSQL sessions edit the same version concurrently.
// Run only against disposable local/CI storage; no hosted database access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function connect() {
  assert.ok(process.env.POSTGRES_CONTAINER || process.env.PSQL_BIN,
    'Provide the disposable PostgreSQL container or local psql.');
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
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (!pending) continue;
      if (line === pending.marker) { pending.resolve(pending.lines.join('\n')); pending = undefined; }
      else pending.lines.push(line);
    }
  });
  return {
    query(sql) {
      assert.equal(pending, undefined, 'One query at a time per session.');
      return new Promise((resolve, reject) => {
        const marker = `EQUIPMENT_TEST_DONE_${++sequence}`;
        pending = { marker, lines: [], resolve, reject };
        psql.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async end() { psql.stdin.end(); await ended; }
  };
}

async function waitsFor(root, promise, waiting, owner) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(settled, false, 'The second edit must wait for the first transaction to release its row lock.');
    const blockers = await root.query(`SELECT pg_blocking_pids(${waiting})::text;`);
    if (blockers.slice(1, -1).split(',').includes(owner)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out observing the concurrent equipment edit waiting on its row lock.');
}

const staff = ['e5200000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000002'];
const root = connect();
const sessions = [];
try {
  await root.query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${staff[0]}'),('${staff[1]}');
    INSERT INTO public.account_roles(user_id,role) VALUES
      ('${staff[0]}','technical_support_staff'),('${staff[1]}','technical_support_staff');
    INSERT INTO public.equipment(equipment_id,name,description,quantity_total,location)
      VALUES(95290,'Concurrent microphones','Wireless handheld microphones',8,'Store A');
    COMMIT;`);
  const first = connect(); const second = connect(); sessions.push(first, second);
  const firstPid = await first.query('SELECT pg_backend_pid();');
  const secondPid = await second.query('SELECT pg_backend_pid();');
  await first.query(`BEGIN; SET LOCAL role authenticated;
    SELECT set_config('request.jwt.claim.sub','${staff[0]}',true);`);
  await second.query(`BEGIN; SET LOCAL role authenticated;
    SELECT set_config('request.jwt.claim.sub','${staff[1]}',true);`);

  assert.equal(await first.query(`UPDATE public.equipment SET quantity_total=7,operational_status='maintenance'
    WHERE equipment_id=95290 AND version=1 RETURNING version||'|'||quantity_total||'|'||available_quantity;`), '2|7|0');
  const competing = second.query(`UPDATE public.equipment SET quantity_total=99,operational_status='operational'
    WHERE equipment_id=95290 AND version=1 RETURNING version;`);
  await waitsFor(root, competing, secondPid, firstPid);
  await first.query('COMMIT;');
  assert.equal(await competing, '', 'After waiting, PostgreSQL must recheck the stale version and update no row.');
  await second.query('COMMIT;');
  assert.equal(await root.query(`SELECT version||'|'||quantity_total||'|'||operational_status||'|'||available_quantity
    FROM public.equipment WHERE equipment_id=95290;`), '2|7|maintenance|0');
  console.log('PASS [CONFLICT] [SG2-52:AC1] concurrent edits of one version commit only the first quantity/status change and increment once.');

  await second.query(`BEGIN; SET LOCAL role authenticated;
    SELECT set_config('request.jwt.claim.sub','${staff[1]}',true);`);
  assert.equal(await second.query(`UPDATE public.equipment SET operational_status='operational'
    WHERE equipment_id=95290 AND version=2 RETURNING version||'|'||quantity_total||'|'||available_quantity;`), '3|7|7');
  await second.query('COMMIT;');
  assert.equal(await root.query(`SELECT version||'|'||available_quantity FROM public.equipment WHERE equipment_id=95290;`), '3|7');
  console.log('PASS [NORMAL] [SG2-52:AC1] [SG2-52:AC2] a refreshed editor can save the current version and restore operational availability.');
} finally {
  for (const session of sessions) await session.end();
  await root.query(`DELETE FROM public.equipment WHERE equipment_id=95290;
    DELETE FROM public.account_roles WHERE user_id IN ('${staff[0]}','${staff[1]}');
    DELETE FROM auth.users WHERE id IN ('${staff[0]}','${staff[1]}');`);
  await root.end();
}

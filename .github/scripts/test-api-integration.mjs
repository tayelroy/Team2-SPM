// Real Express/Supabase-client/PostgREST/PostgreSQL integration, disposable only.
// No hosted URL, credentials, .env or destructive reset endpoint is accepted.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const suffix = `${process.pid}-${Date.now()}`;
const owned = !process.env.POSTGRES_CONTAINER;
const database = process.env.POSTGRES_CONTAINER || `spm-api-pg-${suffix}`;
const rest = `spm-api-rest-${suffix}`;
const secret = 'isolated-integration-jwt-secret-at-least-32-characters';
const resources = [];
let seeded = false;
function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 }).trim();
}
function sql(file) {
  execFileSync('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync(file), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, timeout: 60_000,
  });
}
try {
  if (owned) {
    docker('run', '--detach', '--name', database, '--env', 'POSTGRES_PASSWORD=ci-only-password', 'postgres:17');
    resources.push(database);
    for (let attempt = 0; ; attempt++) {
      const ready = spawnSync('docker', ['exec', database, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
      if (ready.status === 0) break;
      assert.ok(attempt < 60, 'Disposable PostgreSQL did not become ready.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    sql('supabase/tests/fixtures/auth.sql');
    for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
      sql(`supabase/migrations/${file}`);
    }
  }
  // Inspect only network identity; never print container environments.
  const inspection = JSON.parse(docker('inspect', database))[0];
  const networks = Object.entries(inspection.NetworkSettings.Networks);
  assert.equal(networks.length, 1, 'Use a disposable database on a single Docker network.');
  const [network, info] = networks[0];
  assert.ok(info.IPAddress, 'Disposable PostgreSQL needs a Docker-network address.');
  sql('supabase/checks/release_readiness.sql');
  seeded = true;
  sql('integration/seed.sql');
  docker('run', '--detach', '--name', rest, '--network', network, '--publish', '127.0.0.1::3000',
    '--env', `PGRST_DB_URI=postgres://postgres:ci-only-password@${info.IPAddress}:5432/postgres`,
    '--env', 'PGRST_DB_ANON_ROLE=anon', '--env', `PGRST_JWT_SECRET=${secret}`,
    'postgrest/postgrest:v12.2.12');
  resources.push(rest);
  const mapping = docker('port', rest, '3000/tcp');
  assert.match(mapping, /^127\.0\.0\.1:\d+$/);
  const url = `http://${mapping}`;
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* retry readiness only */ }
    assert.ok(attempt < 60, 'Disposable PostgREST did not become ready.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const env = { ...process.env, NODE_ENV: 'test', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    INTEGRATION_REST_URL: url, INTEGRATION_JWT_SECRET: secret };
  const compiled = spawnSync('npm', ['exec', '--workspace', 'server', '--', 'tsc', '-p', '../integration/tsconfig.json'], { env, stdio: 'inherit' });
  assert.equal(compiled.status, 0, 'Integration tests must type-check.');
  const result = spawnSync('npm', ['exec', '--workspace', 'server', '--', 'tsx', '--test', '../integration/api.test.ts'], { env, stdio: 'inherit' });
  assert.equal(result.status, 0, 'Database-backed API integration tests failed.');
} finally {
  if (seeded && !owned) {
    try { sql('integration/cleanup.sql'); } catch (error) { console.error('Synthetic integration cleanup failed:', error.message); process.exitCode = 1; }
  }
  for (const name of resources.reverse()) {
    try { docker('rm', '--force', name); } catch { console.error(`Could not remove disposable container ${name}.`); }
  }
}

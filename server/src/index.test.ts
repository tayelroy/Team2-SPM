import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './app';
import { dbConfig } from './db';

const originalConfig = { ...dbConfig };
const originalPort = process.env.PORT;

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
  delete require.cache[require.resolve('./index')];
});

for (const configured of [false, true]) {
  test(`startup uses the ${configured ? 'configured' : 'default'} port and reports configuration`, () => {
    if (configured) process.env.PORT = '7001';
    else delete process.env.PORT;
    dbConfig.supabaseUrl = configured ? 'https://test-project.supabase.co' : undefined;
    dbConfig.supabaseAnonKey = configured ? 'fake-key' : undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
    const log = mock.method(console, 'log', () => {});
    const listen = mock.method(app, 'listen', (port: number | string, callback: () => void) => {
      assert.equal(port, configured ? '7001' : 5000);
      callback();
    });
    require('./index');
    assert.equal(listen.mock.callCount(), 1);
    assert.ok(log.mock.calls.some((call) => String(call.arguments[0]).includes(configured ? '[CONFIGURED]' : '[UNCONFIGURED]')));
  });
}

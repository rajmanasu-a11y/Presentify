import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, closeAll, env, newClient } from './_helpers.mjs';

after(closeAll);

describe('gateway', () => {
  test('serves the app with security headers', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('server'), 'nginx'); // no version disclosed
  });

  test('client-side routes fall back to the app', async () => {
    const res = await fetch(`${BASE_URL}/console/organisations`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<div id="root">/);
  });

  test('runtime config exposes only public values', async () => {
    const text = await (await fetch(`${BASE_URL}/config.js`)).text();
    assert.ok(text.includes(env.ANON_KEY));
    assert.ok(!text.includes(env.SERVICE_ROLE_KEY), 'service key must never reach the browser');
    assert.ok(!text.includes(env.JWT_SECRET));
    assert.ok(!text.includes(env.POSTGRES_PASSWORD));
  });

  test('Auth administration endpoints are blocked from outside', async () => {
    const res = await fetch(`${BASE_URL}/auth/v1/admin/users`, {
      headers: { Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, apikey: env.SERVICE_ROLE_KEY },
    });
    assert.equal(res.status, 403);
  });

  test('public sign-up is disabled', async () => {
    const { error } = await newClient().auth.signUp({ email: 'stranger@example.com', password: 'Stranger#2026x' });
    assert.ok(error, 'sign-up must fail');
  });

  test('server functions reject requests without a valid token', async () => {
    const none = await fetch(`${BASE_URL}/functions/v1/manage-users`, { method: 'POST', body: '{}' });
    assert.equal(none.status, 401);
    const forged = await fetch(`${BASE_URL}/functions/v1/manage-users`, {
      method: 'POST', body: '{}',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.invalidsignature' },
    });
    assert.equal(forged.status, 401);
  });

  test('shared function code is not reachable as a function', async () => {
    const res = await fetch(`${BASE_URL}/functions/v1/_shared`, { method: 'POST', headers: { Authorization: `Bearer ${env.ANON_KEY}` } });
    assert.equal(res.status, 404);
  });

  test('anonymous visitors cannot read any table', async () => {
    const client = newClient();
    for (const table of ['organisations', 'profiles', 'packages', 'audit_logs', 'login_events', 'organisation_settings', 'system_settings']) {
      const { data, error } = await client.from(table).select('*').limit(1);
      assert.ok(error || data.length === 0, `${table} must not be readable anonymously`);
    }
  });

  test('anonymous visitors cannot call staff functions', async () => {
    const { error } = await newClient().rpc('organisation_usage', { p_org: '00000000-0000-0000-0000-000000000000' });
    assert.ok(error);
  });
});

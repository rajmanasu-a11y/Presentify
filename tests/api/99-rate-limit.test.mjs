// Runs last: it deliberately exhausts the sign-in rate limit for this machine.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, closeAll, env } from './_helpers.mjs';

after(closeAll);

test('rapid sign-in attempts from one address are slowed down with a clear message', async () => {
  const limit = Number(env.SIGNIN_RATE_PER_MINUTE ?? 30);
  let limited = null;
  // burst allowance equals the per-minute rate, so 2× the rate must hit the limiter
  for (let i = 0; i < limit * 2 + 10 && !limited; i++) {
    const res = await fetch(`${BASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.presentify.local', password: 'Wrong#Password1' }),
    });
    if (res.status === 429) limited = res;
    else await res.body?.cancel();
  }
  assert.ok(limited, 'the gateway must start refusing');
  assert.equal(limited.headers.get('retry-after'), '60');
  const body = await limited.json();
  assert.equal(body.error, 'rate_limited');
});

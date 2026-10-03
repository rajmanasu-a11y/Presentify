// Repository hygiene that protects the Windows installation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

test('Windows scripts are plain ASCII (Windows PowerShell 5.1 misreads other characters)', () => {
  for (const f of tracked.filter((p) => /\.(ps1|cmd)$/.test(p))) {
    const bad = [...readFileSync(new URL(f, root), 'utf8')].findIndex((c) => c.charCodeAt(0) > 127);
    assert.equal(bad, -1, `${f} contains a non-ASCII character at position ${bad}`);
  }
});

test('line endings: Linux scripts stay LF, Windows scripts become CRLF', () => {
  const attr = (file) => execFileSync('git', ['check-attr', 'eol', '--', file], { cwd: root, encoding: 'utf8' }).trim().split(': ').pop();
  assert.equal(attr('install.sh'), 'lf');
  assert.equal(attr('scripts/test.sh'), 'lf');
  assert.equal(attr('supabase/migrations/0001_foundation.sql'), 'lf');
  assert.equal(attr('install.ps1'), 'crlf');
  assert.equal(attr('install.cmd'), 'crlf');
});

test('no secrets or local settings are committed', () => {
  for (const f of tracked) {
    assert.ok(!/(^|\/)\.env(\.test)?$/.test(f), `${f} must not be committed`);
    assert.ok(!/\.crt$/.test(f), `${f} (certificate) must not be committed`);
  }
});

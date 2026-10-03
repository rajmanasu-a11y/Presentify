// Load check: many phones scan the QR code at the same moment, all from one
// venue network (one public address), and each opens a PDF. Like the real page,
// a phone told "busy" (429, 502, 503) waits and tries again.
//   node load/qr-rush.mjs [participants=300] [concurrency=60]
// Runs against the test stack (scripts/test.sh with KEEP_STACK=1).
import { performance } from 'node:perf_hooks';
import {
  BASE_URL, closeAll, createMeeting, createOrganisation, createPresentation, createSession, createStaff, createSuperAdmin, db,
  makePdf, publicCall, upload,
} from '../api/_helpers.mjs';

const total = Number(process.argv[2] ?? 300);
const concurrency = Number(process.argv[3] ?? 60);

const sa = await createSuperAdmin();
const org = await createOrganisation(sa.client, { max_participants_per_meeting: Math.max(total + 10, 500) });
const admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
const m = await createMeeting(admin.client, { title: 'Load check (DEMO)' });
const s = await createSession(admin.client, m.id);
const p = await createPresentation(admin.client, s.id, 'Deck');
await upload(admin.client, { purpose: 'PRESENTATION', target: p.id, name: 'deck.pdf', bytes: makePdf(20) });
await admin.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', m.id);
await admin.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);
const token = (await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [m.id])).rows[0].token;

const timings = { page: [], info: [], register: [], content: [], file: [], download: [] };
let retries = 0;
// Like the real participant page: when the gateway says "busy" (429), wait and try again (up to 4 times).
async function call(action, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await publicCall(action, body);
    if (![429, 502, 503].includes(r.status) || attempt >= 4) return r;
    retries++;
    await new Promise((res) => setTimeout(res, (1000 + Math.random() * 2000) * 2 ** attempt));
  }
}
const failures = {};
const fail = (step, why) => { const k = `${step}: ${why}`; failures[k] = (failures[k] ?? 0) + 1; };
const timed = async (step, fn) => {
  const t0 = performance.now();
  try { return await fn(); } finally { timings[step].push(performance.now() - t0); }
};

async function participant(i) {
  const page = await timed('page', () => fetch(`${BASE_URL}/m/${token}`));
  if (page.status !== 200) return fail('page', page.status);
  const info = await timed('info', () => call('info', { token }));
  if (info.status !== 200) return fail('info', info.status);
  const reg = await timed('register', () => call('register', {
    token, consent: true, fields: { name: `Participant ${i} (DEMO)`, designation: 'Officer', organisation: 'Load Test' },
  }));
  if (reg.status !== 201) return fail('register', `${reg.status} ${reg.body?.error?.code ?? ''}`);
  const access = reg.body.access_token;
  const content = await timed('content', () => call('content', { token, access }));
  if (content.body?.state !== 'OPEN') return fail('content', content.status);
  const file = await timed('file', () => call('file', { token, access, kind: 'presentation', id: p.id, mode: 'view' }));
  if (file.status !== 200) return fail('file', file.status);
  const pdf = await timed('download', async () => { const r = await fetch(`${BASE_URL}${file.body.url}`); await r.arrayBuffer(); return r; });
  if (pdf.status !== 200) return fail('download', pdf.status);
}

const started = performance.now();
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < total) await participant(next++);
}));
const seconds = (performance.now() - started) / 1000;

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(0) : '-'; };
console.log(`\n${total} participants, ${concurrency} at a time, one network address: ${seconds.toFixed(1)} s`);
console.log('step       count   median ms   95% ms   max ms');
for (const [step, a] of Object.entries(timings)) {
  console.log(`${step.padEnd(10)} ${String(a.length).padStart(5)} ${pct(a, 0.5).padStart(11)} ${pct(a, 0.95).padStart(8)} ${pct(a, 0.999).padStart(8)}`);
}
const registered = (await db.query('select count(*)::int as n from public.attendance where meeting_id = $1', [m.id])).rows[0].n;
console.log(`registered in database: ${registered}; automatic retries after "busy": ${retries}`);
console.log(Object.keys(failures).length ? `failures: ${JSON.stringify(failures)}` : 'failures: none');
await closeAll();
process.exit(Object.keys(failures).length ? 1 : 0);

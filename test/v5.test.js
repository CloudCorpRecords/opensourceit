// v0.5.0 — launch & scale: badge, repo-stats, changelog, spam auto-flag, honeypot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3919;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
const j = async (p, o) => { const r = await fetch(BASE + p, o); return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers }; };

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not come up');
}
before(async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await waitFor(BASE + '/api/health');
});
after(() => { child?.kill('SIGKILL'); });

test('health reports 0.5.1', async () => {
  const { body } = await j('/api/health');
  assert.equal(body.version, '0.5.1');
});

test('badge endpoint serves an SVG shield for any repo', async () => {
  const r = await fetch(BASE + '/badge/CloudCorpRecords/opensourceit.svg');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
  const svg = await r.text();
  assert.match(svg, /opensourceit/);
  assert.match(svg, /discuss/);
});

test('changelog page renders the real changelog', async () => {
  const r = await fetch(BASE + '/changelog');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /0\.5\.0/);
  assert.match(html, /launch &amp; scale|launch & scale/i);
});

test('repo-stats responds with sourced numbers or an honest unavailable', async () => {
  const { status, body } = await j('/api/repo-stats');
  assert.equal(status, 200);
  assert.ok('stars' in body || body.unavailable === true);
});

test('honeypot: a filled hidden field gets fake success and is NOT stored', async () => {
  const before = await j('/api/posts?sort=new');
  const n0 = before.body.length;
  const { status } = await j('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'bot bait ' + Date.now(), community: 'meta', author: 'botty', disclosure: 'human', body: 'spam', website: 'http://spam.example' }) });
  assert.equal(status, 201);
  const after = await j('/api/posts?sort=new');
  assert.equal(after.body.length, n0, 'honeypot post must not be stored');
});

test('auto-flag: link-heavy post is published AND lands in the mod queue', async () => {
  const links = Array.from({ length: 7 }, (_, i) => 'https://example' + i + '.com').join(' ');
  const { status, body } = await j('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'link farm ' + Date.now(), community: 'meta', author: 'flagtester', disclosure: 'human', body: 'check these out: ' + links + ' and some real words to pass the short-post guard, plus more genuine description text so the length is comfortably over two hundred characters in total length yes indeed.' }) });
  assert.equal(status, 201);
  assert.ok((body.reports || []).some(r => r.by === 'auto-guard'), 'auto-guard report attached');
  const q = await j('/api/mod/queue?by=rene');
  assert.ok(JSON.stringify(q.body).includes('link farm'), 'flagged post visible in mod queue');
});

test('normal post is NOT auto-flagged', async () => {
  const { status, body } = await j('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'a perfectly normal post ' + Date.now(), community: 'meta', author: 'flagtester', disclosure: 'human', body: 'Just one link https://example.com and honest text.' }) });
  assert.equal(status, 201);
  assert.equal((body.reports || []).filter(r => r.by === 'auto-guard').length, 0);
});

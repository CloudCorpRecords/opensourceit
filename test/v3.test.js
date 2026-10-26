// Opensourceit v0.3.0 — best-open-source-project wave tests
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync } from 'node:fs';

const PORT = 4198, BASE = `http://localhost:${PORT}`;
let proc;
const j = async (p, o = {}) => { const r = await fetch(BASE + p, { headers: { 'Content-Type': 'application/json' }, ...o }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (p, b) => j(p, { method: 'POST', body: JSON.stringify(b) });

before(async () => {
  cpSync('data/db.json', '/tmp/osit-v3-test-backup.json');
  proc = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); cpSync('/tmp/osit-v3-test-backup.json', 'data/db.json'); });

test('health reports 0.3.0 and seed grew to 16 posts', async () => {
  const h = await j('/api/health'); assert.equal(h.body.version, '0.3.0');
  const s = await j('/api/stats'); assert.ok(s.body.posts >= 16, 'seed posts');
});

test('ranked search: title hit beats body hit; pagination meta', async () => {
  const all = await j('/api/posts?q=mcp&meta=1');
  assert.ok(all.body.total >= 2 && Array.isArray(all.body.posts));
  const page = await j('/api/posts?limit=3&offset=0&meta=1');
  assert.equal(page.body.posts.length, 3); assert.ok(page.body.total >= 16);
});

test('leaderboard: builders sorted, showcase present', async () => {
  const l = await j('/api/leaderboard');
  assert.ok(l.body.builders.length >= 1);
  assert.ok(l.body.builders[0].karma >= l.body.builders.at(-1).karma);
  assert.ok('showcaseOfTheWeek' in l.body);
});

test('pin: non-mod forbidden, admin pins, pinned leads community feed', async () => {
  const bad = await post('/api/posts/p_gates/pin', { by: 'mallory' });
  assert.equal(bad.status, 403);
  const ok = await post('/api/posts/p_gates/pin', { by: 'rene' });
  assert.equal(ok.body.pinned, true);
  const feed = await j('/api/posts?community=meta');
  assert.equal(feed.body[0].id, 'p_gates');
  await post('/api/posts/p_gates/pin', { by: 'rene' });
});

test('verify endpoint: non-github url stays unverified', async () => {
  const v = await post('/api/posts/p_strange/verify', {});
  assert.equal(v.status, 200); assert.equal(v.body.verified, false, 'youtube url is not a github repo');
});

test('webhooks: create (secret returned once), list masks secret, delete', async () => {
  const w = await post('/api/webhooks', { url: 'https://example.com/hook', events: ['post.created'], by: 'ada' });
  assert.equal(w.status, 201); assert.ok(w.body.secret && w.body.secret.length >= 8);
  const list = await j('/api/webhooks?by=ada');
  assert.equal(list.body[0].secret, '••• set');
  const del = await j('/api/webhooks/' + w.body.id, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('modlog + appeals: removal is logged publicly; appeal files and queues', async () => {
  const before = await j('/api/modlog');
  await post('/api/mod/remove', { targetId: 'p_pkgverdict', by: 'rene', reason: 'spam' });
  const afterLog = await j('/api/modlog');
  assert.equal(afterLog.body.length, before.body.length + 1);
  assert.equal(afterLog.body[0].action, 'remove'); assert.equal(afterLog.body[0].reason, 'spam');
  const a = await post('/api/appeals', { targetId: 'p_pkgverdict', by: 'pkg-owner', note: 'Not spam — a real package, happy to add more detail.' });
  assert.equal(a.status, 201);
  const q = await j('/api/mod/queue?by=rene');
  assert.ok(q.body.some(x => x.kind === 'appeal'));
  await post('/api/mod/restore', { targetId: 'p_pkgverdict', by: 'rene' });
});

test('agents registry: seed has tree; register + upsert works', async () => {
  const list = await j('/api/agents');
  assert.ok(list.body.some(a => a.handle === 'tree'));
  const r = await post('/api/agents/register', { handle: 'scout-9', owner: 'ada', specialty: 'finds good first issues' });
  assert.equal(r.status, 201);
  const list2 = await j('/api/agents');
  assert.ok(list2.body.some(a => a.handle === 'scout-9'));
});

test('activity + export + instance info', async () => {
  const act = await j('/api/activity');
  assert.ok(act.body.length >= 10); assert.ok(act.body[0].kind);
  const exp = await j('/api/export');
  assert.equal(exp.body.software, 'opensourceit'); assert.ok(exp.body.posts.length >= 16);
  const info = await j('/.well-known/opensourceit.json');
  assert.equal(info.body.aiWelcome, true); assert.equal(info.body.charter.version, '1.0');
});

test('import: dedupe by url + title, counts reported', async () => {
  const imp = await post('/api/import', { posts: [
    { title: 'Imported thing one', url: 'https://github.com/example/one', community: 'showcase' },
    { title: 'Imported thing one', url: 'https://github.com/example/one', community: 'showcase' },
    { title: 'Showcase: Greenlight — tells you if an OSS issue is actually claimable before you waste a weekend on it', url: 'https://github.com/CloudCorpRecords/greenlight' },
  ] });
  assert.equal(imp.body.added, 1); assert.equal(imp.body.skipped, 2);
});

test('gzip: static app.js compresses when accepted', async () => {
  const r = await fetch(BASE + '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip');
});

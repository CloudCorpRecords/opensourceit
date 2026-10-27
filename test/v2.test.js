// Opensourceit v0.2.0 — ten-round expansion tests
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync } from 'node:fs';

const PORT = 4199, BASE = `http://localhost:${PORT}`;
let proc;
const j = async (p, o = {}) => { const r = await fetch(BASE + p, { headers: { 'Content-Type': 'application/json' }, ...o }); return { status: r.status, body: await r.json().catch(() => ({})) , text: r.status === 200 && o.raw ? await r.text().catch(() => '') : '' }; };
const post = (p, b) => j(p, { method: 'POST', body: JSON.stringify(b) });

before(async () => {
  cpSync('data/db.json', '/tmp/osit-v2-test-backup.json');
  proc = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); cpSync('/tmp/osit-v2-test-backup.json', 'data/db.json'); });

test('health reports 0.2.0', async () => {
  const { body } = await j('/api/health');
  assert.equal(body.version, '0.5.0'); assert.equal(body.aiWelcome, true);
});

test('profile: karma, counts, disclosure mix', async () => {
  const { body } = await j('/api/users/rene');
  assert.equal(body.handle, 'rene');
  assert.equal(body.karma, 17, 'honest karma: 15 posts + 2 comments, score 1 each (v0.4.0 reset)');
  assert.ok(body.postCount >= 3);
  assert.ok(body.disclosures['ai-built'] >= 1);
});

test('create community + post in it + duplicate rejected', async () => {
  const c = await post('/api/communities', { id: 'testville', title: 'Testville', author: 'rene', rules: ['be kind'] });
  assert.equal(c.status, 201); assert.equal(c.body.createdBy, 'rene');
  const dup = await post('/api/communities', { id: 'testville', title: 'Again', author: 'x' });
  assert.equal(dup.status, 409);
  const p = await post('/api/posts', { title: 'Hello testville', body: '**md** works', community: 'testville', author: 'ada', disclosure: 'human' });
  assert.equal(p.status, 201); assert.equal(p.body.type, 'discussion');
});

test('edit + delete own post; others forbidden', async () => {
  const p = await post('/api/posts', { title: 'Editable', body: 'v1', community: 'meta', author: 'ada' });
  const id = p.body.id;
  const forbidden = await j('/api/posts/' + id, { method: 'PUT', body: JSON.stringify({ author: 'mallory', body: 'hax' }) });
  assert.equal(forbidden.status, 403);
  const ok = await j('/api/posts/' + id, { method: 'PUT', body: JSON.stringify({ author: 'ada', body: 'v2' }) });
  assert.equal(ok.status, 200); assert.equal(ok.body.body, 'v2'); assert.ok(ok.body.editedAt);
  const del = await j('/api/posts/' + id, { method: 'DELETE', body: JSON.stringify({ author: 'ada' }) });
  assert.equal(del.status, 200);
  const gone = await j('/api/posts/' + id);
  assert.equal(gone.status, 404);
});

test('report "ai" rejected; conduct report + mod remove/restore roundtrip', async () => {
  const bad = await post('/api/report', { targetType: 'post', targetId: 'p_welcome', reason: 'ai', by: 'troll' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /never a valid report/);
  const good = await post('/api/report', { targetType: 'post', targetId: 'p_welcome', reason: 'spam', by: 'ada' });
  assert.equal(good.status, 201);
  const q = await j('/api/mod/queue?by=rene');
  assert.ok(q.body.some(x => x.id === 'p_welcome'));
  const rm = await post('/api/mod/remove', { targetId: 'p_welcome', by: 'ada', reason: 'spam' });
  assert.equal(rm.status, 403, 'non-mod cannot remove');
  const rm2 = await post('/api/mod/remove', { targetId: 'p_welcome', by: 'rene', reason: 'spam' });
  assert.equal(rm2.status, 200); assert.equal(rm2.body.removed, true);
  const rs = await post('/api/mod/restore', { targetId: 'p_welcome', by: 'rene' });
  assert.equal(rs.body.removed, false);
});

test('filters: disclosure + tag + rising sort', async () => {
  const { body } = await j('/api/posts?disclosure=ai-built&sort=rising');
  assert.ok(body.length >= 1); assert.ok(body.every(p => p.disclosure === 'ai-built'));
  const t = await j('/api/posts?tag=mcp');
  assert.ok(t.body.some(p => (p.tags || []).includes('mcp')));
});

test('stats + digest + trending shapes', async () => {
  const s = await j('/api/stats');
  assert.equal(s.body.version, '0.5.0'); assert.ok(s.body.communities >= 7);
  const d = await j('/api/digest');
  assert.equal(d.body.periodDays, 7); assert.ok(Array.isArray(d.body.top));
  const tr = await j('/api/trending');
  assert.ok(Array.isArray(tr.body));
});

test('social: follow/save + inbox has seed replies for rene', async () => {
  const f = await post('/api/social/follow', { handle: 'ada', kind: 'community', target: 'meta' });
  assert.equal(f.body.following, true);
  const sv = await post('/api/social/save', { handle: 'ada', postId: 'p_welcome' });
  assert.equal(sv.body.saved, true);
  const soc = await j('/api/social/ada');
  assert.equal(soc.body.savedPosts.length, 1);
  const inbox = await j('/api/inbox/rene');
  assert.ok(inbox.body.items.length >= 1, 'rene has replies in seed data');
});

test('feeds: rss + json feed + embed + docs respond', async () => {
  for (const p of ['/rss/meta', '/feed.json', '/embed/p_welcome', '/api/docs', '/sitemap.xml', '/manifest.json']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
  }
  const rss = await (await fetch(BASE + '/rss/meta')).text();
  assert.match(rss, /<rss/);
});

test('comment edit endpoint: author only', async () => {
  const c = await post('/api/posts/p_welcome/comments', { body: 'original', author: 'ada', disclosure: 'human' });
  const cid = c.body.id;
  const bad = await j('/api/comments/' + cid, { method: 'PUT', body: JSON.stringify({ author: 'mallory', body: 'hax' }) });
  assert.equal(bad.status, 403);
  const ok = await j('/api/comments/' + cid, { method: 'PUT', body: JSON.stringify({ author: 'ada', body: 'edited!' }) });
  assert.equal(ok.status, 200); assert.equal(ok.body.body, 'edited!');
});

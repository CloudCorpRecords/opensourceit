// v0.4.0 — durability + solidity: git-backed store, SSR-lite seed, cache headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { GitStore, remoteConfig } from '../src/remotedb.js';

const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not come up: ' + url);
}
before(async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await waitFor(BASE + '/api/health');
});
after(() => { child?.kill('SIGKILL'); });

// ---- GitStore unit tests (fake GitHub) ----
function fakeGitHub() {
  const files = new Map(); // path -> {content(b64), sha}
  let shaN = 0;
  const fn = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET') {
      const f = files.get('db');
      if (!f) return { status: 404, ok: false, json: async () => ({}) };
      return { status: 200, ok: true, json: async () => ({ sha: f.sha, content: f.content }) };
    }
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      const f = files.get('db');
      if (f && body.sha !== f.sha) return { status: 409, ok: false, json: async () => ({}) };
      const sha = 'sha' + (++shaN);
      files.set('db', { content: body.content, sha });
      return { status: 200, ok: true, json: async () => ({ content: { sha } }) };
    }
    throw new Error('unexpected ' + method);
  };
  return { fn, files };
}

test('remoteConfig: only on in github mode with token+repo', () => {
  assert.equal(remoteConfig({}), null);
  assert.equal(remoteConfig({ OSIT_DB_MODE: 'github' }), null);
  const c = remoteConfig({ OSIT_DB_MODE: 'github', GITHUB_TOKEN: 'x', OSIT_DB_REPO: 'o/r' });
  assert.equal(c.branch, 'data-live');
});

test('GitStore: first boot seeds the branch file', async () => {
  const { fn, files } = fakeGitHub();
  const seed = { posts: [{ id: 'a' }], communities: [] };
  const store = new GitStore({ token: 't', repo: 'o/r', branch: 'data-live', path: 'data/db.json' }, seed, fn);
  const db = await store.load();
  assert.equal(db.posts.length, 1);
  assert.ok(files.get('db'), 'seed persisted to the branch');
});

test('GitStore: save persists mutations; fresh instance reloads them (the persistence proof)', async () => {
  const { fn } = fakeGitHub();
  const cfg = { token: 't', repo: 'o/r', branch: 'data-live', path: 'data/db.json' };
  const s1 = new GitStore(cfg, { posts: [], communities: [] }, fn);
  const db = await s1.load();
  db.posts.push({ id: 'user-post', title: 'someone real posted this' });
  await s1.save(db);
  const s2 = new GitStore(cfg, { posts: [], communities: [] }, fn); // a "cold start"
  const db2 = await s2.load();
  assert.equal(db2.posts.length, 1);
  assert.equal(db2.posts[0].title, 'someone real posted this');
});

test('GitStore: sha conflict retries once and still lands the write', async () => {
  const { fn, files } = fakeGitHub();
  const cfg = { token: 't', repo: 'o/r', branch: 'data-live', path: 'data/db.json' };
  const a = new GitStore(cfg, { posts: [], communities: [] }, fn);
  const b = new GitStore(cfg, { posts: [], communities: [] }, fn);
  const dba = await a.load(); const dbb = await b.load();
  dba.posts.push({ id: 'from-a' }); await a.save(dba);
  dbb.posts.push({ id: 'from-b' }); await b.save(dbb); // b's sha is stale → 409 → refetch → retry
  const raw = JSON.parse(Buffer.from(files.get('db').content, 'base64').toString('utf8'));
  assert.ok(raw.posts.some(p => p.id === 'from-b'), 'second writer landed after retry');
});

test('GitStore: load degrades to seed when GitHub is unreachable (never 500s the site)', async () => {
  const down = async () => { throw new Error('network down'); };
  const store = new GitStore({ token: 't', repo: 'o/r', branch: 'data-live', path: 'data/db.json' }, { posts: [{ id: 'seed' }], communities: [] }, down);
  const db = await store.load();
  assert.equal(db.posts[0].id, 'seed');
  assert.ok(store.status().lastError);
});

// ---- Server integration ----
test('health reports the storage mode', async () => {
  const h = await (await fetch(BASE + '/api/health')).json();
  assert.equal(h.version, '0.5.1');
  assert.equal(h.storage.mode, 'file'); // no env in test → local file mode
});

test('SSR-lite: homepage inlines the seed feed for instant first paint', async () => {
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /window\.__SEED__/);
  assert.match(html, /ProdForge/);
});

test('static assets carry cache headers; index stays fresh', async () => {
  const css = await fetch(BASE + '/style.css');
  assert.match(css.headers.get('cache-control') || '', /max-age=300/);
  const idx = await fetch(BASE + '/');
  assert.equal(idx.headers.get('cache-control'), 'no-cache');
});

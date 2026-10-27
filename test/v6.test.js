// v0.5.1 — Threads conjunction: threadsUrl validation across create/edit/agent-submit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3921;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
const j = async (p, o) => { const r = await fetch(BASE + p, o); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (body) => j('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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

test('post accepts a real Threads URL and keeps it', async () => {
  const { status, body } = await post({ title: 'threads link ' + Date.now(), community: 'meta', author: 'threadfan', disclosure: 'human', body: 'discuss both places', threadsUrl: 'https://www.threads.net/@someone/post/AbC123' });
  assert.equal(status, 201);
  assert.equal(body.threadsUrl, 'https://www.threads.net/@someone/post/AbC123');
});

test('non-Threads URLs are stripped, not stored', async () => {
  const { status, body } = await post({ title: 'threads strip ' + Date.now(), community: 'meta', author: 'threadfan', disclosure: 'human', body: 'nope', threadsUrl: 'https://evil.example/phish' });
  assert.equal(status, 201);
  assert.equal(body.threadsUrl, '');
});

test('author can set threadsUrl later via edit; others cannot', async () => {
  const { body: created } = await post({ title: 'threads edit ' + Date.now(), community: 'meta', author: 'threadfan', disclosure: 'human', body: 'later' });
  const ok = await j('/api/posts/' + created.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'threadfan', threadsUrl: 'https://www.threads.com/@x/post/Zz9' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.threadsUrl, 'https://www.threads.com/@x/post/Zz9');
  const no = await j('/api/posts/' + created.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'someoneelse', threadsUrl: 'https://www.threads.com/@x/post/Zz9' }) });
  assert.equal(no.status, 403);
});

// Opensourceit — zero-dependency Node server
// MIT License

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;
const DB_PATH = join(__dir, 'data', 'db.json');
const PUBLIC = join(__dir, 'public');
const DISCLOSURES = ['human', 'ai-assisted', 'ai-built', 'agent'];

let CACHE = null;
function loadDB() {
  if (CACHE) return CACHE;
  CACHE = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  return CACHE;
}
function saveDB(db) {
  CACHE = db;
  // Serverless hosts (Vercel) have a read-only FS: keep the in-memory copy
  // authoritative there and persist to disk only where we can.
  try { writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function score(post) { return post.score || 0; }
function hot(p) {
  const ageH = (Date.now() - new Date(p.createdAt).getTime()) / 3.6e6;
  return score(p) / Math.pow(ageH + 2, 1.4);
}
function send(res, code, obj, type = 'application/json') {
  const body = type === 'application/json' ? JSON.stringify(obj) : obj;
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}
function clean(s, max = 5000) { return String(s ?? '').trim().slice(0, max); }

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- API ----
  if (path === '/api/health') return send(res, 200, { ok: true, name: 'opensourceit', version: '0.1.0', aiWelcome: true });

  if (path === '/api/communities' && req.method === 'GET') {
    return send(res, 200, loadDB().communities);
  }

  if (path === '/api/posts' && req.method === 'GET') {
    const db = loadDB();
    let posts = [...db.posts];
    const c = url.searchParams.get('community');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'hot';
    if (c) posts = posts.filter(p => p.community === c);
    if (q) posts = posts.filter(p => (p.title + ' ' + p.body + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(q));
    if (sort === 'new') posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'top') posts.sort((a, b) => score(b) - score(a));
    else posts.sort((a, b) => hot(b) - hot(a));
    return send(res, 200, posts);
  }

  const postMatch = path.match(/^\/api\/posts\/([\w-]+)$/);
  if (postMatch && req.method === 'GET') {
    const p = loadDB().posts.find(x => x.id === postMatch[1]);
    return p ? send(res, 200, p) : send(res, 404, { error: 'post not found' });
  }

  if (path === '/api/posts' && req.method === 'POST') {
    const b = await body(req);
    const title = clean(b.title, 300), community = clean(b.community, 50), author = clean(b.author, 40) || 'anon';
    const disclosure = DISCLOSURES.includes(b.disclosure) ? b.disclosure : 'ai-assisted';
    if (!title || !community) return send(res, 400, { error: 'title and community are required' });
    const db = loadDB();
    if (!db.communities.find(c => c.id === community)) return send(res, 400, { error: 'unknown community' });
    const post = { id: 'p_' + randomUUID().slice(0, 8), title, body: clean(b.body), url: clean(b.url, 2000), community, author, disclosure, tags: Array.isArray(b.tags) ? b.tags.map(t => clean(t, 30)).slice(0, 5) : [], score: 1, comments: [], createdAt: new Date().toISOString() };
    db.posts.unshift(post); saveDB(db);
    return send(res, 201, post);
  }

  // ---- Agent submit: the super-easy path ----
  // An agent sends ONE field — a GitHub repo — and we fill in the rest.
  if (path === '/api/agent/info' && req.method === 'GET') {
    return send(res, 200, {
      name: 'opensourceit', version: '0.1.0', aiWelcome: true,
      submit: {
        easiest: 'POST /api/agent/submit with { "repo": "owner/name", "author": "your-handle", "disclosure": "ai-built" } — title, description, license, stars, language, tags and community are auto-filled from GitHub.',
        mcp: { command: 'npx', args: ['-y', '@reneturcios/opensourceit', 'mcp'], tool: 'submit_repo' },
        cli: 'npx -y @reneturcios/opensourceit submit --repo owner/name --as your-handle --disclosure ai-built',
      },
      disclosures: DISCLOSURES,
      communities: loadDB().communities.map(c => c.id),
      rule: 'AI-built, AI-assisted and agent-authored projects are welcome. Disclosure is required; using AI is never grounds for removal.',
    });
  }

  if (path === '/api/agent/submit' && req.method === 'POST') {
    const b = await body(req);
    try {
      if (b.repo) {
        const slug = String(b.repo).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
        let repo = null;
        try {
          const gr = await fetch(`https://api.github.com/repos/${slug}`, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'opensourceit' }, signal: AbortSignal.timeout(6000) });
          if (gr.ok) repo = await gr.json();
        } catch {}
        if (repo) {
          const topics = repo.topics || [];
          const community = clean(b.community, 50) || (topics.includes('mcp') || topics.includes('model-context-protocol') ? 'mcp' : (topics.some(t => /ai|llm|agent/.test(t)) ? 'ai' : 'showcase'));
          b.title = b.title || `${repo.name}: ${repo.description || 'an open source project'}`;
          b.body = b.body || [repo.description || '', '', `⭐ ${repo.stargazers_count} · License: ${repo.license?.spdx_id || 'see repo'} · Language: ${repo.language || '—'}`, '', 'Posted via Opensourceit agent submit — AI welcome here, disclosure included.'].join('\n').trim();
          b.url = repo.html_url; b.community = community; b.tags = b.tags || [...topics, 'github'].slice(0, 5);
        } else {
          // GitHub unreachable/slow — never block an agent's submission on it.
          const name = slug.split('/')[1] || slug;
          b.title = b.title || `${name}: an open source project`;
          b.body = b.body || 'Posted via Opensourceit agent submit — AI welcome here, disclosure included. (GitHub metadata fetch was unavailable at submit time.)';
          b.url = `https://github.com/${slug}`; b.community = clean(b.community, 50) || 'showcase'; b.tags = b.tags || ['github'];
        }
      }
      const title = clean(b.title, 300), community = clean(b.community, 50) || 'showcase', author = clean(b.author, 40) || 'agent';
      if (!title) return send(res, 400, { error: 'title is required (or pass repo: "owner/name" and we fill it in)' });
      const db = loadDB();
      if (!db.communities.find(c => c.id === community)) return send(res, 400, { error: 'unknown community: ' + community });
      const postUrl = clean(b.url, 2000);
      if (postUrl) { const existing = db.posts.find(p => p.url === postUrl); if (existing) return send(res, 200, { ...existing, deduped: true }); }
      const post = { id: 'p_' + randomUUID().slice(0, 8), title, body: clean(b.body), url: postUrl, community, author, disclosure: DISCLOSURES.includes(b.disclosure) ? b.disclosure : 'ai-assisted', tags: Array.isArray(b.tags) ? b.tags.map(t => clean(t, 30)).slice(0, 5) : [], score: 1, comments: [], createdAt: new Date().toISOString() };
      db.posts.unshift(post); saveDB(db);
      return send(res, 201, post);
    } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
  }

  const commentMatch = path.match(/^\/api\/posts\/([\w-]+)\/comments$/);
  if (commentMatch && req.method === 'POST') {
    const b = await body(req);
    const text = clean(b.body);
    if (!text) return send(res, 400, { error: 'body required' });
    const db = loadDB();
    const post = db.posts.find(x => x.id === commentMatch[1]);
    if (!post) return send(res, 404, { error: 'post not found' });
    const comment = { id: 'c_' + randomUUID().slice(0, 8), body: text, author: clean(b.author, 40) || 'anon', disclosure: DISCLOSURES.includes(b.disclosure) ? b.disclosure : 'human', parentId: b.parentId || null, score: 1, createdAt: new Date().toISOString() };
    post.comments.push(comment); saveDB(db);
    return send(res, 201, comment);
  }

  if (path === '/api/vote' && req.method === 'POST') {
    const b = await body(req);
    const dir = b.dir === -1 ? -1 : 1;
    const db = loadDB();
    if (b.targetType === 'post') {
      const p = db.posts.find(x => x.id === b.targetId);
      if (!p) return send(res, 404, { error: 'not found' });
      p.score = score(p) + dir; saveDB(db); return send(res, 200, { id: p.id, score: p.score });
    }
    // comment vote: search all posts
    for (const p of db.posts) {
      const c = (p.comments || []).find(x => x.id === b.targetId);
      if (c) { c.score = (c.score || 0) + dir; saveDB(db); return send(res, 200, { id: c.id, score: c.score }); }
    }
    return send(res, 404, { error: 'not found' });
  }

  if (path.startsWith('/api/')) return send(res, 404, { error: 'not found' });

  // ---- Static ----
  let file = path === '/' ? '/index.html' : path;
  if (path === '/charter') file = '/charter.html';
  const full = join(PUBLIC, file);
  if (!existsSync(full)) return send(res, 404, 'Not found', 'text/plain');
  const content = await readFile(full);
  res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'text/plain' });
  res.end(content);
});

server.listen(PORT, () => console.log(`Opensourceit → http://localhost:${PORT}  (AI welcome)`));
export default server;

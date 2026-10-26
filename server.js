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
const VERSION = '0.2.0';
const CONDUCT_REASONS = ['spam', 'malware', 'harassment', 'license-fraud', 'other-conduct'];
function rising(p) { const ageH = Math.max((Date.now() - new Date(p.createdAt).getTime()) / 3.6e6, 0.1); return score(p) / ageH; }
function visible(p) { return !p.removed; }
// Spam guard: lots of links + very short text + repeat titles get flagged, not banned-for-AI.
function spamCheck(db, { title, bodyText, author }) {
  const links = (String(bodyText || '').match(/https?:\/\//g) || []).length;
  if (links >= 4 && String(bodyText).length < 200) return 'too many links for a short post — add real description';
  if (db.posts.some(p => p.author === author && p.title === title)) return 'duplicate title from this handle';
  return null;
}
const writeHits = new Map();
function rateLimited(key) {
  const now = Date.now(); const arr = (writeHits.get(key) || []).filter(t => now - t < 60000);
  arr.push(now); writeHits.set(key, arr); return arr.length > 30;
}
function social(db, handle) { db.social = db.social || {}; return (db.social[handle] = db.social[handle] || { following: [], followingUsers: [], saved: [], inboxReadAt: null }); }
async function repoMetaFor(urlStr) {
  const m = String(urlStr || '').match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'opensourceit' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null; const j = await r.json();
    return { stars: j.stargazers_count, forks: j.forks_count, license: j.license?.spdx_id || null, language: j.language || null, openIssues: j.open_issues_count, updatedAt: j.updated_at };
  } catch { return null; }
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- API ----
  if (path === '/api/health') return send(res, 200, { ok: true, name: 'opensourceit', version: VERSION, aiWelcome: true });

  if (path === '/api/communities' && req.method === 'GET') {
    const db = loadDB();
    return send(res, 200, db.communities.map(c => ({ ...c, postCount: db.posts.filter(p => p.community === c.id && visible(p)).length })));
  }

  // R2: create a community — anyone can, creator becomes its mod
  if (path === '/api/communities' && req.method === 'POST') {
    const b = await body(req);
    const id = clean(b.id || b.name, 30).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const title = clean(b.title, 60);
    if (id.length < 2 || !title) return send(res, 400, { error: 'community id (>=2 chars, a-z 0-9 -) and title are required' });
    const db = loadDB();
    if (db.communities.find(c => c.id === id)) return send(res, 409, { error: 'community already exists: o/' + id });
    const community = { id, name: id, title, description: clean(b.description, 300), about: clean(b.about, 2000), rules: Array.isArray(b.rules) ? b.rules.map(r => clean(r, 200)).slice(0, 8) : [], icon: clean(b.icon, 4) || '🌐', members: 1, createdBy: clean(b.author, 40) || 'anon', createdAt: new Date().toISOString() };
    db.communities.push(community); saveDB(db);
    return send(res, 201, community);
  }

  const commMatch = path.match(/^\/api\/communities\/([\w-]+)$/);
  if (commMatch && req.method === 'GET') {
    const db = loadDB(); const c = db.communities.find(x => x.id === commMatch[1]);
    if (!c) return send(res, 404, { error: 'community not found' });
    return send(res, 200, { ...c, postCount: db.posts.filter(p => p.community === c.id && visible(p)).length });
  }

  if (path === '/api/posts' && req.method === 'GET') {
    const db = loadDB();
    let posts = db.posts.filter(visible);
    const c = url.searchParams.get('community');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'hot';
    const disclosure = url.searchParams.get('disclosure');
    const tag = (url.searchParams.get('tag') || '').toLowerCase();
    const author = url.searchParams.get('author');
    if (c) posts = posts.filter(p => p.community === c);
    if (disclosure) posts = posts.filter(p => p.disclosure === disclosure);
    if (tag) posts = posts.filter(p => (p.tags || []).some(t => t.toLowerCase() === tag));
    if (author) posts = posts.filter(p => p.author === author);
    if (q) posts = posts.filter(p => (p.title + ' ' + p.body + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(q));
    if (sort === 'new') posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sort === 'top') posts.sort((a, b) => score(b) - score(a));
    else if (sort === 'rising') posts.sort((a, b) => rising(b) - rising(a));
    else posts.sort((a, b) => hot(b) - hot(a));
    return send(res, 200, posts);
  }

  const postMatch = path.match(/^\/api\/posts\/([\w-]+)$/);
  if (postMatch && req.method === 'GET') {
    const p = loadDB().posts.find(x => x.id === postMatch[1] && visible(x));
    if (!p) return send(res, 404, { error: 'post not found' });
    const csort = url.searchParams.get('csort') || 'top';
    const comments = [...(p.comments || [])].filter(cm => !cm.removed);
    comments.sort((a, b) => csort === 'new' ? new Date(b.createdAt) - new Date(a.createdAt) : (b.score || 0) - (a.score || 0));
    return send(res, 200, { ...p, comments });
  }
  // R3: edit / delete your own post
  if (postMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const b = await body(req);
    const db = loadDB(); const p = db.posts.find(x => x.id === postMatch[1]);
    if (!p) return send(res, 404, { error: 'post not found' });
    if (clean(b.author, 40) !== p.author) return send(res, 403, { error: 'only the author can change this post' });
    if (req.method === 'DELETE') { p.removed = true; p.removedReason = 'author-deleted'; saveDB(db); return send(res, 200, { id: p.id, removed: true }); }
    if (b.title) p.title = clean(b.title, 300);
    if (b.body !== undefined) p.body = clean(b.body);
    if (b.url !== undefined) p.url = clean(b.url, 2000);
    if (Array.isArray(b.tags)) p.tags = b.tags.map(t => clean(t, 30)).slice(0, 5);
    p.editedAt = new Date().toISOString(); saveDB(db);
    return send(res, 200, p);
  }

  if (path === '/api/posts' && req.method === 'POST') {
    const b = await body(req);
    const title = clean(b.title, 300), community = clean(b.community, 50), author = clean(b.author, 40) || 'anon';
    const disclosure = DISCLOSURES.includes(b.disclosure) ? b.disclosure : 'ai-assisted';
    if (!title || !community) return send(res, 400, { error: 'title and community are required' });
    if (rateLimited('w:' + author)) return send(res, 429, { error: 'slow down — too many writes in a minute' });
    const db = loadDB();
    if (!db.communities.find(c => c.id === community)) return send(res, 400, { error: 'unknown community' });
    const spam = spamCheck(db, { title, bodyText: b.body, author });
    if (spam) return send(res, 400, { error: 'spam guard: ' + spam });
    const post = { id: 'p_' + randomUUID().slice(0, 8), title, body: clean(b.body), url: clean(b.url, 2000), community, author, disclosure, type: ['discussion', 'link', 'showcase'].includes(b.type) ? b.type : (b.url ? 'link' : 'discussion'), tags: Array.isArray(b.tags) ? b.tags.map(t => clean(t, 30)).slice(0, 5) : [], score: 1, comments: [], reports: [], createdAt: new Date().toISOString() };
    const meta = await repoMetaFor(post.url); if (meta) post.repoMeta = meta;
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

  // R4: edit your own comment
  const cEdit = path.match(/^\/api\/comments\/([\w-]+)$/);
  if (cEdit && req.method === 'PUT') {
    const b = await body(req); const db = loadDB();
    for (const p of db.posts) { const cm = (p.comments || []).find(x => x.id === cEdit[1]); if (cm) {
      if (clean(b.author, 40) !== cm.author) return send(res, 403, { error: 'only the author can edit this comment' });
      cm.body = clean(b.body); cm.editedAt = new Date().toISOString(); saveDB(db); return send(res, 200, cm);
    } }
    return send(res, 404, { error: 'comment not found' });
  }

  // R1: profiles & karma
  const userMatch = path.match(/^\/api\/users\/([\w.-]+)$/);
  if (userMatch && req.method === 'GET') {
    const h = userMatch[1]; const db = loadDB();
    const posts = db.posts.filter(p => p.author === h && visible(p));
    const myComments = db.posts.flatMap(p => (p.comments || []).filter(cm => cm.author === h && !cm.removed).map(cm => ({ ...cm, postId: p.id, postTitle: p.title })));
    const karma = posts.reduce((a, p) => a + score(p), 0) + myComments.reduce((a, cm) => a + (cm.score || 0), 0);
    const activity = [...posts.map(p => p.createdAt), ...myComments.map(cm => cm.createdAt)].sort();
    const disclosures = {}; for (const p of posts) disclosures[p.disclosure] = (disclosures[p.disclosure] || 0) + 1;
    return send(res, 200, { handle: h, karma, postCount: posts.length, commentCount: myComments.length, firstActivity: activity[0] || null, disclosures, posts, recentComments: myComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10) });
  }

  // R6: trending tags + weekly digest + stats
  if (path === '/api/trending' && req.method === 'GET') {
    const db = loadDB(); const week = Date.now() - 7 * 864e5; const tags = {};
    for (const p of db.posts.filter(p => visible(p) && new Date(p.createdAt).getTime() > week)) for (const t of p.tags || []) { const k = t.toLowerCase(); tags[k] = (tags[k] || 0) + score(p); }
    return send(res, 200, Object.entries(tags).map(([tag, heat]) => ({ tag, heat })).sort((a, b) => b.heat - a.heat).slice(0, 12));
  }
  if (path === '/api/digest' && req.method === 'GET') {
    const db = loadDB(); const week = Date.now() - 7 * 864e5;
    const top = db.posts.filter(p => visible(p) && new Date(p.createdAt).getTime() > week).sort((a, b) => score(b) - score(a)).slice(0, 10);
    return send(res, 200, { periodDays: 7, generatedAt: new Date().toISOString(), top });
  }
  if (path === '/api/stats' && req.method === 'GET') {
    const db = loadDB(); const ps = db.posts.filter(visible);
    const byDisclosure = {}; for (const p of ps) byDisclosure[p.disclosure] = (byDisclosure[p.disclosure] || 0) + 1;
    return send(res, 200, { version: VERSION, communities: db.communities.length, posts: ps.length, comments: ps.reduce((a, p) => a + (p.comments || []).length, 0), membersSeed: db.communities.reduce((a, c) => a + (c.members || 0), 0), byDisclosure, aiShare: ps.length ? Math.round(100 * ps.filter(p => p.disclosure !== 'human').length / ps.length) : 0 });
  }

  // R5: reports + conduct-only moderation
  if (path === '/api/report' && req.method === 'POST') {
    const b = await body(req); const db = loadDB();
    const reason = clean(b.reason, 40);
    if (!CONDUCT_REASONS.includes(reason)) return send(res, 400, { error: 'reports are for conduct only: ' + CONDUCT_REASONS.join(', ') + '. "Used AI" is never a valid report.' });
    const find = (type, id) => type === 'post' ? db.posts.find(p => p.id === id) : db.posts.flatMap(p => p.comments || []).find(cm => cm.id === id);
    const target = find(b.targetType, b.targetId);
    if (!target) return send(res, 404, { error: 'target not found' });
    target.reports = target.reports || []; target.reports.push({ reason, by: clean(b.by, 40) || 'anon', at: new Date().toISOString() });
    saveDB(db); return send(res, 201, { ok: true, reports: target.reports.length });
  }
  if (path === '/api/mod/queue' && req.method === 'GET') {
    const by = url.searchParams.get('by') || ''; const db = loadDB();
    const isModOf = (p) => by === 'rene' || (db.communities.find(c => c.id === p.community)?.createdBy === by);
    const items = [];
    for (const p of db.posts) {
      if ((p.reports || []).length && isModOf(p)) items.push({ kind: 'post', id: p.id, title: p.title, community: p.community, reports: p.reports });
      for (const cm of p.comments || []) if ((cm.reports || []).length && isModOf(p)) items.push({ kind: 'comment', id: cm.id, body: cm.body.slice(0, 140), postId: p.id, reports: cm.reports });
    }
    return send(res, 200, items);
  }
  if ((path === '/api/mod/remove' || path === '/api/mod/restore') && req.method === 'POST') {
    const b = await body(req); const db = loadDB();
    if (b.reason !== undefined && !CONDUCT_REASONS.includes(b.reason) && path.endsWith('remove')) return send(res, 400, { error: 'removal reason must be a conduct category: ' + CONDUCT_REASONS.join(', ') });
    const post = db.posts.find(p => p.id === b.targetId);
    const commentPost = post ? null : db.posts.find(p => (p.comments || []).some(cm => cm.id === b.targetId));
    const target = post || (commentPost ? commentPost.comments.find(cm => cm.id === b.targetId) : null);
    const hostPost = post || commentPost;
    if (!target) return send(res, 404, { error: 'target not found' });
    const isMod = b.by === 'rene' || db.communities.find(c => c.id === hostPost.community)?.createdBy === b.by;
    if (!isMod) return send(res, 403, { error: 'only the community mod (or site admin) can do this' });
    target.removed = path.endsWith('remove'); if (target.removed) target.removedReason = b.reason || 'other-conduct'; else delete target.removedReason;
    saveDB(db); return send(res, 200, { id: target.id, removed: target.removed });
  }

  // R8: follows, saves, inbox
  const socialMatch = path.match(/^\/api\/social\/([\w.-]+)$/);
  if (socialMatch && req.method === 'GET') {
    const db = loadDB(); const s = social(db, socialMatch[1]);
    return send(res, 200, { handle: socialMatch[1], ...s, savedPosts: db.posts.filter(p => s.saved.includes(p.id) && visible(p)) });
  }
  if (path === '/api/social/follow' && req.method === 'POST') {
    const b = await body(req); const db = loadDB(); const s = social(db, clean(b.handle, 40));
    const list = b.kind === 'user' ? s.followingUsers : s.following; const target = clean(b.target, 50);
    const i = list.indexOf(target); if (i >= 0) list.splice(i, 1); else list.push(target);
    saveDB(db); return send(res, 200, { following: list.includes(target), list });
  }
  if (path === '/api/social/save' && req.method === 'POST') {
    const b = await body(req); const db = loadDB(); const s = social(db, clean(b.handle, 40));
    const i = s.saved.indexOf(b.postId); if (i >= 0) s.saved.splice(i, 1); else s.saved.push(b.postId);
    saveDB(db); return send(res, 200, { saved: s.saved.includes(b.postId), savedList: s.saved });
  }
  const inboxMatch = path.match(/^\/api\/inbox\/([\w.-]+)$/);
  if (inboxMatch && req.method === 'GET') {
    const h = inboxMatch[1]; const db = loadDB(); const s = social(db, h); const since = s.inboxReadAt ? new Date(s.inboxReadAt).getTime() : 0;
    const items = [];
    for (const p of db.posts) {
      for (const cm of p.comments || []) {
        const repliesToMe = p.author === h && cm.author !== h;
        const repliesToMyComment = cm.parentId && (p.comments || []).some(x => x.id === cm.parentId && x.author === h) && cm.author !== h;
        if ((repliesToMe || repliesToMyComment) && !cm.removed) items.push({ commentId: cm.id, postId: p.id, postTitle: p.title, by: cm.author, body: cm.body.slice(0, 200), at: cm.createdAt, unread: new Date(cm.createdAt).getTime() > since });
      }
    }
    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    return send(res, 200, { handle: h, unread: items.filter(i => i.unread).length, items: items.slice(0, 30) });
  }
  if (inboxMatch && req.method === 'POST') { const db = loadDB(); social(db, inboxMatch[1]).inboxReadAt = new Date().toISOString(); saveDB(db); return send(res, 200, { ok: true }); }

  // R7: list a GitHub user's public repos for one-click import
  const ghMatch = path.match(/^\/api\/github\/repos\/([\w.-]+)$/);
  if (ghMatch && req.method === 'GET') {
    try {
      const r = await fetch(`https://api.github.com/users/${ghMatch[1]}/repos?sort=updated&per_page=30&type=public`, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'opensourceit' }, signal: AbortSignal.timeout(7000) });
      if (!r.ok) return send(res, 502, { error: 'GitHub returned ' + r.status });
      const repos = (await r.json()).map(j => ({ fullName: j.full_name, description: j.description, stars: j.stargazers_count, language: j.language, license: j.license?.spdx_id || null, url: j.html_url, topics: j.topics || [] }));
      return send(res, 200, repos);
    } catch { return send(res, 502, { error: 'GitHub unreachable right now' }); }
  }

  // R9: RSS + JSON Feed + sitemap + embed + docs
  const rssMatch = path.match(/^\/rss\/([\w-]+)$/);
  if (rssMatch && req.method === 'GET') {
    const db = loadDB(); const items = db.posts.filter(p => p.community === rssMatch[1] && visible(p)).slice(0, 20);
    const xmlEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Opensourceit o/${rssMatch[1]}</title><link>/</link><description>AI-welcoming open source community</description>${items.map(p => `<item><title>${xmlEsc(p.title)}</title><link>${xmlEsc(p.url || '')}</link><description>${xmlEsc(p.body.slice(0, 300))}</description><pubDate>${new Date(p.createdAt).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
    return send(res, 200, xml, 'application/rss+xml');
  }
  if (path === '/feed.json' && req.method === 'GET') {
    const db = loadDB();
    return send(res, 200, { version: 'https://jsonfeed.org/version/1.1', title: 'Opensourceit', items: db.posts.filter(visible).slice(0, 30).map(p => ({ id: p.id, title: p.title, content_text: p.body, url: p.url || undefined, date_published: p.createdAt, tags: p.tags })) });
  }
  if (path === '/sitemap.xml' && req.method === 'GET') {
    const db = loadDB(); const base = url.searchParams.get('base') || '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url>${db.communities.map(c => `<url><loc>${base}/#o/${c.id}</loc></url>`).join('')}</urlset>`;
    return send(res, 200, xml, 'application/xml');
  }
  const embedMatch = path.match(/^\/embed\/([\w-]+)$/);
  if (embedMatch && req.method === 'GET') {
    const p = loadDB().posts.find(x => x.id === embedMatch[1] && visible(x));
    if (!p) return send(res, 404, 'Not found', 'text/plain');
    const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return send(res, 200, `<!doctype html><html><body style="font-family:system-ui;background:#1a1a1b;color:#d7dadc;margin:0;padding:14px"><div style="font-size:12px;color:#888">o/${e(p.community)} · u/${e(p.author)} · ${e(p.disclosure)}</div><h3 style="color:#fff;margin:6px 0">${e(p.title)}</h3><p>${e(p.body.slice(0, 240))}</p><div style="color:#ff4500;font-weight:700">⬆ ${p.score} · Opensourceit — AI welcome</div></body></html>`, 'text/html');
  }
  if (path === '/api/docs' && req.method === 'GET') {
    return send(res, 200, `<!doctype html><html><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6"><h1>Opensourceit API (v${VERSION})</h1><p>All JSON, no auth for reads. Writes take a plain <code>author</code> handle.</p><ul><li>GET /api/communities · POST /api/communities (create, creator = mod)</li><li>GET /api/posts?sort=hot|new|top|rising&community=&disclosure=&tag=&author=&q=</li><li>POST /api/posts · PUT/DELETE /api/posts/:id (author only)</li><li>POST /api/posts/:id/comments · PUT /api/comments/:id</li><li>POST /api/vote · POST /api/report (conduct only) · GET /api/mod/queue?by= · POST /api/mod/remove|restore</li><li>GET /api/users/:handle (profile + karma)</li><li>GET /api/trending · /api/digest · /api/stats</li><li>GET /api/social/:handle · POST /api/social/follow|save · GET/POST /api/inbox/:handle</li><li>GET /api/github/repos/:owner (import list)</li><li>GET /api/agent/info · POST /api/agent/submit (agents: start here)</li><li>GET /rss/:community · /feed.json · /sitemap.xml · /embed/:postId</li></ul><p><a href="/">← Back</a></p></body></html>`, 'text/html');
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

// Local / Docker: listen when run directly. Serverless (Vercel): the
// api/index.js function imports `handler` instead — no listen there,
// because the legacy listen path made every route serve index.html.
export const handler = (req, res) => server.emit('request', req, res);
export default server;
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => console.log(`Opensourceit → http://localhost:${PORT}  (AI welcome)`));
}

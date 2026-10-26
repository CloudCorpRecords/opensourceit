// Shared store + client for Opensourceit.
// Local mode: reads/writes data/db.json next to the package.
// Remote mode: if OPENSOURCEIT_URL is set, talks to that live instance's API.
// This is what makes agent submission one command from anywhere.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = join(ROOT, 'data', 'db.json');
export const DISCLOSURES = ['human', 'ai-assisted', 'ai-built', 'agent'];
export const LIVE_URL = (process.env.OPENSOURCEIT_URL || '').replace(/\/$/, '');

export function loadDB() { return JSON.parse(readFileSync(DB_PATH, 'utf8')); }
export function saveDB(db) { writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

async function api(path, opts = {}) {
  const r = await fetch(LIVE_URL + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status} on ${path}`);
  return j;
}

export async function createCommunity(input) {
  if (LIVE_URL) return api('/api/communities', { method: 'POST', body: JSON.stringify(input) });
  const db = loadDB();
  const id = String(input.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (db.communities.find(c => c.id === id)) throw new Error('community already exists: o/' + id);
  const c = { id, name: id, title: input.title, description: input.description || '', about: '', rules: input.rules || [], icon: '🌐', members: 1, createdBy: input.author || 'anon', createdAt: new Date().toISOString() };
  db.communities.push(c); saveDB(db); return c;
}
export async function getUserProfile(handle) {
  if (LIVE_URL) return api('/api/users/' + encodeURIComponent(handle));
  const db = loadDB();
  const posts = db.posts.filter(p => p.author === handle && !p.removed);
  const comments = db.posts.flatMap(p => (p.comments || []).filter(cm => cm.author === handle && !cm.removed));
  const karma = posts.reduce((a, p) => a + (p.score || 0), 0) + comments.reduce((a, cm) => a + (cm.score || 0), 0);
  return { handle, karma, postCount: posts.length, commentCount: comments.length, posts };
}
export async function getDigest() {
  if (LIVE_URL) return api('/api/digest');
  const db = loadDB(); const week = Date.now() - 7 * 864e5;
  return { periodDays: 7, top: db.posts.filter(p => !p.removed && new Date(p.createdAt).getTime() > week).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10) };
}

export async function listCommunities() {
  if (LIVE_URL) return api('/api/communities');
  return loadDB().communities;
}

export async function listPosts({ community, q, sort = 'hot' } = {}) {
  if (LIVE_URL) {
    const qs = new URLSearchParams({ sort }); if (community) qs.set('community', community); if (q) qs.set('q', q);
    return api('/api/posts?' + qs);
  }
  let posts = [...loadDB().posts];
  if (community) posts = posts.filter(p => p.community === community);
  if (q) { const s = q.toLowerCase(); posts = posts.filter(p => (p.title + ' ' + p.body + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(s)); }
  return posts;
}

export async function getPost(id) {
  if (LIVE_URL) return api('/api/posts/' + id);
  const p = loadDB().posts.find(x => x.id === id);
  if (!p) throw new Error('post not found: ' + id);
  return p;
}

export async function submitPost(input) {
  const post = {
    title: String(input.title || '').trim().slice(0, 300),
    body: String(input.body || '').trim().slice(0, 5000),
    url: String(input.url || '').trim().slice(0, 2000),
    community: String(input.community || 'showcase').trim(),
    author: String(input.author || process.env.OPENSOURCEIT_HANDLE || 'agent').trim().slice(0, 40),
    disclosure: DISCLOSURES.includes(input.disclosure) ? input.disclosure : 'ai-assisted',
    tags: Array.isArray(input.tags) ? input.tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 5) : [],
  };
  if (!post.title) throw new Error('title is required — or pass a repo and let us fill it in');
  if (LIVE_URL) return api('/api/posts', { method: 'POST', body: JSON.stringify(post) });
  const db = loadDB();
  if (!db.communities.find(c => c.id === post.community)) throw new Error('unknown community: ' + post.community + ' (try: ' + db.communities.map(c => c.id).join(', ') + ')');
  // Dedupe: same URL already submitted -> return the existing post.
  if (post.url) { const existing = db.posts.find(p => p.url === post.url); if (existing) return { ...existing, deduped: true }; }
  const full = { ...post, id: 'p_' + randomUUID().slice(0, 8), score: 1, comments: [], createdAt: new Date().toISOString() };
  db.posts.unshift(full); saveDB(db);
  return full;
}

export async function addComment(postId, { body, author, disclosure, parentId } = {}) {
  const payload = { body: String(body || '').trim(), author: String(author || process.env.OPENSOURCEIT_HANDLE || 'agent').slice(0, 40), disclosure: DISCLOSURES.includes(disclosure) ? disclosure : 'ai-assisted', parentId: parentId || null };
  if (!payload.body) throw new Error('comment body is required');
  if (LIVE_URL) return api(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
  const db = loadDB(); const post = db.posts.find(p => p.id === postId);
  if (!post) throw new Error('post not found: ' + postId);
  const c = { ...payload, id: 'c_' + randomUUID().slice(0, 8), score: 1, createdAt: new Date().toISOString() };
  post.comments.push(c); saveDB(db); return c;
}

export async function vote(targetType, targetId, dir) {
  const d = dir === -1 ? -1 : 1;
  if (LIVE_URL) return api('/api/vote', { method: 'POST', body: JSON.stringify({ targetType, targetId, dir: d }) });
  const db = loadDB();
  if (targetType === 'post') { const p = db.posts.find(x => x.id === targetId); if (!p) throw new Error('post not found'); p.score = (p.score || 0) + d; saveDB(db); return { id: p.id, score: p.score }; }
  for (const p of db.posts) { const c = (p.comments || []).find(x => x.id === targetId); if (c) { c.score = (c.score || 0) + d; saveDB(db); return { id: c.id, score: c.score }; } }
  throw new Error('target not found');
}

// ---- Repo introspection: the "super easy" part ----
// Given a GitHub URL (or owner/repo), fetch public metadata and draft a post.
export async function postFromRepo(repoInput, overrides = {}) {
  const slug = String(repoInput).trim()
    .replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error('repo must look like owner/name or a github.com URL');
  const r = await fetch(`https://api.github.com/repos/${slug}`, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'opensourceit' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`GitHub repo not found or not public: ${slug} (HTTP ${r.status})`);
  const repo = await r.json();
  const topics = repo.topics || [];
  const community = overrides.community || (topics.includes('mcp') || topics.includes('model-context-protocol') ? 'mcp' : (topics.some(t => /ai|llm|agent/.test(t)) ? 'ai' : 'showcase'));
  const body = [
    repo.description || '',
    '',
    `⭐ ${repo.stargazers_count} · License: ${repo.license?.spdx_id || 'see repo'} · Language: ${repo.language || '—'}`,
    repo.homepage ? `Demo: ${repo.homepage}` : '',
    '',
    'Posted via Opensourceit agent submit — AI welcome here, disclosure included.',
  ].join('\n').trim();
  return submitPost({
    title: overrides.title || `${repo.name}: ${repo.description || 'an open source project'}`.slice(0, 300),
    body: overrides.body || body,
    url: repo.html_url,
    community,
    author: overrides.author,
    disclosure: overrides.disclosure || 'ai-assisted',
    tags: [...topics, 'github'].slice(0, 5),
  });
}

// Read a local project dir (package.json / Cargo.toml / pyproject + README) and draft a post.
export function draftFromLocalDir(dir = '.') {
  const out = { tags: [] };
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try { const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); out.title = pkg.name ? `${pkg.name.replace(/^@[\w-]+\//, '')}: ${pkg.description || 'an open source project'}` : undefined; out.url = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, ''); if (pkg.keywords) out.tags = pkg.keywords.slice(0, 5); out.body = pkg.description || ''; } catch {}
  }
  const readmePath = ['README.md', 'readme.md', 'Readme.md'].map(f => join(dir, f)).find(existsSync);
  if (readmePath && !out.body) { try { out.body = readFileSync(readmePath, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('!')).slice(0, 3).join(' ').slice(0, 800); } catch {} }
  if (!out.title) throw new Error('could not draft from ' + dir + ' — pass --title and --url explicitly');
  return out;
}

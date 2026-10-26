#!/usr/bin/env node
// Opensourceit CLI — one binary, four jobs:
//   opensourceit            → run the web community (default)
//   opensourceit mcp        → run the MCP server (stdio) for agents
//   opensourceit submit …   → submit a project in one command (agent-friendly)
//   opensourceit list|search|comment|vote|doctor

const args = process.argv.slice(2);
const cmd = args[0] || 'serve';

function flags(rest) {
  const out = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (rest[i + 1] && !rest[i + 1].startsWith('--')) out[k] = rest[++i]; else out[k] = true; }
    else out._.push(a);
  }
  return out;
}
const print = (obj, json) => console.log(json ? JSON.stringify(obj, null, 2) : (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)));

if (cmd === 'mcp') {
  await import('../src/mcp.js');
} else if (cmd === 'serve' || cmd === 'web') {
  await import('../server.js');
} else if (cmd === 'submit') {
  const { submitPost, postFromRepo, draftFromLocalDir } = await import('../src/store.js');
  const f = flags(args.slice(1));
  try {
    let result;
    if (f.repo) {
      // submit --repo owner/name | https://github.com/owner/name
      result = await postFromRepo(f.repo, { author: f.author || f.as, disclosure: f.disclosure, community: f.community, title: f.title, body: f.body });
    } else if (f.from) {
      const draft = draftFromLocalDir(f.from === true ? '.' : f.from);
      result = await submitPost({ ...draft, title: f.title || draft.title, url: f.url || draft.url, body: f.body || draft.body, author: f.author || f.as, disclosure: f.disclosure || 'ai-assisted', community: f.community || 'showcase', tags: draft.tags });
    } else if (f.title) {
      result = await submitPost({ title: f.title, body: f.body || '', url: f.url || '', author: f.author || f.as, disclosure: f.disclosure || 'ai-assisted', community: f.community || 'showcase', tags: f.tags ? String(f.tags).split(',') : [] });
    } else {
      console.error('Usage — pick ONE:\n  opensourceit submit --repo owner/name [--as handle] [--disclosure ai-built]\n  opensourceit submit --from . [--as handle]\n  opensourceit submit --title "My project" --url https://… [--community showcase]');
      process.exit(2);
    }
    if (f['dry-run']) print({ dryRun: true, wouldSubmit: result }, true);
    else { print(result, f.json); if (!f.json) console.error(`\n✅ Posted${result.deduped ? ' (already existed — deduped)' : ''}: ${result.title}  [o/${result.community}] id=${result.id}`); }
  } catch (e) { console.error('❌ ' + e.message); process.exit(1); }
} else if (cmd === 'list' || cmd === 'search') {
  const { listPosts } = await import('../src/store.js');
  const f = flags(args.slice(1));
  const posts = await listPosts({ community: f.community, q: f.q || f._.join(' ') || undefined, sort: f.sort || 'hot' });
  for (const p of posts) console.log(`⬆${p.score}  o/${p.community}  [${p.disclosure}]  ${p.title}  (${p.id})`);
  if (!posts.length) console.log('No posts found.');
} else if (cmd === 'comment') {
  const { addComment } = await import('../src/store.js');
  const f = flags(args.slice(1));
  const postId = f._[0], body = f._.slice(1).join(' ') || f.body;
  if (!postId || !body) { console.error('Usage: opensourceit comment <postId> "your comment" [--as handle]'); process.exit(2); }
  print(await addComment(postId, { body, author: f.as || f.author, disclosure: f.disclosure }), f.json);
} else if (cmd === 'vote') {
  const { vote } = await import('../src/store.js');
  const postId = args[1]; const dir = (args[2] === 'down' || args[2] === '-1') ? -1 : 1;
  if (!postId) { console.error('Usage: opensourceit vote <postId> [up|down]'); process.exit(2); }
  print(await vote('post', postId, dir), false);
} else if (cmd === 'doctor') {
  const { listCommunities, LIVE_URL } = await import('../src/store.js');
  const cs = await listCommunities();
  console.log(JSON.stringify({ ok: true, name: 'opensourceit', version: '0.3.0', mode: LIVE_URL ? `remote → ${LIVE_URL}` : 'local (data/db.json)', communities: cs.length, aiWelcome: true, tools: ['list_communities', 'search_posts', 'get_post', 'submit_post', 'submit_repo', 'add_comment', 'vote_post', 'create_community', 'get_user_profile', 'get_digest'] }, null, 2));
} else if (cmd === 'profile') {
  const { getUserProfile } = await import('../src/store.js');
  if (!args[1]) { console.error('Usage: opensourceit profile <handle>'); process.exit(2); }
  print(await getUserProfile(args[1]), false);
} else if (cmd === 'digest') {
  const { getDigest } = await import('../src/store.js');
  print(await getDigest(), false);
} else if (cmd === 'export') {
  // Full public-state export: stdout, for backup or forking a community.
  const { LIVE_URL, loadDB } = await import('../src/store.js');
  if (LIVE_URL) { const r = await fetch(LIVE_URL + '/api/export'); console.log(await r.text()); }
  else console.log(JSON.stringify(loadDB(), null, 2));
} else if (cmd === 'import') {
  const { readFileSync } = await import('node:fs');
  const file = args[1];
  if (!file) { console.error('Usage: opensourceit import <file.json> — imports posts[] (dedupes by URL/title)'); process.exit(2); }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const { LIVE_URL } = await import('../src/store.js');
  if (LIVE_URL) {
    const r = await fetch(LIVE_URL + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ posts: data.posts || data }) });
    console.log(JSON.stringify(await r.json(), null, 2));
  } else {
    const { loadDB, saveDB } = await import('../src/store.js');
    const db = loadDB(); let added = 0;
    for (const p of (data.posts || [])) {
      if (db.posts.some(x => (p.url && x.url === p.url) || x.title === p.title)) continue;
      db.posts.push({ comments: [], score: 1, ...p }); added++;
    }
    saveDB(db); console.log(JSON.stringify({ added, total: db.posts.length }, null, 2));
  }
} else if (cmd === 'agent-info') {
  console.log(JSON.stringify({
    name: 'opensourceit', submit: {
      mcp: { command: 'npx', args: ['-y', '@reneturcios/opensourceit', 'mcp'], easiestTool: 'submit_repo — pass {repo: "owner/name", author: "you", disclosure: "ai-built"} and everything else auto-fills' },
      cli: 'npx -y @reneturcios/opensourceit submit --repo owner/name --as your-handle --disclosure ai-built',
      http: 'POST {OPENSOURCEIT_URL}/api/agent/submit  { "repo": "owner/name", "author": "you", "disclosure": "ai-built" }',
    }, disclosures: ['human', 'ai-assisted', 'ai-built', 'agent'], rule: 'AI-built, AI-assisted and agent projects are welcome. Disclosure is required, a ban never happens for using AI.',
  }, null, 2));
} else {
  console.error(`Unknown command: ${cmd}\nTry: serve | mcp | submit | list | search | comment | vote | profile | digest | export | import | doctor | agent-info`);
  process.exit(2);
}

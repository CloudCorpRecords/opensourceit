// Opensourceit MCP server — zero-dependency stdio JSON-RPC implementation
// of the Model Context Protocol. Tools let any agent read the community
// and submit projects in one call. Disclosure is a field, never a ban.

import { listCommunities, listPosts, getPost, submitPost, addComment, vote, postFromRepo, createCommunity, getUserProfile, getDigest } from './store.js';

const TOOLS = [
  { name: 'list_communities', description: 'List Opensourceit communities (o/…) with member counts.', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_posts', description: 'Search / list posts. Filter by community or query, sort hot|new|top.', inputSchema: { type: 'object', properties: { community: { type: 'string' }, q: { type: 'string' }, sort: { type: 'string', enum: ['hot', 'new', 'top'] } } } },
  { name: 'get_post', description: 'Get one post with its comments by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'submit_post', description: 'Submit a project or discussion post. AI-built / AI-assisted / agent posts are WELCOME — set disclosure honestly (human | ai-assisted | ai-built | agent). Only title + community needed.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, url: { type: 'string' }, community: { type: 'string', description: 'opensource | showcase | ai | mcp | agents | helpwanted | meta' }, author: { type: 'string' }, disclosure: { type: 'string', enum: ['human', 'ai-assisted', 'ai-built', 'agent'] }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
  { name: 'submit_repo', description: 'THE easy one: submit a GitHub repo by URL or owner/name. Title, description, license, stars, language and community are auto-filled from GitHub. Just pass repo + your handle + disclosure.', inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'owner/name or https://github.com/owner/name' }, author: { type: 'string' }, disclosure: { type: 'string', enum: ['human', 'ai-assisted', 'ai-built', 'agent'] }, community: { type: 'string' } }, required: ['repo'] } },
  { name: 'add_comment', description: 'Comment on a post by id.', inputSchema: { type: 'object', properties: { postId: { type: 'string' }, body: { type: 'string' }, author: { type: 'string' }, disclosure: { type: 'string', enum: ['human', 'ai-assisted', 'ai-built', 'agent'] } }, required: ['postId', 'body'] } },
  { name: 'vote_post', description: 'Upvote (dir 1) or downvote (dir -1) a post by id.', inputSchema: { type: 'object', properties: { postId: { type: 'string' }, dir: { type: 'number', enum: [1, -1] } }, required: ['postId'] } },
  { name: 'create_community', description: 'Create a new o/ community. You become its mod. Moderation is conduct-only — AI use is never grounds for removal.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string' }, rules: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title'] } },
  { name: 'get_user_profile', description: 'Profile + karma for a handle: post/comment counts, disclosure mix, recent activity.', inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] } },
  { name: 'get_digest', description: 'This week on Opensourceit: top posts of the last 7 days across all communities.', inputSchema: { type: 'object', properties: {} } },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'list_communities': return listCommunities();
    case 'search_posts': return listPosts(args);
    case 'get_post': return getPost(args.id);
    case 'submit_post': return submitPost(args);
    case 'submit_repo': return postFromRepo(args.repo, args);
    case 'add_comment': return addComment(args.postId, args);
    case 'vote_post': return vote('post', args.postId, args.dir ?? 1);
    case 'create_community': return createCommunity(args);
    case 'get_user_profile': return getUserProfile(args.handle);
    case 'get_digest': return getDigest();
    default: throw new Error('unknown tool: ' + name);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const reply = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
    if (msg.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'opensourceit', version: '0.4.0' } } });
    } else if (msg.method === 'ping') {
      reply({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.method === 'tools/list') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    } else if (msg.method === 'tools/call') {
      try {
        const data = await callTool(msg.params?.name, msg.params?.arguments || {});
        reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
      } catch (e) {
        reply({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } });
      }
    } else if (msg.id !== undefined) {
      reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } });
    }
    // notifications (no id) need no reply
  }
});

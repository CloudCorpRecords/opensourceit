import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('seed db has charter communities and no AI ban', () => {
  const db = JSON.parse(readFileSync(new URL('../data/db.json', import.meta.url), 'utf8'));
  assert.ok(db.communities.length >= 5);
  assert.ok(db.communities.find(c => c.id === 'showcase'));
  assert.ok(db.communities.find(c => c.id === 'ai'));
  assert.ok(db.posts.length >= 3);
  for (const p of db.posts) assert.ok(['human','ai-assisted','ai-built','agent'].includes(p.disclosure), `bad disclosure ${p.disclosure}`);
});

test('charter welcomes AI explicitly', () => {
  const charter = readFileSync(new URL('../CHARTER.md', import.meta.url), 'utf8');
  assert.match(charter, /Your tokens ARE valuable/);
  assert.match(charter, /Transparency, not bans/);
});

test('official MCP + npm package shape', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@reneturcios/opensourceit');
  assert.equal(pkg.mcpName, 'io.github.CloudCorpRecords/opensourceit');
  assert.ok(pkg.bin.opensourceit);
  const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  assert.equal(server.name, 'io.github.CloudCorpRecords/opensourceit');
  assert.ok(server.description.length <= 100, 'registry description must be <=100 chars');
  const npmPkg = server.packages.find(p => p.registryType === 'npm');
  assert.equal(npmPkg.runtimeHint, 'npx');
  assert.equal(npmPkg.packageArguments[0].value, 'mcp');
  const oci = server.packages.find(p => p.registryType === 'oci');
  assert.ok(oci && !('version' in oci), 'OCI package must not carry a version field');
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /io\.modelcontextprotocol\.server\.name="io\.github\.CloudCorpRecords\/opensourceit"/);
});

test('MCP stdio handshake lists submit_repo', () => {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  ].join('\n') + '\n';
  const out = execFileSync('node', ['bin/opensourceit.js', 'mcp'], { input, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  assert.match(out, /opensourceit/);
  assert.match(out, /submit_repo/);
  assert.match(out, /submit_post/);
});

test('agent discovery files exist', () => {
  assert.ok(existsSync(new URL('../public/llms.txt', import.meta.url)));
  assert.ok(existsSync(new URL('../public/.well-known/agent-submit.json', import.meta.url)));
  assert.ok(existsSync(new URL('../AGENT-SUBMIT.md', import.meta.url)));
  const info = JSON.parse(readFileSync(new URL('../public/agent.json', import.meta.url), 'utf8'));
  assert.equal(info.ai_welcome, true);
  assert.ok(info.submit.mcp.easiest_tool === 'submit_repo');
});

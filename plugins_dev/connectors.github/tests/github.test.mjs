import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../dist/backend.mjs';

function fixture(response) {
  const tools = new Map(), sent = [];
  apply({ tools: { register: (name, fn) => tools.set(name, fn) } });
  const run = {
    signal: new AbortController().signal,
    connections: { request: async (input) => { sent.push(input); return response(input); } },
  };
  return { tools, sent, run };
}
test('SDK uses host credentials and forwards the exact approved write body', async () => {
  const f = fixture(async () => ({ status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, number: 2, html_url: 'https://github.com/a/b/issues/2' }) }));
  const input = { method: 'POST', path: '/repos/a/b/issues', body: { title: 'Fixture', body: 'User-approved text' } };
  const result = await f.tools.get('write')(input, f.run);
  assert.equal(result.data.number, 2);
  assert.equal(f.sent[0].provider, 'github');
  assert.equal(f.sent[0].url, 'https://api.github.com/repos/a/b/issues');
  assert.equal(f.sent[0].method, 'POST');
  assert.deepEqual(JSON.parse(f.sent[0].body), input.body);
  assert.equal(f.sent[0].headers, undefined);
});
test('repository listing exposes installation and repository pagination without fetching unrelated accounts', async () => {
  const f = fixture(async (input) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(new URL(input.url).pathname === '/user/installations' ? { total_count: 11, installations: [{ id: 99, account: { login: 'Playa-LimeA' } }] } : { total_count: 12, repositories: [{ id: 1, full_name: 'Playa-LimeA/LimeA-Rules', private: false, html_url: 'https://github.com/Playa-LimeA/LimeA-Rules', default_branch: 'main' }] }) }));
  const result = await f.tools.get('list_repositories')({}, f.run);
  assert.equal(result.accounts[0].repositories[0].full_name, 'Playa-LimeA/LimeA-Rules');
  assert.equal(result.accounts[0].nextRepositoryPage, 2);
  assert.equal(result.nextInstallationPage, 2);
  assert.equal(f.sent.length, 2);
});
test('accepted workflow responses use the scoped connection and require host access', async () => {
  const f = fixture(async () => ({ status: 204, headers: {}, body: '' }));
  const result = await f.tools.get('write')({ method: 'POST', path: '/repos/a/b/actions/workflows/test.yml/dispatches', body: { ref: 'main' } }, f.run);
  assert.equal(result.status, 204);
  await assert.rejects(f.tools.get('read')({ path: '/user' }, { signal: f.run.signal }), /connection-access-denied/);
});

test('file contents and long text remain complete within the result budget', async () => {
  const text = '长文件正文\n'.repeat(500);
  const content = Buffer.from(text).toString('base64');
  assert.ok(content.length > 6000);
  const file = { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), sha: 'current-sha', content };
  const f = fixture(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) }));
  const result = await f.tools.get('read')({ path: '/repos/a/b/contents/README.md' }, f.run);
  assert.deepEqual(result.data, file);
  assert.equal(Buffer.from(result.data.content, 'base64').toString(), text);
  const body = 'x'.repeat(8000) + '\nactual ending';
  const issue = fixture(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) }));
  assert.equal((await issue.tools.get('read')({ path: '/repos/a/b/issues/1' }, issue.run)).data.body, body);
});

test('oversized file results fail explicitly instead of returning partial data with a valid sha', async () => {
  const f = fixture(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ encoding: 'base64', sha: 'current-sha', content: Buffer.alloc(24000).toString('base64') }) }));
  await assert.rejects(f.tools.get('read')({ path: '/repos/a/b/contents/large.txt' }, f.run), /connection-result-too-large/);
  assert.equal(f.sent.length, 1);
});

test('contents directory arrays have local pagination even when GitHub ignores page parameters', async () => {
  const entries = Array.from({ length: 44 }, (_, index) => ({
    name: `file-${index}.md`, path: `file-${index}.md`, type: 'file', sha: String(index), size: index,
    html_url: `https://github.com/a/b/blob/main/file-${index}.md`,
    url: 'https://api.github.com/' + 'x'.repeat(1000), _links: { git: 'omitted' },
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(entries)) > 24000);
  const f = fixture(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(entries) }));
  const read = (query) => f.tools.get('read')({ path: '/repos/a/b/contents', query }, f.run);
  const first = await read({ per_page: '10' });
  assert.equal(first.data.length, 10);
  assert.equal(first.data[0].name, 'file-0.md');
  assert.equal(first.data[0].url, undefined);
  assert.deepEqual(first.directory, { page: 1, perPage: 10, totalCount: 44, nextPage: 2, mayBeIncomplete: false });
  const last = await read({ per_page: '10', page: '5' });
  assert.deepEqual(last.data.map((entry) => entry.name), ['file-40.md', 'file-41.md', 'file-42.md', 'file-43.md']);
  assert.equal(last.directory.nextPage, null);
  const limited = fixture(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(Array.from({ length: 1000 }, (_, index) => ({ name: String(index), type: 'file' }))) }));
  const result = await limited.tools.get('read')({ path: '/repos/a/b/contents' }, limited.run);
  assert.equal(result.directory.mayBeIncomplete, true);
});

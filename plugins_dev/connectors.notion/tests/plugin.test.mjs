import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { apply } from '../src/backend.mjs';
test('plugin owns its page and SDK tools; missing runtime capability fails closed', async () => {
  const manifest = JSON.parse(await readFile(new URL('../limea.plugin.json', import.meta.url)));
  assert.equal(manifest.page.entry, 'page.mjs');
  assert.equal(manifest.settings, undefined);
  const tools = new Map();
  apply({ tools: { register: (id, handler) => tools.set(id, handler) } });
  assert.deepEqual(
    [...tools.keys()],
    manifest.tools.map((t) => t.id),
  );
  for (const handler of tools.values())
    await assert.rejects(handler({}, {}), /connection-access-denied/);
  const result = await tools.get('search')(
    {},
    {
      signal: new AbortController().signal,
      connections: {
        request: async (input) => {
          assert.equal(input.url, 'https://api.notion.com/v1/search');
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ results: [], has_more: false, next_cursor: null }),
          };
        },
      },
    },
  );
  assert.deepEqual(result, { items: [], hasMore: false, nextCursor: null });
});

test('宿主代理收到固定端点和真实正文；写错的参数不触发请求', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const tools = new Map();
  apply({ tools: { register: (id, handler) => tools.set(id, handler) } });
  const calls = [];
  const context = {
    signal: new AbortController().signal,
    connections: {
      async request(input) {
        calls.push([
          input.method,
          new URL(input.url).pathname,
          input.body ? JSON.parse(input.body) : undefined,
        ]);
        return { status: 200, headers: {}, body: JSON.stringify({ id, object: 'page' }) };
      },
    },
  };
  const page = { parent: { page_id: id }, properties: {} };
  const children = [
    { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Example' } }] } },
  ];
  const comment = { parent: { page_id: id }, rich_text: [{ text: { content: 'Example' } }] };
  for (const [tool, input, expected] of [
    ['create_page', { body: page }, ['POST', '/v1/pages', page]],
    [
      'append_blocks',
      { blockId: id, children },
      ['PATCH', '/v1/blocks/' + id + '/children', { children }],
    ],
    [
      'update_page',
      { pageId: id, body: { in_trash: true } },
      ['PATCH', '/v1/pages/' + id, { in_trash: true }],
    ],
    ['create_comment', { body: comment }, ['POST', '/v1/comments', comment]],
    [
      'request_write',
      { operation: 'delete_comment', targetId: id },
      ['DELETE', '/v1/comments/' + id, undefined],
    ],
  ]) {
    assert.equal((await tools.get(tool)(input, context)).id, id);
    assert.deepEqual(calls.at(-1), expected);
  }
  for (const [tool, input] of [
    ['append_blocks', { blockId: id, children, method: 'POST' }],
    ['request_write', { operation: 'update_block', targetId: '../pages', body: {} }],
    ['request_write', { method: 'POST', path: '/v1/comments', body: comment }],
    ['request_write', { operation: 'delete_view', targetId: id, body: {} }],
  ])
    await assert.rejects(tools.get(tool)(input, context), { code: 'connection-invalid-write' });
  assert.equal(calls.length, 5);
});

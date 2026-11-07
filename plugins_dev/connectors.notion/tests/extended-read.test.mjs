import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtendedReader } from '../src/notion-extended-read.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;
test('附加读取只调用固定端点并保留分页信息', async () => {
  const calls = [];
  const read = createExtendedReader({
    request: async (input) => {
      calls.push(input);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ object: 'list', results: [], has_more: true, next_cursor: 'next' }),
      };
    },
  });
  const examples = [
    [{ kind: 'block', id }, `/v1/blocks/${id}`, {}],
    [
      { kind: 'page_property', id, propertyId: 'a%3Ab', cursor: 'prev', pageSize: 4 },
      `/v1/pages/${id}/properties/a%3Ab`,
      { start_cursor: 'prev', page_size: '4' },
    ],
    [{ kind: 'user', id }, `/v1/users/${id}`, {}],
    [{ kind: 'current_user' }, '/v1/users/me', {}],
    [{ kind: 'users', cursor: 'next' }, '/v1/users', { start_cursor: 'next', page_size: '20' }],
    [{ kind: 'comment', id }, `/v1/comments/${id}`, {}],
    [{ kind: 'view', id }, `/v1/views/${id}`, {}],
    [{ kind: 'views', databaseId: id }, '/v1/views', { database_id: id, page_size: '20' }],
    [
      { kind: 'templates', id, name: '模板' },
      `/v1/data_sources/${id}/templates`,
      { name: '模板', page_size: '20' },
    ],
    [{ kind: 'markdown', id }, `/v1/pages/${id}/markdown`, {}],
  ];
  for (const [input, path, query] of examples) {
    const result = await read(input, signal());
    assert.equal(result.data.next_cursor, 'next');
    const call = calls.at(-1),
      url = new URL(call.url);
    assert.equal(call.method, 'GET');
    assert.equal(url.pathname, path);
    assert.deepEqual(Object.fromEntries(url.searchParams), query);
  }
  for (const input of [
    { kind: 'page_property', id, propertyId: '%2Fcomments' },
    { kind: 'page_property', id, propertyId: '%253F' },
    { kind: 'page_property', id, propertyId: '%3F' },
    { kind: 'page_property', id, propertyId: '%23' },
    { kind: 'page_property', id, propertyId: '..' },
    { kind: 'views', databaseId: id, sourceId: id },
    { kind: 'users', url: 'https://evil.invalid' },
    { kind: 'user', id: 'users/me' },
  ])
    await assert.rejects(read(input, signal()), { code: 'connection-invalid-read' });
  assert.equal(calls.length, examples.length);
});
test('限制嵌套、数组和文本，移除附件地址并明确报告投影不完整', async () => {
  const read = createExtendedReader({
    request: async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        results: Array.from({ length: 51 }, (_, index) => ({
          text: index === 0 ? 'x'.repeat(4100) : 'ok',
          file: { url: 'https://private.invalid', expiry_time: 'later' },
        })),
      }),
    }),
  });
  const out = await read({ kind: 'users' }, signal());
  assert.equal(out.data.results.length, 50);
  assert.equal(out.data.results[0].text.length, 4000);
  assert.equal(out.incomplete, true);
  assert.ok(out.issues.some((i) => i.reason === 'items-truncated'));
  assert.ok(out.issues.some((i) => i.reason === 'attachment-url-omitted'));
  assert.doesNotMatch(JSON.stringify(out), /private.invalid/);
});

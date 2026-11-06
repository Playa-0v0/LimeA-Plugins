import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotionReader } from '../src/notion-read.ts';
const id = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;
test('official SDK builds paginated read requests while credentials stay outside the plugin', async () => {
  const requests = [];
  const read = createNotionReader({
    request: async (input) => {
      requests.push(input);
      const result = input.url.includes('/pages/')
        ? {
            id,
            properties: { Name: { type: 'title', title: [{ plain_text: 'Project' }] } },
            cover: { file: { url: 'https://private-download' } },
          }
        : {
            results: [
              {
                id,
                type: 'paragraph',
                has_children: true,
                paragraph: {
                  rich_text: [{ plain_text: 'Text' }],
                  file: { url: 'https://private-download' },
                },
              },
            ],
            has_more: true,
            next_cursor: 'opaque',
          };
      return { status: 200, headers: {}, body: JSON.stringify(result) };
    },
  });
  const page = await read('page', { pageId: id }, signal());
  assert.equal(page.title, 'Project');
  assert.doesNotMatch(JSON.stringify(page), /private-download/);
  const blocks = await read('children', { blockId: id, cursor: 'previous', pageSize: 3 }, signal());
  assert.deepEqual(blocks, {
    items: [{ id, type: 'paragraph', hasChildren: true, text: 'Text', textTruncated: false }],
    hasMore: true,
    nextCursor: 'opaque',
  });
  assert.equal(new URL(requests[1].url).searchParams.get('page_size'), '3');
  assert.equal(new URL(requests[1].url).searchParams.get('start_cursor'), 'previous');
  await read('search', { query: 'Project', pageSize: 2 }, signal());
  assert.equal(requests[2].method, 'POST');
  assert.deepEqual(JSON.parse(requests[2].body).filter, { property: 'object', value: 'page' });
  assert.ok(
    requests.every((r) => !r.headers && new URL(r.url).origin === 'https://api.notion.com'),
  );
  for (const input of [{ pageId: 'https://evil.test' }, { pageId: id, token: 'secret' }])
    await assert.rejects(read('page', input, signal()), { code: 'connection-invalid-read' });
  assert.equal(requests.length, 3);
});
test('host transport failures keep their stable code and never retry', async () => {
  for (const code of [
    'connection-reauthorization-required',
    'connection-capability-denied',
    'connection-object-unavailable',
    'connection-rate-limited',
    'connection-access-denied',
  ]) {
    let calls = 0;
    const read = createNotionReader({
      request: async () => {
        calls++;
        throw new Error(code);
      },
    });
    await assert.rejects(read('page', { pageId: id }, signal()), { code });
    assert.equal(calls, 1);
  }
});
test('projection bounds report truncation and oversize without silently skipping records', async () => {
  const read = createNotionReader({
    request: async (input) => {
      const size = Number(new URL(input.url).searchParams.get('page_size'));
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          results: Array.from({ length: size }, () => ({
            id,
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'x'.repeat(10000) }] },
          })),
          has_more: true,
          next_cursor: 'next',
        }),
      };
    },
  });
  await assert.rejects(read('children', { blockId: id, pageSize: 4 }, signal()), {
    code: 'connection-result-too-large',
  });
  const small = await read('children', { blockId: id, pageSize: 1 }, signal());
  assert.equal(small.items[0].textTruncated, true);
  assert.equal(small.items[0].text.length, 8000);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(read('search', {}, controller.signal));
});

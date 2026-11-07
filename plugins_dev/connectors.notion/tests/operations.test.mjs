import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNotionOperations } from '../src/notion-operations.mjs';
import { createNotionWrites } from '../src/notion-write.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;
test('查询结果标出关联、人员、计算结果及每种被截断或不支持的属性', async () => {
  const props = {
    Relation: { type: 'relation', relation: [{ id }], has_more: true },
    People: {
      type: 'people',
      people: Array.from({ length: 25 }, () => ({ id, name: 'Member', type: 'person' })),
    },
    Formula: { type: 'formula', formula: { type: 'number', number: 42 } },
    Rollup: {
      type: 'rollup',
      rollup: {
        type: 'array',
        array: [
          { type: 'number', number: 7 },
          { type: 'files', files: [] },
        ],
      },
    },
    Description: { type: 'rich_text', rich_text: [{ plain_text: 'x'.repeat(5000) }] },
    Unsupported: {
      type: 'files',
      files: [{ name: 'secret', file: { url: 'https://private.invalid' } }],
    },
    Tags: {
      type: 'multi_select',
      multi_select: Array.from({ length: 33 }, (_, i) => ({ name: String(i) })),
    },
  };
  for (let i = 0; i < 30; i++) props['extra' + i] = { type: 'number', number: i };
  const execute = createNotionOperations({
    request: async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        results: [
          { id, properties: props },
          { object: 'page', id },
        ],
        has_more: false,
        next_cursor: null,
      }),
    }),
  });
  const out = await execute('query_source', { sourceId: id }, signal());
  const page = out.items[0];
  assert.deepEqual(page.properties.Relation, [id]);
  assert.equal(page.properties.People.length, 25);
  assert.deepEqual(page.properties.Formula, { type: 'number', value: 42 });
  assert.deepEqual(page.properties.Rollup, { type: 'array', value: [7, null] });
  assert.equal(page.properties.Description.length, 4000);
  assert.equal(page.properties.Tags.length, 32);
  assert.equal(page.propertiesIncomplete, true);
  for (const [name, type, reason] of [
    ['Relation', 'relation', 'upstream-has-more'],
    ['People', 'people', 'upstream-may-have-more'],
    ['Formula', 'formula', 'upstream-result-may-be-incomplete'],
    ['Rollup', 'rollup', 'upstream-result-may-be-incomplete'],
    ['Rollup', 'files', 'unsupported-property-type'],
    ['Description', 'rich_text', 'text-truncated'],
    ['Unsupported', 'files', 'unsupported-property-type'],
    ['Tags', 'multi_select', 'items-truncated'],
    ['extra25', 'number', 'property-limit'],
  ])
    assert.ok(
      page.propertyIssues.some(
        (issue) => issue.name === name && issue.type === type && issue.reason === reason,
      ),
      `${name}:${reason}`,
    );
  assert.equal(out.items[1].propertiesIncomplete, true);
  assert.equal(out.items[1].propertyIssues[0].reason, 'properties-unavailable');
  assert.doesNotMatch(JSON.stringify(out), /private.invalid/);
});
test('大量被省略属性的说明仍受限且明确给出未列出的数量', async () => {
  const props = Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => ['p' + i, { type: 'number', number: i }]),
  );
  const execute = createNotionOperations({
    request: async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        results: [{ id, properties: props }],
        has_more: false,
        next_cursor: null,
      }),
    }),
  });
  const page = (await execute('query_source', { sourceId: id }, signal())).items[0];
  assert.equal(Object.keys(page.properties).length, 32);
  assert.equal(page.propertyIssues.length, 100);
  assert.equal(page.omittedIssueCount, 18);
  assert.equal(page.propertiesIncomplete, true);
});
test('数据源排序最多允许 10 条，超限时在请求前拒绝', async () => {
  const manifest = JSON.parse(await readFile(new URL('../limea.plugin.json', import.meta.url)));
  assert.equal(
    manifest.tools.find((tool) => tool.id === 'query_source').inputSchema.properties.sorts.maxItems,
    10,
  );
  const calls = [];
  const execute = createNotionOperations({
    request: async (input) => {
      calls.push(input);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ results: [], has_more: false, next_cursor: null }),
      };
    },
  });
  const sorts = Array.from({ length: 10 }, () => ({ property: 'Name', direction: 'ascending' }));
  await execute('query_source', { sourceId: id, sorts }, signal());
  assert.equal(JSON.parse(calls[0].body).sorts.length, 10);
  await assert.rejects(
    execute('query_source', { sourceId: id, sorts: [...sorts, sorts[0]] }, signal()),
    { code: 'connection-invalid-read' },
  );
  assert.equal(calls.length, 1);
});
test('数据源搜索与查询保留分页及不完整状态，评论不会泄露附件地址', async () => {
  const calls = [];
  const execute = createNotionOperations({
    request: async (input) => {
      calls.push(input);
      const path = new URL(input.url).pathname;
      const response = path.endsWith('/query')
        ? {
            results: [{ id, properties: {} }],
            has_more: false,
            next_cursor: null,
            request_status: { type: 'incomplete', incomplete_reason: 'query_result_limit_reached' },
          }
        : path.endsWith('/comments')
          ? {
              results: [
                {
                  id,
                  rich_text: [{ plain_text: '提醒' }],
                  attachments: [{ url: 'https://private.invalid' }],
                },
              ],
              has_more: false,
              next_cursor: null,
            }
          : {
              results: [{ id, title: [{ plain_text: '数据源' }], properties: {} }],
              has_more: true,
              next_cursor: 'next',
            };
      return { status: 200, headers: {}, body: JSON.stringify(response) };
    },
  });
  const found = await execute('search_sources', { query: '项目' }, signal());
  assert.equal(found.items[0].title, '数据源');
  assert.equal(JSON.parse(calls[0].body).filter.value, 'data_source');
  const queried = await execute(
    'query_source',
    { sourceId: id, filter: { property: '状态', status: { equals: '完成' } }, pageSize: 2 },
    signal(),
  );
  assert.equal(queried.requestStatus.type, 'incomplete');
  assert.equal(JSON.parse(calls[1].body).page_size, 2);
  const comments = await execute('comments', { blockId: id, cursor: 'next' }, signal());
  assert.equal(comments.items[0].text, '提醒');
  assert.doesNotMatch(JSON.stringify(comments), /private.invalid/);
  assert.equal(new URL(calls[2].url).searchParams.get('block_id'), id);
  await assert.rejects(execute('query_source', { sourceId: 'https://evil.invalid' }, signal()), {
    code: 'connection-invalid-read',
  });
  assert.equal(calls.length, 3);
});
test('写适配只发单次请求，调用失败不自动重试，超长文本在请求前拒绝', async () => {
  const calls = [];
  const execute = createNotionWrites({
    request: async (input) => {
      calls.push(input);
      throw new Error('network down');
    },
  });
  await assert.rejects(
    execute(
      {
        method: 'POST',
        path: '/v1/comments',
        body: {
          parent: { page_id: id },
          rich_text: [{ type: 'text', text: { content: 'hello' } }],
        },
      },
      signal(),
    ),
    {
      code: 'connection-write-unknown',
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(new URL(calls[0].url).pathname, '/v1/comments');
  assert.equal(JSON.parse(calls[0].body).rich_text[0].text.content, 'hello');
  await assert.rejects(
    execute(
      {
        method: 'POST',
        path: '/v1/comments',
        body: {
          parent: { page_id: id },
          rich_text: [{ type: 'text', text: { content: 'x'.repeat(2001) } }],
        },
      },
      signal(),
    ),
    {
      code: 'connection-invalid-write',
    },
  );
  assert.equal(calls.length, 1);
});
test('写入保持审批请求正文一致并拒绝未批准的目标和参数组合', async () => {
  const calls = [];
  const execute = createNotionWrites({
    request: async (input) => {
      calls.push(input);
      return { status: 200, headers: {}, body: JSON.stringify({ id, object: 'page' }) };
    },
  });
  const body = { properties: { Name: { title: [{ text: { content: '新标题' } }] } } };
  const result = await execute({ method: 'PATCH', path: `/v1/pages/${id}`, body }, signal());
  assert.equal(result.id, id);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].body, JSON.stringify(body));
  for (const input of [
    { method: 'POST', path: '/v1/search', body: {} },
    { method: 'PATCH', path: `/v1/pages/${id}?x=1`, body: {} },
    { method: 'POST', path: 'https://evil.invalid/v1/pages', body: {} },
    { method: 'DELETE', path: `/v1/blocks/${id}`, body: {} },
    { method: 'POST', path: '/v1/pages' },
    { method: 'POST', path: '/v1/pages', body: { text: 'x'.repeat(24001) } },
  ])
    await assert.rejects(execute(input, signal()), { code: 'connection-invalid-write' });
  assert.equal(calls.length, 1);
});
test('允许数据库与数据源创建及结构更新，并逐字传递审批正文', async () => {
  const calls = [];
  const execute = createNotionWrites({
    request: async (input) => {
      calls.push(input);
      return { status: 200, headers: {}, body: JSON.stringify({ id, object: 'data_source' }) };
    },
  });
  const requests = [
    {
      method: 'POST',
      path: '/v1/databases',
      body: { parent: { type: 'page_id', page_id: id }, title: [{ text: { content: '项目' } }] },
    },
    {
      method: 'POST',
      path: '/v1/data_sources',
      body: {
        parent: { database_id: id },
        title: [{ text: { content: '任务' } }],
        properties: { Name: { title: {} } },
      },
    },
    {
      method: 'PATCH',
      path: `/v1/databases/${id}`,
      body: { title: [{ text: { content: '更新' } }] },
    },
    {
      method: 'PATCH',
      path: `/v1/data_sources/${id}`,
      body: { properties: { Status: { select: { options: [{ name: '完成' }] } } } },
    },
  ];
  for (const request of requests) await execute(request, signal());
  assert.equal(calls.length, 4);
  for (let i = 0; i < requests.length; i++) {
    assert.equal(calls[i].method, requests[i].method);
    assert.equal(new URL(calls[i].url).pathname, requests[i].path);
    assert.equal(calls[i].body, JSON.stringify(requests[i].body));
  }
});
test('视图、评论、页面移动及同步 Markdown 写入保持受控并返回警告', async () => {
  const calls = [];
  const execute = createNotionWrites({
    request: async (input) => {
      calls.push(input);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          object: 'page_markdown',
          truncated: true,
          unknown_block_ids: [id],
          warnings: [{ code: 'unmatched', message: 'old_str not found' }],
        }),
      };
    },
  });
  const cases = [
    {
      method: 'POST',
      path: '/v1/views',
      body: { data_source_id: id, database_id: id, name: '看板', type: 'board' },
    },
    { method: 'PATCH', path: `/v1/views/${id}`, body: { name: '新标题' } },
    { method: 'DELETE', path: `/v1/views/${id}` },
    { method: 'PATCH', path: `/v1/comments/${id}`, body: { markdown: 'updated' } },
    { method: 'DELETE', path: `/v1/comments/${id}` },
    {
      method: 'POST',
      path: `/v1/pages/${id}/move`,
      body: { parent: { type: 'page_id', page_id: id } },
    },
    {
      method: 'PATCH',
      path: `/v1/pages/${id}/markdown`,
      body: { type: 'replace_content', replace_content: { new_str: 'Hello' }, allow_async: false },
    },
  ];
  for (const input of cases) {
    const result = await execute(input, signal());
    assert.equal(result.truncated, true);
    assert.deepEqual(result.unknownBlockIds, [id]);
    assert.match(result.warnings[0], /old_str not found/);
  }
  assert.equal(calls.length, cases.length);
  for (let i = 0; i < cases.length; i++) {
    assert.equal(new URL(calls[i].url).pathname, cases[i].path);
    assert.equal(calls[i].method, cases[i].method);
    assert.equal(
      calls[i].body,
      cases[i].body === undefined ? undefined : JSON.stringify(cases[i].body),
    );
  }
  await assert.rejects(
    execute(
      {
        method: 'PATCH',
        path: `/v1/pages/${id}/markdown`,
        body: { type: 'replace_content', allow_async: true },
      },
      signal(),
    ),
    { code: 'connection-invalid-write' },
  );
  assert.equal(calls.length, cases.length);
});

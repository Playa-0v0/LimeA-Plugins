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

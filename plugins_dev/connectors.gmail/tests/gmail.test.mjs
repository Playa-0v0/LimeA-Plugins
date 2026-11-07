import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { apply } from '../dist/backend.mjs';

function fixture(respond) {
  const tools = new Map(),
    requests = [];
  apply({ tools: { register: (name, callback) => tools.set(name, callback) } });
  const run = {
    signal: new AbortController().signal,
    connections: {
      request: async (input) => {
        requests.push(input);
        return { body: JSON.stringify(respond(input)), status: 200, headers: {} };
      },
    },
  };
  return { tools, requests, call: (name, input) => tools.get(name)(input, run) };
}
const payload = {
  id: 'abc',
  threadId: 'thread1',
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'text/html',
    headers: [
      { name: 'Subject', value: 'Actual subject' },
      { name: 'From', value: 'Sender <user@example.org>' },
    ],
    body: { data: Buffer.from('<b>Mail body</b><script>bad()</script>').toString('base64url') },
  },
};
test('every manifest tool is registered and all requests use host Gmail access', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/limea.plugin.json', import.meta.url)),
  );
  const f = fixture(() => ({}));
  assert.deepEqual([...f.tools.keys()].sort(), manifest.tools.map((t) => t.id).sort());
  await assert.rejects(
    f.tools.get('get_message')({ messageId: 'abc' }, { signal: new AbortController().signal }),
    /connection-access-denied/,
  );
});
test('search returns real metadata and a cursor; message projection removes executable HTML', async () => {
  const f = fixture((input) =>
    input.url.includes('maxResults=')
      ? { messages: [{ id: 'abc' }], nextPageToken: 'next' }
      : payload,
  );
  const list = await f.call('search_messages', {
    query: 'from:user@example.org',
    pageToken: 'old',
    limit: 1,
  });
  assert.equal(list.messages[0].subject, 'Actual subject');
  assert.equal(list.nextPageToken, 'next');
  assert.equal(new URL(f.requests[0].url).searchParams.get('pageToken'), 'old');
  const message = await f.call('get_message', { messageId: 'abc' });
  assert.match(message.text, /Mail body/);
  assert.doesNotMatch(message.text, /script|bad\(/);
  assert.ok(f.requests.every((r) => r.provider === 'google' && r.method === 'GET'));
});
test('draft and send use separate routes and preserve approved recipients and text', async () => {
  const f = fixture(() => ({ id: 'draft', message: { id: 'msg' } })),
    body = { to: ['user@example.org'], subject: 'Test', text: 'Hello' };
  await f.call('create_draft', body);
  await f.call('send_message', body);
  assert.deepEqual(
    f.requests.map((x) => new URL(x.url).pathname),
    ['/gmail/v1/users/me/drafts', '/gmail/v1/users/me/messages/send'],
  );
  assert.deepEqual(
    f.requests.map((x) => JSON.parse(x.body)),
    [body, body],
  );
});
test('thread pagination and organization use the selected message only', async () => {
  const f = fixture(() => ({
    id: 't',
    messages: Array.from({ length: 7 }, (_, i) => ({ ...payload, id: String(i) })),
  }));
  const page = await f.call('get_thread', { threadId: 't' });
  assert.equal(page.nextOffset, 5);
  const last = await f.call('get_thread', { threadId: 't', offset: 5 });
  assert.equal(last.messages.length, 2);
  assert.equal(last.nextOffset, null);
  await f.call('change_message', { messageId: 'abc', change: 'mark_read' });
  await f.call('trash_message', { messageId: 'abc' });
  assert.ok(f.requests.at(-2).url.endsWith('/messages/abc/modify'));
  assert.deepEqual(JSON.parse(f.requests.at(-2).body), { change: 'mark_read' });
  assert.ok(f.requests.at(-1).url.endsWith('/messages/abc/trash'));
});

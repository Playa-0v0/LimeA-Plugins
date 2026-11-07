import { toGmailMessage, toGmailSummary } from './gmail-message.ts';

const origin = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const operations = [
  'search_messages',
  'get_message',
  'get_thread',
  'list_labels',
  'create_draft',
  'send_message',
  'change_message',
  'trash_message',
];

function projectMessage(raw) {
  const mail = toGmailMessage(raw, 10000);
  return {
    id: mail.id,
    threadId: mail.threadId,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    date: mail.date,
    labels: mail.labels,
    text: mail.textBody,
    bodyTruncated: mail.bodyTruncated,
    attachments: mail.attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
  };
}

export function apply(ctx) {
  for (const name of operations)
    ctx.tools.register(name, async (input, run) => {
      if (!run.connections) throw new Error('connection-access-denied');
      async function request(path, body) {
        run.signal.throwIfAborted();
        const result = await run.connections.request({
          provider: 'google',
          url: origin + path,
          method: body === undefined ? 'GET' : 'POST',
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return JSON.parse(result.body);
      }
      let result;
      if (name === 'search_messages') {
        const params = new URLSearchParams({ maxResults: String(input.limit ?? 5) });
        if (input.query) params.set('q', input.query);
        if (input.pageToken) params.set('pageToken', input.pageToken);
        const list = await request('messages?' + params);
        const messages = [];
        for (const ref of list.messages ?? [])
          messages.push(
            toGmailSummary(
              await request('messages/' + encodeURIComponent(ref.id) + '?format=metadata'),
            ),
          );
        result = { messages, nextPageToken: list.nextPageToken ?? null };
      } else if (name === 'get_message') {
        result = projectMessage(
          await request('messages/' + encodeURIComponent(input.messageId) + '?format=full'),
        );
      } else if (name === 'get_thread') {
        const thread = await request(
          'threads/' + encodeURIComponent(input.threadId) + '?format=full',
        );
        const offset = input.offset ?? 0,
          list = thread.messages ?? [],
          messages = [];
        for (const raw of list.slice(offset, offset + 5)) {
          const mail = projectMessage(raw);
          if (messages.length && Buffer.byteLength(JSON.stringify([...messages, mail])) > 22000)
            break;
          messages.push(mail);
        }
        const next = offset + messages.length;
        result = { id: thread.id, messages, nextOffset: next < list.length ? next : null };
      } else if (name === 'list_labels') {
        result = {
          labels: ((await request('labels')).labels ?? []).map(({ id, name, type }) => ({
            id,
            name,
            type,
          })),
        };
      } else {
        let path, body;
        if (name === 'create_draft' || name === 'send_message') {
          path = name === 'create_draft' ? 'drafts' : 'messages/send';
          body = { to: input.to, subject: input.subject, text: input.text };
        } else {
          const base = 'messages/' + encodeURIComponent(input.messageId);
          path = base + (name === 'change_message' ? '/modify' : '/trash');
          body = name === 'change_message' ? { change: input.change } : {};
        }
        const changed = await request(path, body);
        result = {
          id: changed.id,
          messageId: changed.message?.id ?? changed.id,
          threadId: changed.message?.threadId ?? changed.threadId ?? null,
        };
      }
      if (Buffer.byteLength(JSON.stringify(result)) > 24000)
        throw new Error('connection-result-too-large');
      return result;
    });
}

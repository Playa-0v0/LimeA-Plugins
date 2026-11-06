import { Client } from '@notionhq/client';
import { z } from 'zod';
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type NotionRead = 'search' | 'page' | 'children';
export interface RequestCapability {
  request(input: {
    provider: string;
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}
import { ConnectionError } from './errors.ts';

const notionId = z
  .string()
  .regex(/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/);
const cursor = z.string().min(1).max(256).optional();
const schemas = {
  search: z
    .object({
      query: z.string().max(256).optional(),
      cursor,
      pageSize: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
  page: z.object({ pageId: notionId }).strict(),
  children: z
    .object({ blockId: notionId, cursor, pageSize: z.number().int().min(1).max(50).optional() })
    .strict(),
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, limit = 8000) =>
  (Array.isArray(v)
    ? v
        .map((item) => {
          const i = object(item);
          return typeof i['plain_text'] === 'string'
            ? i['plain_text']
            : String(object(i['text'])['content'] ?? object(i['equation'])['expression'] ?? '');
        })
        .join('')
    : typeof v === 'string'
      ? v
      : ''
  ).slice(0, limit);
const page = (v: unknown): JsonValue => {
  const p = object(v),
    properties = object(p['properties']);
  const title = Object.values(properties).find((v) => object(v)['type'] === 'title');
  const readable: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(properties).slice(0, 32)) {
    const prop = object(value),
      type = String(prop['type']);
    if (type === 'title' || type === 'rich_text') readable[name] = text(prop[type], 4000);
    else if (['number', 'checkbox', 'url', 'email', 'phone_number'].includes(type))
      readable[name] =
        typeof prop[type] === 'string'
          ? String(prop[type]).slice(0, 4000)
          : typeof prop[type] === 'number' || typeof prop[type] === 'boolean'
            ? (prop[type] as number | boolean)
            : null;
    else if (type === 'select' || type === 'status')
      readable[name] = String(object(prop[type])['name'] ?? '').slice(0, 256);
    else if (type === 'multi_select')
      readable[name] = Array.isArray(prop[type])
        ? prop[type].map((v) => String(object(v)['name'] ?? '').slice(0, 256)).slice(0, 32)
        : [];
    else if (type === 'date') {
      const date = object(prop[type]);
      readable[name] = { start: String(date['start'] ?? ''), end: String(date['end'] ?? '') };
    }
  }
  return {
    id: String(p['id']),
    title: text(object(title)['title']) || 'Untitled',
    url:
      typeof p['url'] === 'string' && p['url'].startsWith('https://www.notion.so/') ? p['url'] : '',
    lastEditedAt: String(p['last_edited_time'] ?? ''),
    properties: readable,
  };
};
const block = (v: unknown): JsonValue => {
  const b = object(v),
    type = String(b['type']),
    value = object(b[type]);
  return {
    id: String(b['id']),
    type,
    hasChildren: b['has_children'] === true,
    text: text(value['rich_text'] ?? value['caption'] ?? value['title'] ?? value['expression']),
    textTruncated:
      text(
        value['rich_text'] ?? value['caption'] ?? value['title'] ?? value['expression'],
        1024 * 1024,
      ).length > 8000,
    ...(Array.isArray(value['cells'])
      ? { cells: value['cells'].slice(0, 32).map((v) => text(v, 4000)) }
      : {}),
    ...(typeof value['checked'] === 'boolean' ? { checked: value['checked'] } : {}),
    ...(value['page_id'] ? { pageId: String(value['page_id']) } : {}),
  };
};
function checkedOutput(value: JsonValue): JsonValue {
  // Leave room for the host tool envelope, whose existing limit is 30,000 bytes.
  if (Buffer.byteLength(JSON.stringify(value)) > 24000)
    throw new ConnectionError('connection-result-too-large');
  return value;
}
export function createNotionReader(capability: RequestCapability) {
  return async (kind: NotionRead, raw: unknown, signal: AbortSignal): Promise<JsonValue> => {
    const parsed = schemas[kind].safeParse(raw);
    if (!parsed.success) throw new ConnectionError('connection-invalid-read');
    signal.throwIfAborted();
    const client = new Client({
      notionVersion: '2026-03-11',
      retry: false,
      timeoutMs: 15_000,
      logger: () => {},
      fetch: async (url, init) => {
        // The SDK builds requests; the host injects credentials and enforces the read grant.
        const response = await capability.request({
          provider: 'notion',
          url: String(url),
          method: init?.method?.toUpperCase() as 'GET' | 'POST',
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          headers: new Headers(response.headers),
          body: null,
          text: async () => response.body,
        };
      },
    });
    try {
      const input = parsed.data;
      if (kind === 'page' && 'pageId' in input)
        return checkedOutput(page(await client.pages.retrieve({ page_id: input.pageId })));
      const result =
        kind === 'search' && 'query' in input
          ? await client.search({
              query: input.query,
              start_cursor: input.cursor,
              page_size: input.pageSize ?? 20,
              filter: { property: 'object', value: 'page' },
              sort: { direction: 'descending', timestamp: 'last_edited_time' },
            })
          : kind === 'search'
            ? await client.search({
                start_cursor: 'cursor' in input ? input.cursor : undefined,
                page_size: 'pageSize' in input ? (input.pageSize ?? 20) : 20,
                filter: { property: 'object', value: 'page' },
              })
            : await client.blocks.children.list({
                block_id: 'blockId' in input ? input.blockId : '',
                ...('cursor' in input && input.cursor ? { start_cursor: input.cursor } : {}),
                page_size: 'pageSize' in input ? (input.pageSize ?? 50) : 50,
              });
      signal.throwIfAborted();
      return checkedOutput({
        items: result.results.map(kind === 'search' ? page : block),
        hasMore: result.has_more,
        nextCursor: result.next_cursor,
      });
    } catch (error) {
      if (signal.aborted) {
        signal.throwIfAborted();
      }
      if (error instanceof ConnectionError) throw error;
      if (error instanceof Error && /^connection-[a-z-]+$/.test(error.message))
        throw new ConnectionError(error.message);
      const status = object(error)['status'];
      throw new ConnectionError(
        status === 401
          ? 'connection-reauthorization-required'
          : status === 403
            ? 'connection-capability-denied'
            : status === 404
              ? 'connection-object-unavailable'
              : status === 429
                ? 'connection-rate-limited'
                : 'connection-read-failed',
      );
    }
  };
}

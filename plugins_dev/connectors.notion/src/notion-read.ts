import { Client } from '@notionhq/client';
import { z } from 'zod';
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type NotionRead = 'search' | 'page' | 'children';
export interface RequestCapability {
  request(input: {
    provider: string;
    url: string;
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
export const projectNotionPage = (v: unknown): JsonValue => {
  const p = object(v),
    properties = object(p['properties']);
  const title = Object.values(properties).find((v) => object(v)['type'] === 'title');
  const readable: Record<string, JsonValue> = {};
  const issues: { name: string; type: string; reason: string }[] = [];
  let omittedIssueCount = 0;
  const issue = (name: string, type: string, reason: string) => {
    if (issues.length < 100) issues.push({ name, type, reason });
    else omittedIssueCount++;
  };
  const limitedText = (value: unknown, limit: number, name: string, type: string) => {
    const full = text(value, 1024 * 1024);
    if (full.length > limit) issue(name, type, 'text-truncated');
    return full.slice(0, limit);
  };
  const projected = (value: unknown, name: string, depth = 0): JsonValue | undefined => {
    const prop = object(value),
      type = String(prop['type'] ?? 'unknown'),
      data = prop[type];
    if (depth > 3) {
      issue(name, type, 'nesting-limit');
      return undefined;
    }
    if (type === 'title' || type === 'rich_text') {
      const items = Array.isArray(data) ? data : [];
      if (items.filter((item) => object(item)['type'] === 'mention').length >= 25)
        issue(name, type, 'mentions-may-be-incomplete');
      return limitedText(data, 4000, name, type);
    }
    if (
      [
        'number',
        'checkbox',
        'url',
        'email',
        'phone_number',
        'created_time',
        'last_edited_time',
      ].includes(type)
    ) {
      if (typeof data === 'string') {
        if (data.length > 4000) issue(name, type, 'text-truncated');
        return data.slice(0, 4000);
      }
      return typeof data === 'number' || typeof data === 'boolean' ? data : null;
    }
    if (type === 'select' || type === 'status') {
      const value = String(object(data)['name'] ?? '');
      if (value.length > 256) issue(name, type, 'text-truncated');
      return value.slice(0, 256);
    }
    if (type === 'multi_select') {
      const items = Array.isArray(data) ? data : [];
      if (items.length > 32) issue(name, type, 'items-truncated');
      return items.slice(0, 32).map((item) => {
        const value = String(object(item)['name'] ?? '');
        if (value.length > 256) issue(name, type, 'text-truncated');
        return value.slice(0, 256);
      });
    }
    if (type === 'date') {
      const date = object(data);
      return {
        start: String(date['start'] ?? ''),
        end: String(date['end'] ?? ''),
        timeZone: String(date['time_zone'] ?? ''),
      };
    }
    if (type === 'relation' || type === 'people') {
      const items = Array.isArray(data) ? data : [];
      if (items.length > 32) issue(name, type, 'items-truncated');
      if (prop['has_more'] === true) issue(name, type, 'upstream-has-more');
      if (type === 'people' && items.length >= 25) issue(name, type, 'upstream-may-have-more');
      return items.slice(0, 32).map((item) => {
        const v = object(item),
          id = String(v['id'] ?? '');
        if (type === 'relation') return id;
        const label = typeof v['name'] === 'string' ? v['name'] : '';
        if (label.length > 256) issue(name, type, 'text-truncated');
        return { id, name: label.slice(0, 256), type: String(v['type'] ?? '') };
      });
    }
    if (type === 'formula' || type === 'rollup') {
      const nested = object(data),
        subtype = String(nested['type'] ?? 'unknown');
      if (subtype === 'unsupported' || subtype === 'incomplete' || subtype === 'unknown') {
        issue(name, type, 'upstream-' + subtype);
        return { type: subtype, value: null };
      }
      issue(name, type, 'upstream-result-may-be-incomplete');
      if (subtype === 'array') {
        const items = Array.isArray(nested['array']) ? nested['array'] : [];
        if (items.length > 32) issue(name, type, 'items-truncated');
        return {
          type: subtype,
          value: items.slice(0, 32).map((item) => projected(item, name, depth + 1) ?? null),
        };
      }
      if (!['string', 'number', 'boolean', 'date'].includes(subtype)) {
        issue(name, type, 'unsupported-result-' + subtype);
        return { type: subtype, value: null };
      }
      const nestedData = nested[subtype];
      if (subtype === 'date') {
        const date = object(nestedData);
        return {
          type: subtype,
          value:
            nestedData === null
              ? null
              : {
                  start: String(date['start'] ?? ''),
                  end: String(date['end'] ?? ''),
                  timeZone: String(date['time_zone'] ?? ''),
                },
        };
      }
      if (typeof nestedData === 'string') {
        if (nestedData.length > 4000) issue(name, type, 'text-truncated');
        return { type: subtype, value: nestedData.slice(0, 4000) };
      }
      return {
        type: subtype,
        value:
          typeof nestedData === 'number' || typeof nestedData === 'boolean' ? nestedData : null,
      };
    }
    issue(name, type, 'unsupported-property-type');
    return undefined;
  };
  const entries = Object.entries(properties);
  if (!p['properties'] || typeof p['properties'] !== 'object' || Array.isArray(p['properties']))
    issue('', 'page', 'properties-unavailable');
  for (const [name, value] of entries.slice(0, 32)) {
    const result = projected(value, name);
    if (result !== undefined) readable[name] = result;
  }
  for (const [name, value] of entries.slice(32))
    issue(name, String(object(value)['type'] ?? 'unknown'), 'property-limit');
  return {
    id: String(p['id']),
    title: text(object(title)['title']) || 'Untitled',
    url:
      typeof p['url'] === 'string' && p['url'].startsWith('https://www.notion.so/') ? p['url'] : '',
    lastEditedAt: String(p['last_edited_time'] ?? ''),
    properties: readable,
    ...(issues.length || omittedIssueCount
      ? {
          propertiesIncomplete: true,
          propertyIssues: issues,
          ...(omittedIssueCount ? { omittedIssueCount } : {}),
        }
      : {}),
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
export function createNotionClient(capability: RequestCapability) {
  return new Client({
    notionVersion: '2026-03-11',
    retry: false,
    timeoutMs: 15_000,
    logger: () => {},
    fetch: async (url, init) => {
      // The SDK builds requests; the host injects credentials and enforces the read grant.
      const response = await capability.request({
        provider: 'notion',
        url: String(url),
        method: init?.method?.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
}
export function createNotionReader(capability: RequestCapability) {
  return async (kind: NotionRead, raw: unknown, signal: AbortSignal): Promise<JsonValue> => {
    const parsed = schemas[kind].safeParse(raw);
    if (!parsed.success) throw new ConnectionError('connection-invalid-read');
    signal.throwIfAborted();
    const client = createNotionClient(capability);
    try {
      const input = parsed.data;
      if (kind === 'page' && 'pageId' in input)
        return checkedOutput(
          projectNotionPage(await client.pages.retrieve({ page_id: input.pageId })),
        );
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
        items: result.results.map(kind === 'search' ? projectNotionPage : block),
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

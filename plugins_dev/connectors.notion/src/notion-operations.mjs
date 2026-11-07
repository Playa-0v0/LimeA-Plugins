import { z } from 'zod';
import { createNotionClient, projectNotionPage } from './notion-read.ts';
import { ConnectionError } from './errors.ts';

const id = z
  .string()
  .regex(/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/);
const cursor = z.string().min(1).max(256).optional();
const size = z.number().int().min(1).max(20).optional();
const jsonObject = z
  .record(z.string(), z.json())
  .refine((v) => Buffer.byteLength(JSON.stringify(v)) <= 12000);
const pagination = { cursor, pageSize: size };
const definitions = {
  search_sources: z.object({ query: z.string().max(256).optional(), ...pagination }).strict(),
  database: z.object({ databaseId: id }).strict(),
  source: z.object({ sourceId: id }).strict(),
  query_source: z
    .object({
      sourceId: id,
      filter: jsonObject.optional(),
      sorts: z.array(jsonObject).max(10).optional(),
      ...pagination,
    })
    .strict(),
  comments: z.object({ blockId: id, ...pagination }).strict(),
};
export const readOperations = ['search_sources', 'database', 'source', 'query_source', 'comments'];
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item?.plain_text ?? item?.text?.content ?? ''))
        .join('')
        .slice(0, 8000)
    : '';
function result(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 24000)
    throw new ConnectionError('connection-result-too-large');
  return value;
}
function source(value) {
  const item = object(value),
    properties = object(item.properties);
  return {
    id: String(item.id ?? ''),
    title: text(item.title),
    properties: Object.entries(properties)
      .slice(0, 50)
      .map(([name, value]) => ({
        name,
        id: String(value?.id ?? ''),
        type: String(value?.type ?? ''),
      })),
    propertiesTruncated: Object.keys(properties).length > 50,
  };
}
export function createNotionOperations(capability) {
  const client = createNotionClient(capability);
  return async (kind, raw, signal) => {
    if (!Object.hasOwn(definitions, kind))
      throw new ConnectionError('connection-invalid-operation');
    const parsed = definitions[kind].safeParse(raw);
    if (!parsed.success) throw new ConnectionError('connection-invalid-read');
    const input = parsed.data;
    signal.throwIfAborted();
    let path, method, body, query;
    switch (kind) {
      case 'search_sources':
        path = 'search';
        method = 'post';
        body = {
          filter: { property: 'object', value: 'data_source' },
          ...(input.query ? { query: input.query } : {}),
          ...(input.cursor ? { start_cursor: input.cursor } : {}),
          page_size: input.pageSize ?? 20,
        };
        break;
      case 'database':
        path = `databases/${input.databaseId}`;
        method = 'get';
        break;
      case 'source':
        path = `data_sources/${input.sourceId}`;
        method = 'get';
        break;
      case 'query_source':
        path = `data_sources/${input.sourceId}/query`;
        method = 'post';
        body = {
          ...(input.filter ? { filter: input.filter } : {}),
          ...(input.sorts ? { sorts: input.sorts } : {}),
          ...(input.cursor ? { start_cursor: input.cursor } : {}),
          page_size: input.pageSize ?? 20,
        };
        break;
      case 'comments':
        path = 'comments';
        method = 'get';
        query = {
          block_id: input.blockId,
          ...(input.cursor ? { start_cursor: input.cursor } : {}),
          page_size: input.pageSize ?? 20,
        };
        break;
    }
    if (body && Buffer.byteLength(JSON.stringify(body)) > 16384)
      throw new ConnectionError('connection-invalid-read');
    try {
      const response = await client.request({
        path,
        method,
        ...(body ? { body } : {}),
        ...(query ? { query } : {}),
      });
      signal.throwIfAborted();
      if (kind === 'database')
        return result({
          id: String(response.id ?? ''),
          title: text(response.title),
          dataSources: (response.data_sources ?? []).map((s) => ({
            id: String(s.id ?? ''),
            name: String(s.name ?? ''),
          })),
        });
      if (kind === 'source') return result(source(response));
      if (kind === 'comments')
        return result({
          items: (response.results ?? []).map((c) => ({
            id: String(c.id ?? ''),
            discussionId: String(c.discussion_id ?? ''),
            text: text(c.rich_text),
            createdAt: String(c.created_time ?? ''),
          })),
          hasMore: response.has_more,
          nextCursor: response.next_cursor,
        });
      return result({
        items: (response.results ?? []).map(kind === 'search_sources' ? source : projectNotionPage),
        hasMore: response.has_more,
        nextCursor: response.next_cursor,
        ...(response.request_status ? { requestStatus: response.request_status } : {}),
      });
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      if (error instanceof ConnectionError) throw error;
      if (error instanceof Error && /^connection-[a-z-]+$/.test(error.message))
        throw new ConnectionError(error.message);
      const status = object(error).status;
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

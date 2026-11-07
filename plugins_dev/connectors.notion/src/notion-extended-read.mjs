import { z } from 'zod';
import { createNotionClient } from './notion-read.ts';
import { ConnectionError } from './errors.ts';

const uuid = z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i);
const cursor = z.string().min(1).max(256).optional();
const common = { cursor, pageSize: z.number().int().min(1).max(20).optional() };
const cases = {
  block: z.object({ kind: z.literal('block'), id: uuid }).strict(),
  page_property: z
    .object({
      kind: z.literal('page_property'),
      id: uuid,
      propertyId: z.string().min(1).max(128),
      ...common,
    })
    .strict(),
  user: z.object({ kind: z.literal('user'), id: uuid }).strict(),
  current_user: z.object({ kind: z.literal('current_user') }).strict(),
  users: z.object({ kind: z.literal('users'), ...common }).strict(),
  comment: z.object({ kind: z.literal('comment'), id: uuid }).strict(),
  view: z.object({ kind: z.literal('view'), id: uuid }).strict(),
  views: z
    .object({
      kind: z.literal('views'),
      databaseId: uuid.optional(),
      sourceId: uuid.optional(),
      ...common,
    })
    .strict()
    .refine((v) => Boolean(v.databaseId) !== Boolean(v.sourceId)),
  templates: z
    .object({
      kind: z.literal('templates'),
      id: uuid,
      name: z.string().max(256).optional(),
      ...common,
    })
    .strict(),
  markdown: z.object({ kind: z.literal('markdown'), id: uuid }).strict(),
};
function propertyId(input) {
  let decoded;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new ConnectionError('connection-invalid-read');
  }
  if (
    !decoded ||
    decoded.length > 64 ||
    /[\u0000-\u001f\u007f/\\%?#]/.test(decoded) ||
    decoded === '.' ||
    decoded === '..'
  )
    throw new ConnectionError('connection-invalid-read');
  return encodeURIComponent(decoded);
}
function project(value) {
  const issues = [];
  let omittedIssues = 0;
  const issue = (path, reason) => {
    if (issues.length < 100) issues.push({ path, reason });
    else omittedIssues++;
  };
  function copy(item, path, depth, parent) {
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item === 'string') {
      if (item.length > 4000) issue(path, 'text-truncated');
      return item.slice(0, 4000);
    }
    if (depth >= 12) {
      issue(path, 'nesting-limit');
      return null;
    }
    if (Array.isArray(item)) {
      if (item.length > 50) issue(path, 'items-truncated');
      return item.slice(0, 50).map((v, i) => copy(v, `${path}[${i}]`, depth + 1, ''));
    }
    if (typeof item !== 'object') {
      issue(path, 'unsupported-value');
      return null;
    }
    const result = Object.create(null),
      entries = Object.entries(item);
    if (entries.length > 100) issue(path, 'fields-truncated');
    for (const [key, val] of entries.slice(0, 100)) {
      const field = path ? `${path}.${key}` : key;
      if ((parent === 'file' || parent === 'external') && key === 'url') {
        issue(field, 'attachment-url-omitted');
        continue;
      }
      result[key] = copy(val, field, depth + 1, key);
    }
    return result;
  }
  const data = copy(value, '', 0, '');
  const out = {
    data,
    ...(issues.length || omittedIssues
      ? { incomplete: true, issues, ...(omittedIssues ? { omittedIssues } : {}) }
      : {}),
  };
  if (Buffer.byteLength(JSON.stringify(out)) > 24000)
    throw new ConnectionError('connection-result-too-large');
  return out;
}
/** Raw normalized Notion data, bounded and with omissions explicitly marked. */
export function createExtendedReader(capability) {
  const client = createNotionClient(capability);
  return async (raw, signal) => {
    if (!raw || typeof raw !== 'object' || !Object.hasOwn(cases, raw.kind))
      throw new ConnectionError('connection-invalid-read');
    const parsed = cases[raw.kind].safeParse(raw);
    if (!parsed.success) throw new ConnectionError('connection-invalid-read');
    const v = parsed.data;
    const pagination = {
      ...(v.cursor ? { start_cursor: v.cursor } : {}),
      page_size: v.pageSize ?? 20,
    };
    let path, query;
    switch (v.kind) {
      case 'block':
        path = `blocks/${v.id}`;
        break;
      case 'page_property':
        path = `pages/${v.id}/properties/${propertyId(v.propertyId)}`;
        query = pagination;
        break;
      case 'user':
        path = `users/${v.id}`;
        break;
      case 'current_user':
        path = 'users/me';
        break;
      case 'users':
        path = 'users';
        query = pagination;
        break;
      case 'comment':
        path = `comments/${v.id}`;
        break;
      case 'view':
        path = `views/${v.id}`;
        break;
      case 'views':
        path = 'views';
        query = {
          ...(v.databaseId ? { database_id: v.databaseId } : { data_source_id: v.sourceId }),
          ...pagination,
        };
        break;
      case 'templates':
        path = `data_sources/${v.id}/templates`;
        query = { ...(v.name ? { name: v.name } : {}), ...pagination };
        break;
      case 'markdown':
        path = `pages/${v.id}/markdown`;
        break;
    }
    signal.throwIfAborted();
    try {
      const response = await client.request({ path, method: 'get', ...(query ? { query } : {}) });
      signal.throwIfAborted();
      return project(response);
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      if (error instanceof ConnectionError) throw error;
      if (error instanceof Error && /^connection-[a-z-]+$/.test(error.message))
        throw new ConnectionError(error.message);
      const status = error?.status;
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

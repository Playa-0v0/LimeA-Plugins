import { z } from 'zod';
import { createNotionClient } from './notion-read.ts';
import { ConnectionError } from './errors.ts';

const uuid = '(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})';
const schema = z
  .object({
    method: z.enum(['POST', 'PATCH', 'DELETE']),
    path: z.string().max(256),
    body: z.record(z.string(), z.json()).optional(),
  })
  .strict();
const allowed = [
  [
    'POST',
    new RegExp(`^/v1/(?:pages|comments|databases|data_sources|views|pages/${uuid}/move)$`, 'i'),
  ],
  [
    'PATCH',
    new RegExp(
      `^/v1/(?:pages/${uuid}(?:/markdown)?|blocks/${uuid}(?:/children)?|databases/${uuid}|data_sources/${uuid}|views/${uuid}|comments/${uuid})$`,
      'i',
    ),
  ],
  ['DELETE', new RegExp(`^/v1/(?:blocks|views|comments)/${uuid}$`, 'i')],
];
function checkPayload(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 24000)
    throw new ConnectionError('connection-invalid-write');
  function visit(item, depth) {
    if (depth > 20) throw new ConnectionError('connection-invalid-write');
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      if (item.length > 100) throw new ConnectionError('connection-invalid-write');
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (
      item.text?.content !== undefined &&
      (typeof item.text.content !== 'string' || item.text.content.length > 2000)
    )
      throw new ConnectionError('connection-invalid-write');
    for (const child of Object.values(item)) visit(child, depth + 1);
  }
  visit(value, 0);
}
// The host enforces per-request approval, persisted intent and replay prevention.
export function createNotionWrites(capability) {
  const client = createNotionClient(capability);
  return async (raw, signal) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ConnectionError('connection-invalid-write');
    const { method, path, body } = parsed.data;
    if (!allowed.some(([verb, expression]) => verb === method && expression.test(path)))
      throw new ConnectionError('connection-invalid-write');
    if ((method === 'DELETE') !== (body === undefined))
      throw new ConnectionError('connection-invalid-write');
    if (body?.allow_async !== undefined && body.allow_async !== false)
      throw new ConnectionError('connection-invalid-write');
    if (body) checkPayload(body);
    signal.throwIfAborted();
    try {
      const response = await client.request({
        path: path.slice(4),
        method: method.toLowerCase(),
        ...(body === undefined ? {} : { body }),
      });
      signal.throwIfAborted();
      return {
        id: String(response.id ?? ''),
        object: String(response.object ?? ''),
        ...(Array.isArray(response.results)
          ? { ids: response.results.map((item) => String(item.id ?? '')) }
          : {}),
        ...(typeof response.truncated === 'boolean' ? { truncated: response.truncated } : {}),
        ...(Array.isArray(response.unknown_block_ids)
          ? {
              unknownBlockIds: response.unknown_block_ids.slice(0, 32).map(String),
              unknownBlockIdsTruncated: response.unknown_block_ids.length > 32,
            }
          : {}),
        ...(Array.isArray(response.warnings)
          ? {
              warnings: response.warnings
                .slice(0, 10)
                .map((item) => JSON.stringify(item).slice(0, 512)),
              warningsTruncated:
                response.warnings.length > 10 ||
                response.warnings.some((item) => JSON.stringify(item).length > 512),
            }
          : {}),
      };
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
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
                : status >= 400 && status < 500
                  ? 'connection-write-rejected'
                  : 'connection-write-unknown',
      );
    }
  };
}

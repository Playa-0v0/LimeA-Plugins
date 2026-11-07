import { z } from 'zod';
import { ConnectionError } from './errors.ts';
export const operations = {
  create_page: ['POST', '/v1/pages'],
  update_page: ['PATCH', '/v1/pages/{id}'],
  move_page: ['POST', '/v1/pages/{id}/move'],
  update_markdown: ['PATCH', '/v1/pages/{id}/markdown'],
  append_blocks: ['PATCH', '/v1/blocks/{id}/children'],
  update_block: ['PATCH', '/v1/blocks/{id}'],
  trash_block: ['DELETE', '/v1/blocks/{id}'],
  create_database: ['POST', '/v1/databases'],
  update_database: ['PATCH', '/v1/databases/{id}'],
  create_data_source: ['POST', '/v1/data_sources'],
  update_data_source: ['PATCH', '/v1/data_sources/{id}'],
  create_view: ['POST', '/v1/views'],
  update_view: ['PATCH', '/v1/views/{id}'],
  delete_view: ['DELETE', '/v1/views/{id}'],
  create_comment: ['POST', '/v1/comments'],
  update_comment: ['PATCH', '/v1/comments/{id}'],
  delete_comment: ['DELETE', '/v1/comments/{id}'],
};
const id = z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i);
const body = z.record(z.string(), z.json());
export function operationRequest(tool, raw) {
  try {
    let operation, targetId, payload;
    if (tool === 'append_blocks') {
      const value = z
        .object({ blockId: id, children: z.array(body).min(1).max(100) })
        .strict()
        .parse(raw);
      operation = tool;
      targetId = value.blockId;
      payload = { children: value.children };
    } else if (tool === 'update_page') {
      const value = z.object({ pageId: id, body }).strict().parse(raw);
      operation = tool;
      targetId = value.pageId;
      payload = value.body;
    } else if (tool === 'create_page' || tool === 'create_comment') {
      const value = z.object({ body }).strict().parse(raw);
      operation = tool;
      payload = value.body;
    } else {
      const value = z
        .object({
          operation: z.enum(Object.keys(operations)),
          targetId: id.optional(),
          body: body.optional(),
        })
        .strict()
        .parse(raw);
      operation = value.operation;
      targetId = value.targetId;
      payload = value.body;
    }
    const [method, template] = operations[operation];
    if (
      template.includes('{id}') !== Boolean(targetId) ||
      (method === 'DELETE') !== (payload === undefined)
    )
      throw new Error();
    return {
      method,
      path: template.replace('{id}', targetId ?? ''),
      ...(payload === undefined ? {} : { body: payload }),
    };
  } catch {
    throw new ConnectionError('connection-invalid-write');
  }
}

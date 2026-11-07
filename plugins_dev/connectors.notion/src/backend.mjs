import { operationRequest } from './operation-request.mjs';
import { createNotionReader } from './notion-read.ts';
import { createNotionOperations, readOperations } from './notion-operations.mjs';
import { createNotionWrites } from './notion-write.mjs';
import { createExtendedReader } from './notion-extended-read.mjs';
export function apply(ctx) {
  for (const operation of ['search', 'page', 'children']) {
    ctx.tools.register(operation, async (input, context) => {
      if (!context.connections) throw new Error('connection-access-denied');
      return createNotionReader(context.connections)(operation, input, context.signal);
    });
  }
  for (const operation of readOperations) {
    ctx.tools.register(operation, async (input, context) => {
      if (!context.connections) throw new Error('connection-access-denied');
      return createNotionOperations(context.connections)(operation, input, context.signal);
    });
  }
  for (const tool of [
    'request_write',
    'create_page',
    'append_blocks',
    'update_page',
    'create_comment',
  ])
    ctx.tools.register(tool, async (input, context) => {
      if (!context.connections) throw new Error('connection-access-denied');
      return createNotionWrites(context.connections)(operationRequest(tool, input), context.signal);
    });
  ctx.tools.register('read_resource', async (input, context) => {
    if (!context.connections) throw new Error('connection-access-denied');
    return createExtendedReader(context.connections)(input, context.signal);
  });
}

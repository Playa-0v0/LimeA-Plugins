import { createNotionReader } from './notion-read.ts';
export function apply(ctx) {
  for (const operation of ['search', 'page', 'children']) {
    ctx.tools.register(operation, async (input, context) => {
      if (!context.connections) throw new Error('connection-access-denied');
      return createNotionReader(context.connections)(operation, input, context.signal);
    });
  }
}

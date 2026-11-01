import { createGame, migrations } from './game.mjs';
import { createEngine } from './engine.mjs';

export async function apply(context) {
  const database = await context.storage.openDatabase({ name: 'matches', migrations });
  const game = await createGame(database, { engine: createEngine() });
  context.onDispose(async () => {
    await game.dispose();
    await database.close();
  });
  context.commands.register('load-match', (payload) =>
    payload?.sessionId ? game.load(payload) : null,
  );
  context.commands.register('load-settings', game.settings);
  context.commands.register('save-settings', game.saveSettings);
  context.commands.register('match-action', async (payload) => {
    if (payload?.action !== 'quit' && !(await context.sessions.isRunning(payload?.sessionId)))
      throw new Error('game-paused');
    return game.act(payload);
  });
  context.tools.register('start', game.start);
  context.tools.register('place_stone', game.modelMove);
  context.tools.register('history', game.history);
  context.tools.interaction({ policy: game.policy, finished: game.finished });
}

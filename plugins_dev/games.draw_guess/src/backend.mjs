import { createGame, migrations } from './game.mjs';
export async function apply(context) {
  if (!context.canvas) throw new Error('draw-guess-host-update-required');
  const database = await context.storage.openDatabase({ name: 'game', migrations });
  const game = await createGame(database, { validateCanvas: context.canvas.validate });
  context.commands.register('load-game', (input) => (input?.sessionId ? game.load(input) : null));
  context.commands.register('game-action', game.action);
  context.commands.register('load-settings', game.settings);
  context.commands.register('save-settings', game.saveSettings);
  context.tools.register('play', game.play);
  context.tools.register('history', game.history);
  context.tools.interaction({ policy: async () => null, finished: game.finished });
  context.onDispose(async () => {
    await game.dispose();
    await database.close();
  });
}

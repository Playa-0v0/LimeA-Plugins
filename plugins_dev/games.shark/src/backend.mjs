import { createCompanionGame, duoMigration } from './duo.mjs';
import { randomInt, randomUUID } from 'node:crypto';

const TEETH = 12;
function scopeKey(payload) {
  if (
    !payload ||
    payload.mode !== 'chat' ||
    (payload.sessionId !== null &&
      (typeof payload.sessionId !== 'string' || payload.sessionId.length > 128))
  )
    throw new Error('invalid-game-scope');
  return JSON.stringify([payload.mode, payload.sessionId]);
}
function publicRound(round) {
  return { id: round.id, pressed: round.pressed, status: round.status, teeth: TEETH };
}

export const migrations = [
  {
    id: '1000_initial',
    sql: 'CREATE TABLE IF NOT EXISTS rounds (scope TEXT PRIMARY KEY, state TEXT NOT NULL);',
  },
  duoMigration,
];

export async function createGameStore(storage, draw = () => randomInt(1, TEETH + 1)) {
  const database = await storage.openDatabase({
    name: 'rounds',
    migrations,
    legacyFile: 'rounds.sqlite',
  });
  // 一次操作的读取、规则判断和写入串行，避免异步数据库让快速连点覆盖彼此。
  let queue = Promise.resolve();
  let disposed = false;
  const serial = (action) => {
    if (disposed) return Promise.reject(new Error('game-closed'));
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const read = async (key) => {
    const row = await database.get('SELECT state FROM rounds WHERE scope = ?', [key]);
    return row ? JSON.parse(row.state) : null;
  };
  const make = () => ({ id: randomUUID(), trap: draw(), pressed: [], status: 'playing' });
  const write = async (key, round) => {
    await database.run(
      'INSERT INTO rounds(scope, state) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET state=excluded.state',
      [key, JSON.stringify(round)],
    );
    return publicRound(round);
  };
  return {
    database,
    load: (payload) =>
      serial(async () => {
        const key = scopeKey(payload),
          round = await read(key);
        return round ? publicRound(round) : write(key, make());
      }),
    press: (payload) =>
      serial(async () => {
        const key = scopeKey(payload),
          round = await read(key);
        if (!Number.isInteger(payload.tooth) || payload.tooth < 1 || payload.tooth > TEETH)
          throw new Error('invalid-tooth');
        if (!round || round.id !== payload.roundId) throw new Error('stale-round');
        if (round.status === 'bitten' || round.pressed.includes(payload.tooth))
          return publicRound(round);
        round.pressed.push(payload.tooth);
        if (round.trap === payload.tooth) round.status = 'bitten';
        return write(key, round);
      }),
    restart: (payload) =>
      serial(async () => {
        const key = scopeKey(payload),
          round = await read(key);
        if (round && round.id !== payload.roundId) throw new Error('stale-round');
        return write(key, make());
      }),
    async dispose() {
      disposed = true;
      await queue;
      await database.close();
    },
  };
}

export async function apply(context) {
  const game = await createGameStore(context.storage);
  const companion = await createCompanionGame(game.database);
  context.onDispose(async () => {
    await companion.dispose();
    await game.dispose();
  });
  const solo = (action) => async (payload) => {
    if (payload?.sessionId && (await context.sessions.isRunning(payload.sessionId)))
      throw new Error('session-busy');
    const match = payload?.sessionId ? await companion.load(payload) : null;
    if (match && !['ended', 'paused'].includes(match.status))
      throw new Error('game-already-running');
    return action(payload);
  };
  context.commands.register('load-round', (payload) => game.load(payload));
  context.commands.register('press-tooth', solo(game.press));
  context.commands.register('new-round', solo(game.restart));
  context.commands.register('load-match', (payload) =>
    payload?.sessionId ? companion.load(payload) : null,
  );
  context.commands.register('match-action', async (payload) => {
    if (payload.action !== 'quit' && !(await context.sessions.isRunning(payload.sessionId)))
      throw new Error('game-paused');
    return companion.act(payload);
  });
  context.tools.register('start', companion.start);
  context.tools.register('press_tooth', companion.modelPress);
  context.tools.interaction({ policy: companion.policy, finished: companion.finished });
}

import { randomInt, randomUUID } from 'node:crypto';

export const duoMigration = {
  id: '1001_companion_matches',
  sql: 'CREATE TABLE companion_matches (session_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(json_valid(state)));',
};
const teeth = Array.from({ length: 12 }, (_, i) => i + 1);
export function publicMatch(match) {
  if (!match) return null;
  const { trap: _trap, operations: _operations, ...view } = match;
  return {
    ...view,
    remaining: teeth.filter((tooth) => !match.pressed.some((move) => move.tooth === tooth)),
  };
}
export async function createCompanionGame(
  database,
  { draw = () => randomInt(1, 13), first = () => (randomInt(2) === 0 ? 'human' : 'model') } = {},
) {
  let queue = Promise.resolve();
  let closed = false;
  const waiters = new Map();
  const serial = (work) => {
    if (closed) return Promise.reject(new Error('game-closed'));
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const key = (context) => {
    if (
      context?.mode !== 'chat' ||
      typeof context.sessionId !== 'string' ||
      !context.sessionId ||
      context.sessionId.length > 128
    )
      throw new Error('invalid-game-scope');
    return context.sessionId;
  };
  const read = async (id) => {
    const row = await database.get('SELECT state FROM companion_matches WHERE session_id = ?', [
      id,
    ]);
    return row ? JSON.parse(row.state) : null;
  };
  const notify = (id) => {
    for (const wake of waiters.get(id) ?? []) wake();
  };
  const write = async (id, match) => {
    match.revision++;
    await database.run(
      'INSERT INTO companion_matches(session_id,state) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state',
      [id, JSON.stringify(match)],
    );
    notify(id);
    return publicMatch(match);
  };
  const round = (match) => {
    match.roundId = randomUUID();
    match.roundNumber++;
    match.trap = draw();
    match.pressed = [];
    match.first = first();
    match.turn = match.first;
    match.status = 'active';
    match.winner = null;
    match.reason = null;
  };
  const press = (match, player, tooth) => {
    if (match.status !== 'active' || match.turn !== player) throw new Error('not-your-turn');
    if (
      !Number.isInteger(tooth) ||
      !teeth.includes(tooth) ||
      match.pressed.some((move) => move.tooth === tooth)
    )
      throw new Error('invalid-tooth');
    match.pressed.push({ tooth, player });
    if (match.trap === tooth) {
      match.status = 'round-over';
      match.winner = player === 'human' ? 'model' : 'human';
      match.scores[match.winner]++;
      match.turn = null;
    } else match.turn = player === 'human' ? 'model' : 'human';
  };
  const assertRun = (match, context) => {
    if (!match || match.runId !== context.runId) throw new Error('stale-game-run');
  };
  const wait = async (context) => {
    const id = key(context);
    while (true) {
      context.signal.throwIfAborted();
      let cleanup;
      let wake;
      const changed = new Promise((resolve) => {
        wake = resolve;
      });
      // Register before reading; a committed move cannot fall between the read and subscription.
      if (!waiters.has(id)) waiters.set(id, new Set());
      waiters.get(id).add(wake);
      const aborted = () => wake();
      context.signal.addEventListener('abort', aborted, { once: true });
      cleanup = () => {
        context.signal.removeEventListener('abort', aborted);
        waiters.get(id)?.delete(wake);
        if (!waiters.get(id)?.size) waiters.delete(id);
      };
      try {
        const match = await serial(() => read(id));
        assertRun(match, context);
        if (
          match.status === 'ended' ||
          match.status === 'round-over' ||
          (match.status === 'active' && match.turn === 'model')
        )
          return publicMatch(match);
        if (match.status === 'paused') throw new Error('game-paused');
        await changed;
      } finally {
        cleanup();
      }
    }
  };
  // A process restart only pauses matches. It never repeats a move or redraws a tooth.
  for (const row of await database.all('SELECT session_id,state FROM companion_matches')) {
    const match = JSON.parse(row.state);
    if (!['paused', 'ended'].includes(match.status)) {
      match.pausedPhase = match.status;
      match.status = 'paused';
      match.reason = 'interrupted';
      await write(row.session_id, match);
    }
  }
  return {
    async load(context) {
      return serial(async () => publicMatch(await read(key(context))));
    },
    async start(_input, context) {
      const id = key(context);
      context.signal.throwIfAborted();
      await serial(async () => {
        context.signal.throwIfAborted();
        let match = await read(id);
        if (match && !['paused', 'ended'].includes(match.status) && match.runId !== context.runId)
          throw new Error('game-already-running');
        if (match?.runId === context.runId && match.operations.includes(context.executionId))
          return;
        if (!match || match.status === 'ended') {
          match = {
            matchId: randomUUID(),
            roundId: '',
            roundNumber: 0,
            revision: 0,
            runId: context.runId,
            scores: { human: 0, model: 0 },
            operations: [],
          };
          round(match);
        } else if (match.status === 'paused') {
          match.runId = context.runId;
          match.status = match.pausedPhase;
          match.reason = null;
          match.operations = [];
        } else if (match.status === 'round-over') match.status = 'waiting-replay';
        else if (match.status !== 'waiting-replay') throw new Error('game-already-running');
        match.operations.push(context.executionId);
        await write(id, match);
      });
      return wait(context);
    },
    async modelPress(input, context) {
      const id = key(context);
      context.signal.throwIfAborted();
      await serial(async () => {
        context.signal.throwIfAborted();
        const match = await read(id);
        assertRun(match, context);
        if (match.status === 'ended' || match.operations.includes(context.executionId)) return;
        if (input.roundId !== match.roundId || input.revision !== match.revision)
          throw new Error('stale-round');
        press(match, 'model', input.tooth);
        match.operations.push(context.executionId);
        await write(id, match);
      });
      return wait(context);
    },
    async act(payload) {
      return serial(async () => {
        const id = key(payload),
          match = await read(id);
        if (
          !match ||
          payload.matchId !== match.matchId ||
          payload.roundId !== match.roundId ||
          payload.revision !== match.revision
        )
          throw new Error('stale-round');
        if (payload.action === 'quit') {
          match.status = 'ended';
          match.turn = null;
          match.reason = 'user-ended';
        } else if (payload.action === 'replay') {
          if (match.status !== 'waiting-replay') throw new Error('not-waiting-for-replay');
          round(match);
        } else if (payload.action === 'press') press(match, 'human', payload.tooth);
        else throw new Error('invalid-game-action');
        return write(id, match);
      });
    },
    async policy(context) {
      return serial(async () => {
        const match = await read(key(context));
        if (!match || match.runId !== context.runId || match.status === 'paused') return null;
        const state = JSON.stringify(publicMatch(match));
        if (match.status === 'ended')
          return {
            revision: String(match.revision),
            required: false,
            toolIds: [],
            instruction: `用户手动选择了结束游戏。比分和状态：${state}。简短回应后结束本轮，不要重新开局。`,
          };
        if (match.status === 'round-over')
          return {
            revision: String(match.revision),
            required: true,
            toolIds: ['start'],
            instruction: `本局已结束，结果：${state}。先用一句话回应输赢，然后调用 start 工具等待用户选择“再来一局/下次再玩”。不可替用户决定。`,
          };
        if (match.status === 'active' && match.turn === 'model')
          return {
            revision: String(match.revision),
            required: true,
            toolIds: ['press_tooth'],
            instruction: `轮到你选牙齿。游戏状态：${state}。调用 press_tooth，传入当前 roundId、revision 和一个 remaining 中的编号。只选一颗，不得推断危险牙齿。`,
          };
        throw new Error('game-wait-not-owned');
      });
    },
    async finished(context) {
      return serial(async () => {
        const id = key(context),
          match = await read(id);
        if (match?.runId === context.runId && !['ended', 'paused'].includes(match.status)) {
          match.pausedPhase = match.status;
          match.status = 'paused';
          match.reason = 'interrupted';
          await write(id, match);
        }
      });
    },
    async dispose() {
      closed = true;
      for (const id of waiters.keys()) notify(id);
      await queue;
    },
  };
}

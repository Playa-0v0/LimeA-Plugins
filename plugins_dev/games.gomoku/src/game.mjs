import { randomInt, randomUUID } from 'node:crypto';
import { place, publicMatch, textBoard, toolState } from './rules.mjs';

export const migrations = [
  {
    id: '1000_initial',
    sql: 'CREATE TABLE matches (session_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(json_valid(state)));',
  },
];

// Adapted from the shark plugin's persisted interaction flow. No cross-plugin runtime dependency.
export async function createGame(
  database,
  { first = () => (randomInt(2) === 0 ? 'human' : 'model') } = {},
) {
  let queue = Promise.resolve(),
    closed = false;
  const waiters = new Map();
  const serial = (action) => {
    if (closed) return Promise.reject(new Error('game-closed'));
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
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
    const row = await database.get('SELECT state FROM matches WHERE session_id=?', [id]);
    return row ? JSON.parse(row.state) : null;
  };
  const notify = (id) => {
    for (const wake of waiters.get(id) ?? []) wake();
  };
  const write = async (id, match) => {
    match.revision++;
    try {
      await database.run(
        'INSERT INTO matches(session_id,state) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state',
        [id, JSON.stringify(match)],
      );
    } finally {
      // Wake readers even when a committed write loses its response. They re-read
      // the database, never this unconfirmed in-memory candidate.
      notify(id);
    }
    return publicMatch(match);
  };
  const newRound = (match) => {
    match.roundId = randomUUID();
    match.roundNumber++;
    match.moves = [];
    match.black = first();
    match.turn = match.black;
    match.status = 'active';
    match.winner = null;
    match.winningLine = [];
    match.reason = null;
    delete match.pausedPhase;
    delete match.replayRequested;
  };
  const assertRun = (match, context) => {
    if (!match || match.runId !== context.runId) throw new Error('stale-game-run');
  };
  const wait = async (context) => {
    const id = key(context);
    while (true) {
      context.signal.throwIfAborted();
      let wake;
      const changed = new Promise((resolve) => {
        wake = resolve;
      });
      if (!waiters.has(id)) waiters.set(id, new Set());
      waiters.get(id).add(wake);
      context.signal.addEventListener('abort', wake, { once: true });
      try {
        const match = await serial(() => read(id));
        assertRun(match, context);
        context.signal.throwIfAborted();
        if (
          match.status === 'ended' ||
          match.status === 'round-over' ||
          (match.status === 'active' && match.turn === 'model')
        )
          return toolState(match);
        if (match.status === 'paused') throw new Error('game-paused');
        await changed;
      } finally {
        context.signal.removeEventListener('abort', wake);
        waiters.get(id)?.delete(wake);
        if (!waiters.get(id)?.size) waiters.delete(id);
      }
    }
  };
  for (const row of await database.all('SELECT session_id,state FROM matches')) {
    const match = JSON.parse(row.state);
    if (!['paused', 'ended'].includes(match.status)) {
      match.pausedPhase = match.status;
      match.status = 'paused';
      match.reason = 'interrupted';
      await write(row.session_id, match);
    }
  }
  return {
    load: (context) => serial(async () => publicMatch(await read(key(context)))),
    async start(_input, context) {
      const id = key(context);
      context.signal.throwIfAborted();
      await serial(async () => {
        context.signal.throwIfAborted();
        let match = await read(id);
        if (match && !['paused', 'ended'].includes(match.status) && match.runId !== context.runId)
          throw new Error('game-already-running');
        if (
          match?.runId === context.runId &&
          (match.operations.includes(context.executionId) || match.status === 'ended')
        )
          return;
        if (!match || match.status === 'ended') {
          match = {
            matchId: randomUUID(),
            roundId: '',
            roundNumber: 0,
            revision: 0,
            runId: context.runId,
            scores: { human: 0, model: 0, draw: 0 },
            operations: [],
          };
          newRound(match);
        } else if (match.status === 'paused') {
          match.runId = context.runId;
          match.status = match.pausedPhase;
          match.reason = match.winner
            ? match.winner === 'draw'
              ? 'board-full'
              : match.winningLine.length
                ? 'five-in-row'
                : 'resigned'
            : null;
          match.operations = [];
        } else if (!['round-over', 'waiting-replay'].includes(match.status))
          throw new Error('game-already-running');
        if (match.status === 'round-over') {
          if (match.replayRequested) newRound(match);
          else match.status = 'waiting-replay';
        }
        match.operations.push(context.executionId);
        await write(id, match);
      });
      return wait(context);
    },
    async modelMove(input, context) {
      const id = key(context);
      context.signal.throwIfAborted();
      await serial(async () => {
        context.signal.throwIfAborted();
        const match = await read(id);
        assertRun(match, context);
        if (match.status === 'ended' || match.operations.includes(context.executionId)) return;
        if (input.roundId !== match.roundId || input.revision !== match.revision)
          throw new Error('stale-round: use current roundId and revision');
        place(match, 'model', input.row, input.column);
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
          if (match.status === 'ended') throw new Error('game-ended');
          if (
            match.status !== 'paused' &&
            match.status !== 'waiting-replay' &&
            !(match.status === 'active' && match.turn === 'human')
          )
            throw new Error('wait-for-human-turn');
          match.status = 'ended';
          match.turn = null;
          match.reason = 'user-ended';
        } else if (payload.action === 'replay') {
          if (match.status === 'round-over' && !match.replayRequested) match.replayRequested = true;
          else if (match.status === 'waiting-replay') newRound(match);
          else throw new Error('not-waiting-for-replay');
        } else if (payload.action === 'resign') {
          if (match.status !== 'active') throw new Error('game-not-active');
          if (match.turn !== 'human') throw new Error('wait-for-human-turn');
          match.status = 'round-over';
          match.turn = null;
          match.winner = 'model';
          match.winningLine = [];
          match.reason = 'resigned';
          match.scores.model++;
        } else if (payload.action === 'move') place(match, 'human', payload.row, payload.column);
        else throw new Error('invalid-game-action');
        return write(id, match);
      });
    },
    async policy(context) {
      return serial(async () => {
        const match = await read(key(context));
        if (!match || match.runId !== context.runId || match.status === 'paused') return null;
        const state = JSON.stringify(toolState(match));
        if (match.status === 'ended')
          return {
            revision: String(match.revision),
            required: false,
            toolIds: [],
            instruction: `用户手动结束了五子棋，保留已结算比分，未完成的本局不计输赢。状态：${state}。简短回应并结束，不得重新开局。`,
          };
        if (match.status === 'round-over')
          return {
            revision: String(match.revision),
            required: true,
            toolIds: ['start'],
            instruction: `五子棋本局已结束，后台判定结果：${state}。先按当前角色口吻用一句话宣布结果，无需长篇复盘。${match.replayRequested ? '用户已选择再来一局，调用 start 开始下一局。' : '界面已显示再来一局和下次再玩，调用 start 等待用户选择，不要再次询问或替用户决定。'}`,
          };
        if (match.status === 'active' && match.turn === 'model')
          return {
            revision: String(match.revision),
            required: true,
            toolIds: ['place_stone'],
            instruction: `轮到你下五子棋。15×15，无禁手；黑棋先行，横竖斜连续5子或以上获胜。列A..O从左到右，行1..15从上到下；X=黑棋，O=白棋，.=空点。你执${match.black === 'model' ? '黑(X)' : '白(O)'}，只可选择空点。以以下完整最新棋盘为准，不依赖旧对话猜测，不替用户落子，也不自行宣判胜负。用 place_stone 传入当前 roundId、revision、row、column。可先简短说一句陪玩的话。
状态：${state}
棋盘：\n${textBoard(match)}`,
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as tick } from 'node:timers/promises';
import { createGame, migrations } from '../src/game.mjs';
import { place, textBoard, COLUMNS } from '../src/rules.mjs';

const scope = { mode: 'chat', sessionId: 'test-session' };
const call = (executionId, signal = new AbortController().signal, runId = 'run') => ({
  ...scope,
  executionId,
  signal,
  runId,
});
const input = (state, row, column) => ({
  roundId: state.roundId,
  revision: state.revision,
  row,
  column,
});
const action = (state, type, row, column) => ({
  ...scope,
  ...input(state, row, column),
  matchId: state.matchId,
  action: type,
});
const empty = () => ({
  moves: [],
  black: 'human',
  turn: 'human',
  status: 'active',
  winner: null,
  scores: { human: 0, model: 0, draw: 0 },
  winningLine: [],
});
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migrations[0].sql);
  const db = {
    get: async (sql, values = []) => sqlite.prepare(sql).get(...values),
    all: async (sql, values = []) => sqlite.prepare(sql).all(...values),
    run: async (sql, values = []) => sqlite.prepare(sql).run(...values),
  };
  return { sqlite, db };
}
async function until(game, predicate) {
  for (let i = 0; i < 300; i++) {
    const state = await game.load(scope);
    if (state && predicate(state)) return state;
    await tick();
  }
  throw new Error('state-timeout');
}

test('四个方向、棋盘边缘、六连及空隙判定由规则层决定', () => {
  for (const [row, col, dy, dx] of [
    [1, 0, 0, 1],
    [1, 14, 1, 0],
    [11, 10, 1, 1],
    [11, 4, 1, -1],
  ]) {
    const state = empty();
    for (let i = 0; i < 4; i++)
      state.moves.push({ row: row + dy * i, column: COLUMNS[col + dx * i], player: 'human' });
    place(state, 'human', row + dy * 4, COLUMNS[col + dx * 4]);
    assert.equal(state.winner, 'human');
    assert.equal(state.winningLine.length, 5);
    assert.equal(state.scores.human, 1);
    assert.throws(() => place(state, 'human', 8, 'H'), /not-your-turn/);
    assert.equal(state.scores.human, 1);
  }
  const overline = empty();
  for (const column of ['A', 'B', 'C', 'E', 'F'])
    overline.moves.push({ row: 8, column, player: 'human' });
  place(overline, 'human', 8, 'D');
  assert.equal(overline.winningLine.length, 6);
  const gap = empty();
  for (const column of ['A', 'B', 'E', 'F']) gap.moves.push({ row: 8, column, player: 'human' });
  place(gap, 'human', 8, 'C');
  assert.equal(gap.status, 'active');
});

test('满盘和棋、坐标编码与完整模型棋盘一致，非法点不写入', () => {
  const state = empty();
  for (let row = 1; row <= 15; row++)
    for (let col = 0; col < 15; col++) {
      if (row === 15 && col === 0) continue;
      state.moves.push({
        row,
        column: COLUMNS[col],
        player: (Math.floor(col / 2) + row - 1) % 2 ? 'model' : 'human',
      });
    }
  const before = JSON.stringify(state);
  for (const [row, col] of [
    [0, 'A'],
    [16, 'A'],
    [1, 'P'],
    [1, 'a'],
    [1.5, 'H'],
    [1, 'A'],
  ])
    assert.throws(() => place(state, 'human', row, col));
  assert.equal(JSON.stringify(state), before);
  place(state, 'human', 15, 'A');
  assert.equal(state.winner, 'draw');
  assert.equal(state.scores.draw, 1);
  const board = textBoard(state).split('\n');
  assert.equal(board.length, 16);
  assert.match(board[0], /A B C D E F G H I J K L M N O/);
  assert.match(board[15], /^15 X X O O/);
});

test('模型思考和回应结果期间不能认输或退出，等待用户时才可结束', async () => {
  const { sqlite, db } = fixture();
  const game = await createGame(db, { first: () => 'model' });
  try {
    await game.start({}, call('start'));
    let state = await game.load(scope);
    for (const type of ['resign', 'quit'])
      await assert.rejects(game.act(action(state, type)), /wait-for-human-turn/);
    assert.deepEqual(await game.load(scope), state, '禁用操作不改变模型正在使用的局面或版本');
    const moving = game.modelMove(input(state, 8, 'H'), call('move'));
    state = await until(game, (state) => state.turn === 'human');
    state = await game.act(action(state, 'resign'));
    await moving;
    await assert.rejects(game.act(action(state, 'quit')), /wait-for-human-turn/);
    const waiting = game.start({}, call('result'));
    state = await until(game, (state) => state.status === 'waiting-replay');
    await game.act(action(state, 'quit'));
    assert.equal((await waiting).status, 'ended');
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('双方轮流、去重、用户获胜、等待续局、随机黑白、认输与结束', { timeout: 10000 }, async () => {
  const { sqlite, db } = fixture();
  let round = 0;
  const game = await createGame(db, { first: () => (round++ ? 'model' : 'human') });
  try {
    let returned = false;
    const starting = game.start({}, call('start')).then((value) => {
      returned = true;
      return value;
    });
    let state = await until(game, (state) => state.turn === 'human');
    assert.equal(returned, false, '用户回合不返回工具结果给模型继续生成');
    await game.act(action(state, 'move', 8, 'A'));
    await starting;
    for (let index = 0; index < 4; index++) {
      state = await game.load(scope);
      const policy = await game.policy(call('policy'));
      assert.deepEqual(policy.toolIds, ['place_stone']);
      assert.ok(policy.instruction.includes(textBoard(state)));
      const move = game.modelMove(input(state, 1, COLUMNS[index * 2]), call(`move-${index}`));
      state = await until(game, (state) => state.turn === 'human');
      await game.act(action(state, 'move', 8, COLUMNS[index + 1]));
      await move;
    }
    state = await game.load(scope);
    assert.equal(state.winner, 'human');
    assert.equal(state.scores.human, 1);
    assert.equal(state.winningLine.length, 5);
    await game.modelMove(input(state, 1, 'A'), call('move-3'));
    assert.equal((await game.load(scope)).moves.length, 9, '同一执行标识不重复落子');
    assert.deepEqual((await game.policy(call('policy'))).toolIds, ['start']);
    const replay = game.start({}, call('wait-replay'));
    state = await until(game, (state) => state.status === 'waiting-replay');
    await game.act(action(state, 'replay'));
    await replay;
    state = await game.load(scope);
    assert.equal(state.roundNumber, 2);
    assert.equal(state.black, 'model');
    assert.equal(state.moves.length, 0);
    const nextMove = game.modelMove(input(state, 8, 'H'), call('next-round-move'));
    state = await until(game, (state) => state.turn === 'human');
    await game.act(action(state, 'resign'));
    await nextMove;
    state = await game.load(scope);
    assert.deepEqual(state.scores, { human: 1, model: 1, draw: 0 });
    const ending = game.start({}, call('ending'));
    state = await until(game, (state) => state.status === 'waiting-replay');
    await game.act(action(state, 'quit'));
    assert.equal((await ending).status, 'ended');
    assert.equal((await game.policy(call('policy'))).required, false);
    assert.equal(
      (await game.start({}, call('late-start'))).status,
      'ended',
      '同一运行结束后不能擅自重开',
    );
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('局末可提前保存续局选择，续局选择只消费一次', async () => {
  const { sqlite, db } = fixture();
  let round = 0;
  const game = await createGame(db, { first: () => (round++ ? 'model' : 'human') });
  try {
    const starting = game.start({}, call('start'));
    let state = await until(game, (state) => state.turn === 'human');
    state = await game.act(action(state, 'resign'));
    await starting;
    const beforeChoice = state;
    state = await game.act(action(state, 'replay'));
    assert.equal(state.status, 'round-over');
    assert.equal(state.roundId, beforeChoice.roundId, '保留本局结果直到模型回应');
    assert.equal(state.replayRequested, true);
    assert.deepEqual(state.scores, { human: 0, model: 1, draw: 0 });
    assert.match((await game.policy(call('policy'))).instruction, /用户已选择再来一局/);
    await assert.rejects(game.act(action(state, 'replay')), /not-waiting-for-replay/);
    await game.start({}, call('accept-replay'));
    state = await game.load(scope);
    assert.equal(state.roundNumber, 2);
    assert.notEqual(state.roundId, beforeChoice.roundId);
    assert.equal(state.replayRequested, undefined);
    await game.start({}, call('accept-replay'));
    assert.equal((await game.load(scope)).roundNumber, 2);
    const nextMove = game.modelMove(input(state, 8, 'H'), call('next-round-move'));
    state = await until(game, (state) => state.turn === 'human');
    state = await game.act(action(state, 'resign'));
    await nextMove;
    const waiting = game.start({}, call('wait-replay'));
    state = await until(game, (state) => state.status === 'waiting-replay');
    await game.act(action(state, 'quit'));
    await waiting;
    assert.equal((await game.start({}, call('late-result'))).status, 'ended');
    assert.equal((await game.load(scope)).roundNumber, 2);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('提前保存的续局选择在重启恢复后仍只开一局', async () => {
  const { sqlite, db } = fixture();
  let game = await createGame(db, { first: () => 'human' });
  try {
    const starting = game.start({}, call('start'));
    let state = await until(game, (state) => state.turn === 'human');
    state = await game.act(action(state, 'resign'));
    await starting;
    await game.act(action(state, 'replay'));
    await game.dispose();
    game = await createGame(db, { first: () => 'model' });
    state = await game.load(scope);
    assert.equal(state.status, 'paused');
    assert.equal(state.replayRequested, true);
    await game.start({}, call('resume', undefined, 'new-run'));
    state = await game.load(scope);
    assert.equal(state.roundNumber, 2);
    assert.equal(state.status, 'active');
    assert.deepEqual(state.scores, { human: 0, model: 1, draw: 0 });
    assert.equal(state.replayRequested, undefined);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('并发点击、过时版本、占位、越界和错误会话不会改变棋盘', { timeout: 10000 }, async () => {
  const { sqlite, db } = fixture();
  const game = await createGame(db, { first: () => 'model' });
  try {
    let state = await game.start({}, call('start'));
    await assert.rejects(game.act(action(state, 'move', 8, 'H')), /not-your-turn/);
    await assert.rejects(game.modelMove(input(state, 0, 'H'), call('bad')), /invalid-coordinate/);
    await assert.rejects(
      game.modelMove({ ...input(state, 8, 'H'), revision: state.revision + 1 }, call('stale')),
      /stale-round/,
    );
    const moving = game.modelMove(input(state, 8, 'H'), call('model'));
    state = await until(game, (state) => state.turn === 'human');
    const attempts = await Promise.allSettled([
      game.act(action(state, 'move', 7, 'H')),
      game.act(action(state, 'move', 7, 'I')),
    ]);
    assert.equal(attempts.filter((value) => value.status === 'fulfilled').length, 1);
    await moving;
    state = await game.load(scope);
    await assert.rejects(game.modelMove(input(state, 8, 'H'), call('occupied')), /cell-occupied/);
    await assert.rejects(
      game.modelMove(input(state, 5, 'H'), call('wrong-run', undefined, 'other-run')),
      /stale-game-run/,
    );
    await assert.rejects(game.load({ ...scope, mode: 'work' }), /invalid-game-scope/);
    assert.equal(await game.load({ ...scope, sessionId: 'other' }), null);
    assert.equal((await game.load(scope)).moves.length, 2);
    const nextMove = game.modelMove(input(state, 1, 'O'), call('next-move'));
    state = await until(game, (state) => state.turn === 'human');
    await game.act(action(state, 'quit'));
    await nextMove;
    assert.equal((await game.modelMove(input(state, 5, 'H'), call('late'))).status, 'ended');
    assert.equal((await game.load(scope)).moves.length, 3);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('模型五连胜由后台结算', { timeout: 10000 }, async () => {
  const { sqlite, db } = fixture();
  const game = await createGame(db, { first: () => 'model' });
  try {
    await game.start({}, call('start'));
    for (let index = 0; index < 5; index++) {
      const state = await game.load(scope);
      const move = game.modelMove(input(state, index + 1, 'O'), call(`move-${index}`));
      if (index < 4) {
        const human = await until(game, (state) => state.turn === 'human');
        await game.act(action(human, 'move', 15, COLUMNS[index * 2]));
      }
      await move;
    }
    const state = await game.load(scope);
    assert.equal(state.winner, 'model');
    assert.equal(state.scores.model, 1);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('取消和进程重启保留同一棋盘，显式恢复后继续等待用户', { timeout: 10000 }, async () => {
  const { sqlite, db } = fixture();
  let game = await createGame(db, { first: () => 'model' });
  try {
    let state = await game.start({}, call('start'));
    const roundId = state.roundId;
    const controller = new AbortController();
    const waiting = game.modelMove(input(state, 8, 'H'), call('move', controller.signal));
    const rejected = assert.rejects(waiting);
    await until(game, (state) => state.turn === 'human');
    controller.abort();
    await rejected;
    // Simulate process loss before finished(): initialization must pause the saved active match.
    await game.dispose();
    game = await createGame(db, {
      first: () => {
        throw new Error('must not redraw');
      },
    });
    state = await game.load(scope);
    assert.equal(state.status, 'paused');
    assert.equal(state.roundId, roundId);
    assert.deepEqual(state.moves, [{ row: 8, column: 'H', player: 'model' }]);
    const resumed = game.start({}, call('resume', undefined, 'run2'));
    state = await until(game, (state) => state.status === 'active');
    assert.equal(state.turn, 'human');
    await game.act(action(state, 'move', 9, 'H'));
    await resumed;
    await game.finished(call('finish', undefined, 'run2'));
    assert.equal((await game.load(scope)).status, 'paused');
    assert.equal((await game.load(scope)).moves.length, 2);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('数据库写入失败不发布动作；已提交但响应丢失后重试不会多落子', { timeout: 10000 }, async () => {
  const { sqlite, db } = fixture();
  let fail = false,
    loseReply = false;
  const game = await createGame(
    {
      ...db,
      run: async (...args) => {
        if (fail) throw new Error('disk-failure');
        const result = await db.run(...args);
        if (loseReply) {
          loseReply = false;
          throw new Error('lost-reply');
        }
        return result;
      },
    },
    { first: () => 'model' },
  );
  try {
    let state = await game.start({}, call('start'));
    fail = true;
    await assert.rejects(game.modelMove(input(state, 8, 'H'), call('move')), /disk-failure/);
    assert.equal((await game.load(scope)).moves.length, 0);
    fail = false;
    loseReply = true;
    await assert.rejects(game.modelMove(input(state, 8, 'H'), call('move')), /lost-reply/);
    assert.equal((await game.load(scope)).moves.length, 1);
    const retry = game.modelMove(input(state, 8, 'H'), call('move'));
    state = await game.load(scope);
    await game.act(action(state, 'move', 7, 'H'));
    await retry;
    assert.equal((await game.load(scope)).moves.length, 2);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('用户落子已提交但响应丢失时，模型等待仍被唤醒并读取事实状态', { timeout: 10000 }, async () => {
  const { sqlite, db } = fixture();
  let loseReply = false;
  const game = await createGame(
    {
      ...db,
      run: async (...args) => {
        const result = await db.run(...args);
        if (loseReply) {
          loseReply = false;
          throw new Error('lost-human-reply');
        }
        return result;
      },
    },
    { first: () => 'model' },
  );
  try {
    let state = await game.start({}, call('start'));
    const waiting = game.modelMove(input(state, 8, 'H'), call('move'));
    state = await until(game, (state) => state.turn === 'human');
    loseReply = true;
    await assert.rejects(game.act(action(state, 'move', 9, 'H')), /lost-human-reply/);
    assert.equal((await waiting).moveCount, 2);
    assert.equal((await game.load(scope)).turn, 'model');
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as tick } from 'node:timers/promises';
import { createCompanionGame, duoMigration } from '../src/duo.mjs';
const scope = { mode: 'chat', sessionId: 'session' };
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(duoMigration.sql);
  return {
    sqlite,
    db: {
      get: async (sql, values = []) => sqlite.prepare(sql).get(...values),
      all: async (sql, values = []) => sqlite.prepare(sql).all(...values),
      run: async (sql, values = []) => sqlite.prepare(sql).run(...values),
    },
  };
}
async function until(game, check) {
  for (let i = 0; i < 200; i++) {
    const state = await game.load(scope);
    if (state && check(state)) return state;
    await tick();
  }
  throw new Error('state-timeout');
}
function action(state, choice, tooth) {
  return {
    ...scope,
    matchId: state.matchId,
    roundId: state.roundId,
    revision: state.revision,
    action: choice,
    tooth,
  };
}
function call(id, signal = new AbortController().signal, runId = 'run') {
  return { ...scope, runId, executionId: id, signal };
}
function move(state, tooth) {
  return { roundId: state.roundId, revision: state.revision, tooth };
}

test('双人轮流等待、双方结算、续局随机先手、比分与退出通知', async () => {
  const { sqlite, db } = fixture();
  let count = 0;
  const game = await createCompanionGame(db, {
    draw: () => (count ? 4 : 3),
    first: () => (count++ ? 'model' : 'human'),
  });
  try {
    let returned = false;
    const started = game.start({}, call('start')).then((v) => {
      returned = true;
      return v;
    });
    let state = await until(game, (s) => s.turn === 'human');
    await tick();
    assert.equal(returned, false);
    assert.ok(!JSON.stringify(state).includes('trap'));
    assert.ok(!('operations' in state));
    const attempts = await Promise.allSettled([
      game.act(action(state, 'press', 1)),
      game.act(action(state, 'press', 2)),
    ]);
    assert.equal(attempts.filter((v) => v.status === 'fulfilled').length, 1);
    state = await started;
    assert.equal(state.turn, 'model');
    assert.deepEqual(state.remaining, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual((await game.policy(call('policy'))).toolIds, ['press_tooth']);
    const modelMove = game.modelPress(move(state, 2), call('press-1'));
    state = await until(game, (s) => s.turn === 'human' && s.pressed.length === 2);
    await game.act(action(state, 'press', 3));
    state = await modelMove;
    assert.equal(state.status, 'round-over');
    assert.equal(state.winner, 'model');
    assert.deepEqual(state.scores, { human: 0, model: 1 });
    const repeated = await game.modelPress(move(state, 2), call('press-1'));
    assert.deepEqual(repeated.scores, state.scores);
    assert.deepEqual((await game.policy(call('policy'))).toolIds, ['start']);
    const waiting = game.start({}, call('replay-wait'));
    state = await until(game, (s) => s.status === 'waiting-replay');
    await game.act(action(state, 'replay'));
    state = await waiting;
    assert.equal(state.roundNumber, 2);
    assert.equal(state.turn, 'model');
    assert.deepEqual(state.scores, { human: 0, model: 1 });
    state = await game.modelPress(move(state, 4), call('press-2'));
    assert.equal(state.winner, 'human');
    assert.deepEqual(state.scores, { human: 1, model: 1 });
    const ending = game.start({}, call('quit-wait'));
    state = await until(game, (s) => s.status === 'waiting-replay');
    await game.act(action(state, 'quit'));
    state = await ending;
    assert.equal(state.reason, 'user-ended');
    assert.equal(state.status, 'ended');
    const policy = await game.policy(call('policy'));
    assert.equal(policy.required, false);
    assert.deepEqual(policy.toolIds, []);
    assert.match(policy.instruction, /用户手动选择了结束/);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('取消与重启保留危险牙和比分，显式恢复不重复落子，隔离会话', async () => {
  const { sqlite, db } = fixture();
  let game = await createCompanionGame(db, { draw: () => 7, first: () => 'model' });
  try {
    let state = await game.start({}, call('start'));
    const roundId = state.roundId;
    assert.equal(await game.load({ ...scope, sessionId: 'other' }), null);
    await assert.rejects(game.load({ ...scope, mode: 'work' }), /invalid-game-scope/);
    const controller = new AbortController();
    const moving = game.modelPress(move(state, 1), call('move', controller.signal));
    const rejected = assert.rejects(moving);
    await until(game, (s) => s.turn === 'human');
    controller.abort();
    await rejected;
    await game.finished(call('done'));
    state = await game.load(scope);
    assert.equal(state.status, 'paused');
    await game.dispose();
    game = await createCompanionGame(db, { draw: () => 12, first: () => 'model' });
    const resume = game.start({}, call('resume', new AbortController().signal, 'run2'));
    state = await until(game, (s) => s.status === 'active');
    assert.equal(state.roundId, roundId);
    assert.deepEqual(state.pressed, [{ tooth: 1, player: 'model' }]);
    await game.act(action(state, 'press', 7));
    state = await resume;
    assert.equal(state.winner, 'model');
    assert.deepEqual(state.scores, { human: 0, model: 1 });
    await assert.rejects(game.modelPress(move(state, 2), call('old')), /stale-game-run/);
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

test('模型思考中提前结束、过时操作和错误输入不会推进棋局', async () => {
  const { sqlite, db } = fixture();
  const game = await createCompanionGame(db, { draw: () => 9, first: () => 'model' });
  try {
    const state = await game.start({}, call('start'));
    await assert.rejects(game.act(action(state, 'press', 1)), /not-your-turn/);
    await assert.rejects(game.modelPress(move(state, 13), call('bad')), /invalid-tooth/);
    await game.act(action(state, 'quit'));
    const ended = await game.modelPress(move(state, 1), call('late'));
    assert.equal(ended.status, 'ended');
    assert.deepEqual(ended.pressed, []);
    await assert.rejects(game.act(action(state, 'replay')), /stale-round/);
    assert.deepEqual(ended.scores, { human: 0, model: 0 });
  } finally {
    await game.dispose();
    sqlite.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosition } from '../src/engine-search.mjs';
import { createEngine } from '../src/engine.mjs';

const stone = (row, column, player) => ({ row, column, player });
test('普通和困难分析提供三个合法、有限评分的候选，不修改棋谱', () => {
  const moves = [stone(8, 'H', 'human'), stone(7, 'H', 'model'), stone(9, 'I', 'human')];
  const before = structuredClone(moves);
  for (const difficulty of ['normal', 'hard']) {
    const result = analyzePosition(moves, difficulty);
    assert.equal(result.candidates.length, 3);
    assert.equal(new Set(result.candidates.map((p) => p.column + p.row)).size, 3);
    assert.equal(result.depth, difficulty === 'hard' ? 4 : 2);
    for (const point of result.candidates) {
      assert.ok(Number.isFinite(point.score));
      assert.ok(!moves.some((p) => p.row === point.row && p.column === point.column));
    }
    assert.ok(result.candidates.every((p, i, all) => !i || all[i - 1].score >= p.score));
  }
  assert.deepEqual(moves, before);
});

test('评分从模型视角识别直接成五及唯一必须防守的位置', () => {
  for (const player of ['model', 'human']) {
    const moves = ['A', 'B', 'C', 'D'].map((c) => stone(8, c, player));
    moves.push(stone(2, 'L', player === 'model' ? 'human' : 'model'));
    const result = analyzePosition(moves, 'hard');
    assert.equal(result.candidates[0].column, 'E');
    assert.equal(result.candidates[0].row, 8);
    if (player === 'model') assert.equal(result.candidates[0].assessment, 'winning-line');
    else assert.ok(result.candidates[0].score > result.candidates[1].score);
  }
});

test('独立线程缓存同一版本，超时或取消安全降级', async () => {
  const match = {
    moves: [],
    settings: { difficulty: 'hard' },
    roundId: 'round',
    revision: 1,
    runId: 'run',
  };
  const engine = createEngine();
  try {
    const promise = engine.analyze(match);
    assert.equal(engine.analyze(match), promise);
    const result = await promise;
    assert.equal(result.candidates.length, 3);
    assert.ok(Number.isFinite(result.candidates[0].score));
    const next = engine.analyze({ ...match, revision: 2 });
    engine.cancel(match.runId);
    assert.equal(await next, null);
  } finally {
    engine.dispose();
  }
  const timed = createEngine({ timeoutMs: 1 });
  assert.equal(await timed.analyze(match), null);
  timed.dispose();
  assert.equal(await timed.analyze(match), null);
});

test('时间预算耗尽保留最后一次已完成的分析，线程失败不阻断模型回合', async () => {
  const match = {
    moves: [],
    settings: { difficulty: 'hard' },
    roundId: 'round',
    revision: 1,
    runId: 'run',
  };
  const partial = { depth: 1, candidates: [{ row: 8, column: 'H', score: 12 }] };
  const workerUrl = new URL(
    'data:text/javascript,' +
      encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({analysis: ${JSON.stringify(partial)}});
    setInterval(() => {}, 1000);
  `),
  );
  const engine = createEngine({ timeoutMs: 500, workerUrl });
  try {
    assert.deepEqual(await engine.analyze(match), { ...partial, limited: true });
  } finally {
    engine.dispose();
  }
  const broken = createEngine({
    workerUrl: new URL('data:text/javascript,throw new Error("broken")'),
  });
  assert.equal(await broken.analyze(match), null);
  broken.dispose();
});

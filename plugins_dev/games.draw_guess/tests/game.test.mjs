import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createGame, migrations } from '../src/game.mjs';
const scope = { sessionId: 'test', mode: 'chat' };
const words = [
  '苹果',
  '雨伞',
  '小猫',
  '帽子',
  '太阳',
  '月亮',
  '汽车',
  '气球',
  '小狗',
  '香蕉',
  '冰箱',
  '西瓜',
].map((word) => ({ word, aliases: [] }));
const shape = {
  id: 'shape',
  kind: 'ellipse',
  x: 100,
  y: 100,
  width: 100,
  height: 80,
  points: [],
  color: '#222222',
  fill: 'transparent',
  strokeWidth: 4,
};
const image = { dataUrl: 'data:image/png;base64,AAAA', width: 800, height: 600 };
async function until(callback) {
  for (let i = 0; i < 200; i++) {
    const value = await callback();
    if (value) return value;
    await delay(10);
  }
  throw new Error('condition timed out');
}
async function fixture(t, request, options = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(migrations[0].sql);
  const db = {
    get: async (q, p = []) => sql.prepare(q).get(...p),
    all: async (q, p = []) => sql.prepare(q).all(...p),
    run: async (q, p = []) => sql.prepare(q).run(...p),
    transaction: async (entries) => {
      sql.exec('BEGIN');
      try {
        const results = entries.map((entry) => sql.prepare(entry.sql).run(...entry.params));
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  let game = await createGame(db, { validateCanvas: structuredClone, ...options });
  const controller = new AbortController();
  const calls = [];
  const model = {
    imageInputSupported: true,
    async request(input, signal) {
      calls.push(input);
      return { value: await request(input, signal), usage: [] };
    },
  };
  const context = {
    ...scope,
    runId: 'run',
    executionId: 'play',
    signal: controller.signal,
    privateModel: model,
  };
  let work;
  t.after(async () => {
    controller.abort();
    if (work) await work;
    await game.dispose();
    sql.close();
  });
  return {
    get game() {
      return game;
    },
    db,
    sql,
    calls,
    controller,
    start() {
      work = game.play({}, context);
      return work;
    },
    async reload() {
      controller.abort();
      if (work) await work;
      await game.dispose();
      game = await createGame(db, { validateCanvas: structuredClone, ...options });
    },
    state: () => game.load(scope),
    phase: (phase) =>
      until(async () => {
        const state = await game.load(scope);
        return state?.phase === phase && state;
      }),
    async act(action, extra = {}) {
      const state = await game.load(scope);
      return game.action({ ...scope, roundId: state.id, epoch: state.epoch, action, ...extra });
    },
  };
}
test('词库三选一只给画家，边画边猜，整组消耗，轮换不带旧秘密', async (t) => {
  let selected;
  const longerWords = ['自行车', '救护车', '向日葵', '长颈鹿', '洗衣机', '仙人掌'].map((word) => ({
    word,
    aliases: [],
  }));
  const f = await fixture(t, async (input) => {
    if (input.outputSchema.properties.words) {
      assert.equal(input.inheritCharacter, false);
      return { words: longerWords };
    }
    if (input.outputSchema.properties.choice) return { choice: 1 };
    assert.ok(input.image);
    assert.ok(!input.prompt.includes('私密题目'));
    assert.match(input.prompt, /标准题目共3个字/);
    assert.ok(longerWords.every(({ word }) => !input.prompt.includes(word)));
    return { guess: selected };
  });
  const playing = f.start();
  const choosing = await f.phase('choosing');
  assert.equal(choosing.choices.length, 3);
  assert.equal(choosing.word, null);
  assert.equal(choosing.characterCount, null);
  assert.ok(!('pool' in choosing));
  selected = choosing.choices[0];
  await f.act('choose', { choice: 0 });
  assert.equal((await f.state()).word, selected);
  const state = await f.state();
  assert.equal(state.phase, 'drawing');
  assert.equal(state.characterCount, 3);
  assert.ok(state.deadline > Date.now());
  await assert.rejects(f.act('choose', { choice: 1 }), /invalid-action/);
  await f.act('draw', { scene: { version: 1, shapes: [shape] }, revision: state.canvasRevision });
  await f.act('snapshot', { image, revision: 1 });
  const result = await f.phase('result');
  assert.equal(result.result, 'guessed');
  assert.equal((await f.game.history({}, scope)).rounds[0].answer, selected);
  await f.act('next');
  const ready = await f.phase('ready');
  assert.equal(ready.painter, 'model');
  assert.deepEqual(ready.choices, []);
  assert.equal(ready.word, null);
  assert.equal(ready.characterCount, 3);
  const stored = JSON.parse(f.sql.prepare('SELECT state FROM games').get().state);
  assert.ok(stored.choices.every((choice) => !choosing.choices.includes(choice.word)));
  assert.ok(f.calls.every((call) => !('messages' in call)));
  await f.act('quit');
  assert.equal((await playing).status, 'ended');
});
test('角色先画时只公开画面，用户猜中立即结束，迟到绘画不会污染结果', async (t) => {
  let release;
  let draws = 0;
  const f = await fixture(t, async (input) => {
    if (input.outputSchema.properties.words) return { words };
    if (input.outputSchema.properties.choice) return { choice: 1 };
    draws++;
    if (draws === 2)
      await new Promise((resolve) => {
        release = resolve;
      });
    return { add: [{ ...shape, id: undefined }], remove: [], done: false };
  });
  await f.game.saveSettings({ duration: 300, firstPainter: 'model' });
  f.start();
  await f.phase('ready');
  await f.act('snapshot', { image, revision: 0 });
  const drawing = await f.phase('drawing');
  assert.equal(drawing.word, null);
  assert.equal(drawing.scene.shapes.length, 1);
  await f.act('snapshot', { image, revision: drawing.canvasRevision });
  await until(() => release);
  const secret = JSON.parse(f.sql.prepare('SELECT state FROM games').get().state).answer.word;
  await f.act('guess', { text: secret });
  const result = await f.state();
  assert.equal(result.result, 'guessed');
  release();
  await until(
    () =>
      f.sql.prepare("SELECT count(*) AS n FROM requests WHERE status='discarded'").get().n === 1,
  );
  assert.deepEqual((await f.state()).scene, result.scene);
});
test('模型请求在途时可继续绘画，暂停保留画作，重启不重发请求', async (t) => {
  let waiting;
  const f = await fixture(t, async (input, signal) => {
    if (input.outputSchema.properties.words) return { words };
    waiting = true;
    await new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true }),
    );
  });
  const playing = f.start();
  await f.phase('choosing');
  await f.act('choose', { choice: 0 });
  await f.act('draw', { scene: { version: 1, shapes: [shape] }, revision: 0 });
  await f.act('snapshot', { image, revision: 1 });
  await until(() => waiting);
  await f.act('draw', {
    scene: { version: 1, shapes: [shape, { ...shape, id: 'second' }] },
    revision: 1,
  });
  await f.act('pause');
  await playing;
  const before = await f.state();
  const count = f.calls.length;
  await f.reload();
  assert.equal(f.calls.length, count);
  assert.deepEqual((await f.state()).scene, before.scene);
  assert.equal((await f.state()).phase, 'paused');
});
test('后台倒计时终止在途请求，按钮无需等待模型，重复画面写入被拒绝', async (t) => {
  let clock = Date.now(),
    waiting;
  const f = await fixture(
    t,
    async (input, signal) => {
      if (input.outputSchema.properties.words) return { words };
      waiting = true;
      await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true }),
      );
    },
    { now: () => clock },
  );
  f.start();
  await f.phase('choosing');
  await f.act('choose', { choice: 0 });
  await f.act('draw', { scene: { version: 1, shapes: [shape] }, revision: 0 });
  await assert.rejects(
    f.act('draw', { scene: { version: 1, shapes: [] }, revision: 0 }),
    /stale-canvas/,
  );
  await f.act('snapshot', { image, revision: 1 });
  await until(() => waiting);
  const stored = JSON.parse(f.sql.prepare('SELECT state FROM games').get().state);
  stored.deadline = clock + 100;
  f.sql.prepare('UPDATE games SET state=?').run(JSON.stringify(stored));
  clock += 200;
  assert.equal((await f.phase('result')).result, 'timeout');
  await f.act('next');
  assert.equal((await f.state()).round, 2);
});
test('缺少图片能力不开局，词库失败保存暂停状态，不提供自命题', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('offline');
  });
  assert.equal(
    (await f.game.play({}, { ...scope, privateModel: { imageInputSupported: false } })).status,
    'unavailable',
  );
  assert.equal(await f.state(), null);
  const work = f.start();
  const state = await f.phase('paused');
  assert.equal(state.error, 'model-request-failed');
  await work;
  assert.equal(f.sql.prepare('SELECT status FROM requests').get().status, 'failed');
  await assert.rejects(f.act('choose', { choice: '自命题' }));
});

test('非法绘画不修改画板，反馈后可纠正，界面失联停止调度', async (t) => {
  let clock = Date.now(),
    draws = 0;
  const f = await fixture(
    t,
    async (input) => {
      if (input.outputSchema.properties.words) return { words };
      if (input.outputSchema.properties.choice) return { choice: 1 };
      draws++;
      if (draws === 1) return { add: [], remove: ['invented-id'], done: false };
      assert.match(input.prompt, /上一批操作未执行/);
      return { add: [{ ...shape, id: undefined }], remove: [], done: true };
    },
    { now: () => clock },
  );
  await f.game.saveSettings({ duration: 300, firstPainter: 'model' });
  const work = f.start();
  await f.phase('ready');
  await f.act('snapshot', { image, revision: 0 });
  const drawing = await f.phase('drawing');
  assert.equal(drawing.scene.shapes.length, 1);
  assert.equal(draws, 2);
  clock += 6000;
  await until(
    () => JSON.parse(f.sql.prepare('SELECT state FROM games').get().state).phase === 'paused',
  );
  assert.equal((await f.state()).error, 'viewer-disconnected');
  await work;
});

test('旧版已选题的准备存档继续后直接绘画并保留剩余时间', async (t) => {
  const f = await fixture(t, async () => ({ words }));
  const work = f.start();
  await f.phase('choosing');
  await f.act('choose', { choice: 0 });
  await f.act('pause');
  await work;
  const stored = JSON.parse(f.sql.prepare('SELECT state FROM games').get().state);
  stored.pausedPhase = 'ready';
  stored.remaining = 123000;
  f.sql.prepare('UPDATE games SET state=?').run(JSON.stringify(stored));
  const resumed = f.start();
  const state = await f.phase('drawing');
  assert.equal(state.word, stored.answer.word);
  assert.ok(state.deadline > Date.now() + 120000);
  assert.ok(state.deadline <= Date.now() + 123000);
  await f.act('quit');
  await resumed;
});

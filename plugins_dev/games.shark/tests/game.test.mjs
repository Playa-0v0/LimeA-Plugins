import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameStore } from '../src/backend.mjs';
import { DatabaseSync } from 'node:sqlite';

// 这里验证游戏规则；宿主迁移、隔离和旧存档接管在 LimeA 的集成测试中验证。
function storage(directory) {
  return {
    async openDatabase(options) {
      const db = new DatabaseSync(join(directory, options.name + '.sqlite'));
      db.exec('CREATE TABLE IF NOT EXISTS test_migrations (id TEXT PRIMARY KEY)');
      for (const migration of options.migrations) {
        if (!db.prepare('SELECT id FROM test_migrations WHERE id=?').get(migration.id)) {
          db.exec(migration.sql);
          db.prepare('INSERT INTO test_migrations VALUES (?)').run(migration.id);
        }
      }
      return {
        async get(sql, params = []) {
          return db.prepare(sql).get(...params) ?? null;
        },
        async run(sql, params = []) {
          return db.prepare(sql).run(...params);
        },
        async close() {
          db.close();
        },
      };
    },
  };
}

test('对局重启恢复固定坏牙，重复按牙幂等，会话与草稿独立', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'limea-shark-test-'));
  let store = await createGameStore(storage(directory), () => 3);
  try {
    const a = { mode: 'chat', sessionId: 'a' },
      b = { mode: 'chat', sessionId: 'b' };
    const round = await store.load(a);
    assert.equal('trap' in round, false);
    assert.notEqual((await store.load(b)).id, round.id);
    assert.notEqual((await store.load({ ...a, sessionId: null })).id, round.id);
    await store.press({ ...a, roundId: round.id, tooth: 1 });
    assert.deepEqual((await store.press({ ...a, roundId: round.id, tooth: 1 })).pressed, [1]);
    await store.dispose();
    store = await createGameStore(storage(directory), () => 12);
    assert.deepEqual((await store.load(a)).pressed, [1]);
    assert.equal((await store.load(a)).id, round.id);
    assert.equal((await store.press({ ...a, roundId: round.id, tooth: 3 })).status, 'bitten');
    assert.deepEqual((await store.press({ ...a, roundId: round.id, tooth: 2 })).pressed, [1, 3]);
    assert.deepEqual((await store.load(b)).pressed, []);
    const next = await store.restart({ ...a, roundId: round.id });
    assert.notEqual(next.id, round.id);
    assert.deepEqual(next.pressed, []);
    await assert.rejects(() => store.press({ ...a, roundId: round.id, tooth: 2 }), /stale-round/);
    await assert.rejects(() => store.press({ ...a, roundId: next.id, tooth: 13 }), /invalid-tooth/);
    await assert.rejects(() => store.load({ ...a, mode: 'work' }), /invalid-game-scope/);
    await Promise.all([1, 2, 4].map((tooth) => store.press({ ...a, roundId: next.id, tooth })));
    assert.deepEqual((await store.load(a)).pressed, [1, 2, 4]);
    assert.equal((await store.press({ ...a, roundId: next.id, tooth: 12 })).status, 'bitten');
  } finally {
    await store.dispose();
    assert.ok(directory.startsWith(join(tmpdir(), 'limea-shark-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});

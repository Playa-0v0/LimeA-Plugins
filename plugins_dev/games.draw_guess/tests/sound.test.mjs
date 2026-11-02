import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createDrawingSound } from '../src/sound.mjs';

function audioEnvironment(t, { deferred = false, saved = null } = {}) {
  const sources = [],
    requests = [],
    store = new Map([['games.draw_guess.audio', saved]]);
  let release;
  const gate = deferred
    ? new Promise((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  class Context {
    state = 'running';
    currentTime = 0;
    destination = {};
    createGain() {
      return {
        gain: {
          value: 1,
          cancelScheduledValues() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
    createBufferSource() {
      const source = {
        started: false,
        stopped: false,
        connect(gain) {
          return gain;
        },
        disconnect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    }
    async decodeAudioData(value) {
      return value;
    }
    async resume() {
      this.state = 'running';
    }
    async suspend() {
      this.state = 'suspended';
    }
    async close() {
      this.state = 'closed';
    }
  }
  for (const [key, value] of Object.entries({
    AudioContext: Context,
    localStorage: {
      getItem: (key) => store.get(key),
      setItem: (key, value) => store.set(key, value),
    },
    fetch: async (url) => {
      requests.push(String(url));
      await gate;
      return { ok: true, arrayBuffer: async () => String(url) };
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  const sound = createDrawingSound('https://plugin.test/package/');
  t.after(() => sound.dispose());
  return { sound, sources, requests, store, release };
}
const flush = () => delay(0);

test('连续移动只播放一条画笔循环，松手或停笔停止', async (t) => {
  const { sound, sources, requests } = audioEnvironment(t);
  sound.unlock();
  await flush();
  for (let i = 0; i < 10; i++) sound.interaction('stroke');
  await flush();
  assert.equal(requests.length, 5);
  assert.ok(requests.every((url) => url.startsWith('https://plugin.test/package/assets/audio/')));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  sound.interaction('stroke-end');
  assert.equal(sources[0].stopped, true);
  sound.interaction('stroke');
  await flush();
  assert.equal(sources.length, 2);
  await delay(130);
  assert.equal(sources[1].stopped, true);
});

test('音量、画笔独立开关和静音持久化，不重放已取消声音', async (t) => {
  const { sound, sources, store } = audioEnvironment(t);
  sound.configure({ pencil: false, volume: 0.2 });
  await flush();
  sound.interaction('stroke');
  sound.interaction('undo');
  await flush();
  assert.equal(sources.length, 1);
  assert.match(sources[0].buffer, /undo.ogg$/);
  sound.configure({ enabled: false });
  assert.equal(sources[0].stopped, true);
  sound.interaction('redo');
  await flush();
  assert.equal(sources.length, 1);
  assert.deepEqual(JSON.parse(store.get('games.draw_guess.audio')), {
    enabled: false,
    pencil: false,
    volume: 0.2,
  });
  const restored = createDrawingSound('https://plugin.test/package/');
  assert.deepEqual(restored.preferences, sound.preferences);
  restored.dispose();
});

test('加载期间松手、隐藏或销毁后，迟到音频不会开始播放', async (t) => {
  const { sound, sources, release } = audioEnvironment(t, { deferred: true });
  sound.interaction('stroke');
  sound.interaction('fill');
  sound.interaction('stroke-end');
  sound.setVisible(false);
  sound.setVisible(true);
  release();
  await flush();
  assert.equal(sources.length, 0);
  sound.interaction('redo');
  sound.dispose();
  await flush();
  assert.equal(sources.length, 0);
});

test('重复操作不会堆积，空操作不发声，音量为零取消待播声音', async (t) => {
  const { sound, sources, release } = audioEnvironment(t, { deferred: true });
  sound.interaction('noop');
  sound.interaction('fill');
  sound.interaction('fill');
  sound.configure({ volume: 0 });
  release();
  await flush();
  assert.equal(sources.length, 0);
  sound.configure({ volume: 0.3 });
  for (let i = 0; i < 20; i++) sound.interaction('redo');
  await flush();
  assert.equal(sources.length, 1);
});

test('无法加载或解码音效不影响绘画交互', async (t) => {
  const { sound, sources } = audioEnvironment(t);
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  sound.interaction('stroke');
  sound.interaction('fill');
  await flush();
  sound.interaction('stroke-end');
  assert.equal(sources.length, 0);
});

import { randomUUID, randomInt } from 'node:crypto';
import {
  wordsSchema,
  choiceSchema,
  guessSchema,
  drawSchema,
  wordPrompt,
  choicePrompt,
  guessPrompt,
  drawPrompt,
  validWords,
  normalize,
  wordLength,
} from './prompts.mjs';

export const migrations = [
  {
    id: '1000_initial',
    sql: `
CREATE TABLE games(session_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(json_valid(state)));
CREATE TABLE preferences(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL CHECK(json_valid(value)));
CREATE TABLE rounds(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ended_at INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)));
CREATE INDEX rounds_session ON rounds(session_id,ended_at DESC);
CREATE TABLE requests(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, round_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, input TEXT NOT NULL, output TEXT, usage TEXT);
`,
  },
];
const blank = () => ({ version: 1, shapes: [] });
const defaults = { duration: 300, firstPainter: 'human' };
const publicSummary = ({ scene: _scene, guesses, ...item }) => ({
  ...item,
  guesses: guesses.slice(-12),
  guessCount: guesses.length,
});
const settingsValue = (value) => {
  if (
    !value ||
    ![180, 300, 600].includes(value.duration) ||
    !['human', 'model'].includes(value.firstPainter)
  )
    throw new Error('invalid-settings');
  return { duration: value.duration, firstPainter: value.firstPainter };
};
const publicState = (state) =>
  state
    ? {
        id: state.id,
        round: state.round,
        phase: state.phase,
        painter: state.painter,
        scene: state.scene,
        canvasRevision: state.canvasRevision,
        epoch: state.epoch,
        deadline: state.deadline,
        remaining: state.remaining,
        duration: state.duration,
        guesses: state.guesses,
        result: state.result,
        error: state.error,
        thinking: Boolean(state.pending),
        choices:
          state.painter === 'human' && state.phase === 'choosing'
            ? state.choices.map((v) => v.word)
            : [],
        word: state.painter === 'human' || state.result ? (state.answer?.word ?? null) : null,
        characterCount: state.answer ? wordLength(state.answer.word) : null,
      }
    : null;

export async function createGame(db, { validateCanvas, now = Date.now } = {}) {
  let queue = Promise.resolve(),
    closed = false;
  const running = new Map();
  const serial = (action) => {
    if (closed) return Promise.reject(new Error('game-closed'));
    const work = queue.then(action);
    queue = work.catch(() => {});
    return work;
  };
  const scope = (context) => {
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
    const row = await db.get('SELECT state FROM games WHERE session_id=?', [id]);
    return row ? JSON.parse(row.state) : null;
  };
  const settings = async () => {
    const row = await db.get('SELECT value FROM preferences WHERE id=1');
    return row ? settingsValue(JSON.parse(row.value)) : { ...defaults };
  };
  const write = async (id, state) => {
    await db.run(
      'INSERT INTO games(session_id,state) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state',
      [id, JSON.stringify(state)],
    );
    running.get(id)?.wake?.();
  };
  const history = async (id) =>
    (
      await db.all(
        'SELECT record FROM rounds WHERE session_id=? ORDER BY ended_at DESC,rowid DESC LIMIT 5',
        [id],
      )
    ).map((row) => JSON.parse(row.record));
  const record = (state) => ({
    round: state.round,
    painter: state.painter,
    answer: state.answer?.word ?? null,
    result: state.result,
    guesses: state.guesses,
    scene: state.scene,
  });
  const archive = async (id, state) => {
    const summary = record(state);
    await db.transaction([
      {
        sql: 'INSERT INTO games(session_id,state) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state',
        params: [id, JSON.stringify(state)],
      },
      {
        sql: 'INSERT OR IGNORE INTO rounds(id,session_id,ended_at,record) VALUES (?,?,?,?)',
        params: [state.id, id, now(), JSON.stringify(summary)],
      },
    ]);
    running.get(id)?.wake?.();
  };
  const cancel = (id) => {
    running.get(id)?.request?.abort();
    running.get(id)?.wake?.();
  };
  const finishRound = async (id, state, result) => {
    if (!['drawing', 'preparing', 'ready'].includes(state.phase)) return;
    state.phase = 'result';
    state.result = result;
    state.deadline = null;
    state.pending = null;
    state.epoch++;
    await archive(id, state);
    cancel(id);
  };
  const pause = async (id, state, reason) => {
    if (!state || ['paused', 'ended'].includes(state.phase)) return;
    state.pausedPhase = state.phase;
    state.remaining = state.deadline ? Math.max(0, state.deadline - now()) : state.remaining;
    state.deadline = null;
    state.phase = 'paused';
    state.pending = null;
    state.error = reason;
    state.epoch++;
    await write(id, state);
    cancel(id);
  };
  const next = (state, painter) => ({
    ...state,
    id: randomUUID(),
    round: (state?.round ?? 0) + 1,
    painter,
    phase: 'preparing',
    choices: [],
    answer: null,
    result: null,
    guesses: [],
    scene: blank(),
    canvasRevision: 0,
    epoch: (state?.epoch ?? 0) + 1,
    deadline: null,
    remaining: (state?.duration ?? 300) * 1000,
    pending: null,
    error: null,
    drawn: false,
    waiting: false,
    drawingCorrections: 0,
    drawingError: null,
    observed: -1,
    observedGuesses: -1,
  });
  // The database, not the old process, defines recovery. Never resume requests automatically.
  await db.run("UPDATE requests SET status='interrupted',ended_at=? WHERE status='running'", [
    now(),
  ]);
  for (const row of await db.all('SELECT session_id,state FROM games')) {
    await pause(row.session_id, JSON.parse(row.state), 'interrupted');
  }
  async function wait(runtime, milliseconds = 1000) {
    if (runtime.signal.aborted) return;
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        runtime.signal.removeEventListener('abort', done);
        if (runtime.wake === done) runtime.wake = null;
        resolve();
      };
      const timer = setTimeout(done, milliseconds);
      runtime.wake = done;
      runtime.signal.addEventListener('abort', done, { once: true });
    });
  }
  async function request(id, runtime, state, purpose, prompt, outputSchema, image) {
    const requestId = randomUUID(),
      controller = new AbortController();
    runtime.request = controller;
    const token = { round: state.id, epoch: state.epoch };
    const ready = await serial(async () => {
      const latest = await read(id);
      if (
        latest.id !== token.round ||
        latest.epoch !== token.epoch ||
        latest.phase === 'paused' ||
        latest.phase === 'ended'
      )
        return false;
      latest.pending = purpose;
      await db.transaction([
        {
          sql: 'INSERT INTO requests(id,session_id,round_id,purpose,status,started_at,input) VALUES (?,?,?,?,?,?,?)',
          params: [
            requestId,
            id,
            state.id,
            purpose,
            'running',
            now(),
            JSON.stringify({ prompt, canvasRevision: state.canvasRevision }),
          ],
        },
        {
          sql: 'UPDATE games SET state=? WHERE session_id=?',
          params: [JSON.stringify(latest), id],
        },
      ]);
      return true;
    });
    if (!ready) {
      runtime.request = null;
      return null;
    }
    let answer;
    try {
      answer = await runtime.model.request(
        {
          inheritCharacter: purpose !== 'words',
          prompt,
          outputSchema,
          ...(image ? { image } : {}),
        },
        AbortSignal.any([runtime.signal, controller.signal]),
      );
      return await serial(async () => {
        const latest = await read(id);
        const valid =
          !runtime.signal.aborted &&
          !controller.signal.aborted &&
          latest.id === token.round &&
          latest.epoch === token.epoch &&
          !['paused', 'ended', 'result'].includes(latest.phase);
        await db.run('UPDATE requests SET status=?,ended_at=?,output=?,usage=? WHERE id=?', [
          valid ? 'succeeded' : 'discarded',
          now(),
          JSON.stringify(answer.value),
          JSON.stringify(answer.usage),
          requestId,
        ]);
        if (!valid) return null;
        latest.pending = null;
        await write(id, latest);
        return { value: answer.value, state: latest };
      });
    } catch (error) {
      await serial(async () => {
        await db.run('UPDATE requests SET status=?,ended_at=? WHERE id=?', [
          controller.signal.aborted || runtime.signal.aborted ? 'cancelled' : 'failed',
          now(),
          requestId,
        ]);
        if (!controller.signal.aborted && !runtime.signal.aborted)
          await pause(id, await read(id), 'model-request-failed');
      });
      return null;
    } finally {
      if (runtime.request === controller) runtime.request = null;
    }
  }
  async function loop(id, runtime) {
    while (!runtime.signal.aborted) {
      const state = await serial(async () => {
        const value = await read(id);
        if (value.phase === 'drawing' && value.deadline <= now())
          await finishRound(id, value, 'timeout');
        return value;
      });
      if (['paused', 'ended'].includes(state.phase)) return;
      if (state.phase === 'preparing' && !state.choices.length) {
        if (state.pool.length < 3) {
          const result = await request(
            id,
            runtime,
            state,
            'words',
            wordPrompt(state.used),
            wordsSchema,
          );
          if (!result) continue;
          await serial(async () => {
            const current = await read(id);
            if (current.id !== state.id || current.epoch !== state.epoch) return;
            current.pool = validWords(result.value, current.used);
            if (current.pool.length < 3) {
              await pause(id, current, 'word-generation-failed');
              return;
            }
            await write(id, current);
          });
          continue;
        }
        await serial(async () => {
          const current = await read(id);
          if (current.id !== state.id || current.epoch !== state.epoch) return;
          const choices = [];
          for (let i = 0; i < 3; i++)
            choices.push(current.pool.splice(randomInt(current.pool.length), 1)[0]);
          current.choices = choices;
          current.used.push(...choices.map((v) => v.word));
          current.phase = 'choosing';
          await write(id, current);
        });
        continue;
      }
      if (state.phase === 'choosing' && state.painter === 'model') {
        const result = await request(
          id,
          runtime,
          state,
          'choice',
          choicePrompt(state.choices),
          choiceSchema,
        );
        if (!result) continue;
        await serial(async () => {
          const current = await read(id);
          if (
            current.id !== state.id ||
            current.epoch !== state.epoch ||
            current.phase !== 'choosing'
          )
            return;
          current.answer = current.choices[result.value.choice - 1];
          current.phase = 'ready';
          await write(id, current);
        });
        continue;
      }
      const snapshot = runtime.snapshot;
      const currentImage =
        snapshot &&
        snapshot.roundId === state.id &&
        snapshot.epoch === state.epoch &&
        snapshot.revision === state.canvasRevision;
      if (
        state.painter === 'human' &&
        state.phase === 'drawing' &&
        state.scene.shapes.length &&
        currentImage &&
        state.observed < snapshot.revision &&
        now() - runtime.lastRequest >= 2500
      ) {
        runtime.lastRequest = now();
        const result = await request(
          id,
          runtime,
          state,
          'guess',
          guessPrompt(state.guesses, wordLength(state.answer.word)),
          guessSchema,
          snapshot.image,
        );
        if (!result) continue;
        await serial(async () => {
          const current = await read(id);
          if (
            current.id !== state.id ||
            current.epoch !== state.epoch ||
            current.phase !== 'drawing'
          )
            return;
          current.observed = snapshot.revision;
          if (current.deadline <= now()) {
            await finishRound(id, current, 'timeout');
            return;
          }
          const guess = result.value.guess.trim();
          if (guess && !current.guesses.some((v) => normalize(v.text) === normalize(guess))) {
            current.guesses.push({ by: 'model', text: guess, at: now() });
            if (
              [current.answer.word, ...current.answer.aliases].some(
                (v) => normalize(v) === normalize(guess),
              )
            ) {
              await finishRound(id, current, 'guessed');
              return;
            }
          }
          await write(id, current);
        });
        continue;
      }
      if (
        state.painter === 'model' &&
        ['ready', 'drawing'].includes(state.phase) &&
        currentImage &&
        (!state.waiting || state.observedGuesses < state.guesses.length)
      ) {
        const result = await request(
          id,
          runtime,
          state,
          'draw',
          drawPrompt(state),
          drawSchema,
          snapshot.image,
        );
        if (!result) continue;
        await serial(async () => {
          const current = await read(id);
          if (
            current.id !== state.id ||
            current.epoch !== state.epoch ||
            !['ready', 'drawing'].includes(current.phase)
          )
            return;
          if (current.phase === 'drawing' && current.deadline <= now()) {
            await finishRound(id, current, 'timeout');
            return;
          }
          try {
            if (
              result.value.remove.some(
                (key) => !current.scene.shapes.some((shape) => shape.id === key),
              )
            )
              throw new Error('missing-shape');
            current.scene = validateCanvas({
              version: 1,
              shapes: [
                ...current.scene.shapes.filter((shape) => !result.value.remove.includes(shape.id)),
                ...result.value.add.map((shape) => ({ ...shape, id: randomUUID() })),
              ],
            });
          } catch {
            current.drawingCorrections++;
            current.drawingError =
              '上一批操作未执行：请检查坐标范围、成对的笔画坐标和remove中的已有元素标识。按当前画面重新提交合法操作。';
            if (current.drawingCorrections >= 2) await pause(id, current, 'invalid-drawing');
            else await write(id, current);
            return;
          }
          current.drawingCorrections = 0;
          current.drawingError = null;
          current.canvasRevision++;
          current.waiting =
            result.value.done || (!result.value.add.length && !result.value.remove.length);
          current.observedGuesses = state.guesses.length;
          if (current.phase === 'ready') {
            current.phase = 'drawing';
            current.deadline = now() + current.remaining;
          }
          await write(id, current);
        });
        continue;
      }
      await wait(runtime);
    }
  }
  return {
    settings: () => serial(settings),
    saveSettings: (input) =>
      serial(async () => {
        const value = settingsValue(input);
        await db.run(
          'INSERT INTO preferences(id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
          [JSON.stringify(value)],
        );
        return value;
      }),
    load: (context) =>
      serial(async () => {
        const id = scope(context),
          runtime = running.get(id);
        if (runtime) runtime.lastSeen = now();
        return publicState(await read(id));
      }),
    history: (_input, context) =>
      serial(async () => ({ rounds: (await history(scope(context))).map(publicSummary) })),
    async play(_input, context) {
      const id = scope(context);
      if (!context.privateModel?.imageInputSupported)
        return {
          status: 'unavailable',
          message: '请使用支持图片输入的模型，并更新支持插件接口8的LimeA。',
        };
      if (running.has(id)) throw new Error('game-already-running');
      const controller = new AbortController();
      const runtime = {
        signal: AbortSignal.any([context.signal, controller.signal]),
        controller,
        model: context.privateModel,
        runId: context.runId,
        request: null,
        snapshot: null,
        wake: null,
        lastRequest: 0,
        lastSeen: now(),
      };
      let settled;
      runtime.done = new Promise((resolve) => {
        settled = resolve;
      });
      running.set(id, runtime);
      let checking = false,
        lastTick = now();
      const timer = setInterval(() => {
        if (checking || closed) return;
        checking = true;
        void serial(async () => {
          const current = await read(id),
            time = now(),
            previousTick = lastTick,
            slept = time - lastTick > 10000;
          lastTick = time;
          if (!current || ['paused', 'ended'].includes(current.phase)) return;
          if (slept && current.phase !== 'result') {
            if (current.deadline) {
              current.remaining = Math.max(0, current.deadline - previousTick);
              current.deadline = null;
            }
            await pause(id, current, 'interrupted');
          } else if (time - runtime.lastSeen > 5000 && current.phase !== 'result') {
            await pause(id, current, 'viewer-disconnected');
          } else if (current.phase === 'drawing' && current.deadline <= time)
            await finishRound(id, current, 'timeout');
        })
          .catch(() => {
            runtime.controller.abort();
          })
          .finally(() => {
            checking = false;
          });
      }, 500);
      try {
        await serial(async () => {
          let state = await read(id);
          if (!state || state.phase === 'ended') {
            const preferences = await settings();
            state = next(
              { pool: [], used: [], duration: preferences.duration },
              preferences.firstPainter,
            );
          } else if (state.phase === 'paused') {
            state.phase = state.pausedPhase ?? 'preparing';
            state.error = null;
            state.pending = null;
            state.drawingCorrections = 0;
            if (state.phase === 'drawing') state.deadline = now() + state.remaining;
            state.epoch++;
          }
          // Upgrade a saved first-version human round that was waiting for Start drawing.
          if (state.phase === 'ready' && state.painter === 'human') {
            state.phase = 'drawing';
            state.deadline = now() + state.remaining;
          }
          state.runId = context.runId;
          await write(id, state);
        });
        await loop(id, runtime);
        return await serial(async () => ({
          status: (await read(id)).phase,
          rounds: (await history(id)).map(publicSummary),
        }));
      } finally {
        clearInterval(timer);
        controller.abort();
        runtime.request?.abort();
        runtime.wake?.();
        running.delete(id);
        try {
          await serial(async () => {
            const state = await read(id);
            if (state?.runId === context.runId) await pause(id, state, 'interrupted');
          });
        } finally {
          settled();
        }
      }
    },
    action: (input) =>
      serial(async () => {
        const id = scope(input),
          state = await read(id);
        if (!state || input.roundId !== state.id || input.epoch !== state.epoch)
          throw new Error('stale-round');
        if (state.phase === 'drawing' && state.deadline <= now())
          await finishRound(id, state, 'timeout');
        if (input.action === 'quit') {
          state.phase = 'ended';
          state.pending = null;
          state.deadline = null;
          state.epoch++;
          await write(id, state);
          cancel(id);
          return publicState(state);
        }
        if (!running.has(id)) throw new Error('game-paused');
        if (input.action === 'pause') {
          await pause(id, state, 'user');
          return publicState(state);
        }
        if (input.action === 'snapshot') {
          if (
            input.revision !== state.canvasRevision ||
            typeof input.image?.dataUrl !== 'string' ||
            input.image.dataUrl.length > 2_000_000 ||
            input.image.width !== 800 ||
            input.image.height !== 600
          )
            throw new Error('invalid-snapshot');
          running.get(id).snapshot = {
            roundId: state.id,
            epoch: state.epoch,
            revision: input.revision,
            image: input.image,
          };
          running.get(id).wake?.();
          return { accepted: true };
        }
        if (input.action === 'choose' && state.phase === 'choosing' && state.painter === 'human') {
          if (!Number.isInteger(input.choice) || !state.choices[input.choice])
            throw new Error('invalid-choice');
          state.answer = state.choices[input.choice];
          state.phase = 'drawing';
          state.deadline = now() + state.remaining;
        } else if (
          input.action === 'draw' &&
          state.phase === 'drawing' &&
          state.painter === 'human'
        ) {
          if (input.revision !== state.canvasRevision) throw new Error('stale-canvas');
          state.scene = validateCanvas(input.scene);
          state.canvasRevision++;
        } else if (
          input.action === 'guess' &&
          state.phase === 'drawing' &&
          state.painter === 'model'
        ) {
          const text = String(input.text ?? '').trim();
          if (!text || text.length > 40 || state.guesses.length >= 100)
            throw new Error('invalid-guess');
          state.guesses.push({ by: 'human', text, at: now() });
          if (
            [state.answer.word, ...state.answer.aliases].some(
              (value) => normalize(value) === normalize(text),
            )
          ) {
            await finishRound(id, state, 'guessed');
            return publicState(state);
          }
        } else if (input.action === 'reveal' && ['drawing', 'ready'].includes(state.phase)) {
          await finishRound(id, state, 'revealed');
          return publicState(state);
        } else if (input.action === 'next' && state.phase === 'result') {
          const value = next(state, state.painter === 'human' ? 'model' : 'human');
          await write(id, value);
          return publicState(value);
        } else throw new Error('invalid-action');
        await write(id, state);
        return publicState(state);
      }),
    finished: (context) =>
      serial(async () => {
        const id = scope(context),
          state = await read(id);
        if (state?.runId === context.runId) await pause(id, state, 'interrupted');
      }),
    async dispose() {
      const active = [...running.values()];
      for (const runtime of active) {
        runtime.controller.abort();
        runtime.request?.abort();
        runtime.wake?.();
      }
      await Promise.all(active.map((runtime) => runtime.done));
      await queue;
      closed = true;
    },
  };
}

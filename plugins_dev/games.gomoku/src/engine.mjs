import { Worker } from 'node:worker_threads';

export function createEngine({
  timeoutMs = 2500,
  workerUrl = new URL('./engine-worker.mjs', import.meta.url),
} = {}) {
  const pending = new Map();
  let closed = false;
  return {
    analyze(match) {
      if (closed) return Promise.resolve(null);
      const scope = match.runId;
      const key = `${match.roundId}:${match.revision}:${match.settings.difficulty}`;
      const previous = pending.get(scope);
      if (previous?.key === key) return previous.promise;
      previous?.cancel();
      let cancel;
      const promise = new Promise((resolve) => {
        let worker,
          timer,
          done = false,
          latest = null;
        const finish = (limited = false) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          void worker?.terminate().catch(() => {});
          resolve(latest ? { ...latest, limited } : null);
        };
        cancel = () => {
          latest = null;
          finish();
        };
        try {
          worker = new Worker(workerUrl, {
            workerData: { moves: match.moves, difficulty: match.settings.difficulty },
          });
          worker.on('message', (message) => {
            latest = message.analysis;
            if (message.done) finish();
          });
          worker.on('error', () => finish(true));
          worker.on('exit', () => finish(true));
          timer = setTimeout(() => finish(true), timeoutMs);
        } catch {
          finish(true);
        }
      });
      pending.set(scope, { key, promise, cancel });
      return promise;
    },
    cancel(runId) {
      pending.get(runId)?.cancel();
      pending.delete(runId);
    },
    dispose() {
      closed = true;
      for (const item of pending.values()) item.cancel();
      pending.clear();
    },
  };
}

import { parentPort, workerData } from 'node:worker_threads';
import { analyzePosition } from './engine-search.mjs';

const result = analyzePosition(workerData.moves, workerData.difficulty, (analysis) =>
  parentPort.postMessage({ analysis }),
);
parentPort.postMessage({ analysis: result, done: true });

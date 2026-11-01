import { GomokuSolution, NarrowSearcher } from '@algorithm.ts/gomoku';
import { COLUMNS, SIZE } from './rules.mjs';

// Adapt the library's root-perspective scores; never interpret them as probabilities.
const LIMIT = 1_000_000_000;
export function analyzePosition(moves, difficulty, publish = () => {}) {
  const solution = new GomokuSolution({ MAX_ROW: SIZE, MAX_COL: SIZE });
  solution.init(
    moves.map(({ row, column, player }) => ({
      r: row - 1,
      c: COLUMNS.indexOf(column),
      p: player === 'model' ? 0 : 1,
    })),
  );
  const mover = solution.mover;
  mover.resetRootPlayerId(0);
  const occupied = new Set(
    moves.map(({ row, column }) => (row - 1) * SIZE + COLUMNS.indexOf(column)),
  );
  const searcher = (depth) =>
    new NarrowSearcher({
      mover,
      MAX_SEARCH_DEPTH: depth,
      MAX_CANDIDATE_COUNT: difficulty === 'hard' ? 10 : 8,
      CANDIDATE_GROWTH_FACTOR: 8,
      // Bound search by depth. The optional tactical extension is deliberately disabled.
      MIN_PROMOTION_SCORE: Infinity,
      deeperSearcher: null,
    });
  const rank = (a, b) => b.score - a.score || a.distance - b.distance || a.posId - b.posId;
  const evaluate = (posId, search) => {
    mover.forward(posId, 0);
    try {
      const final = mover.isFinal();
      const raw = final
        ? moves.length === 224 && !mover.state.isWin(0)
          ? 0
          : Infinity
        : search.search(1, -Infinity, Infinity, 1);
      return {
        posId,
        row: Math.floor(posId / SIZE) + 1,
        column: COLUMNS[posId % SIZE],
        // The upstream search uses infinities for tactical threats, including a
        // single open four. Keep those below an actual completed winning line.
        score:
          final && raw === Infinity
            ? LIMIT
            : Math.max(-LIMIT * 0.9, Math.min(LIMIT * 0.9, Math.round(raw))),
        assessment:
          final && raw === Infinity
            ? 'winning-line'
            : raw === Infinity
              ? 'strong-threat'
              : raw === -Infinity
                ? 'opponent-threat'
                : 'evaluation',
        distance: Math.abs(Math.floor(posId / SIZE) - 7) + Math.abs((posId % SIZE) - 7),
      };
    } finally {
      mover.revert(posId);
    }
  };
  const result = (candidates, depth) => ({
    engine: '@algorithm.ts/gomoku',
    difficulty,
    depth,
    scoreType: 'evaluation',
    perspective: 'model',
    higherIsBetter: true,
    candidates: candidates
      .sort(rank)
      .slice(0, 3)
      .map(({ posId: _id, distance: _distance, ...point }) => point),
  });
  const initial = [],
    shallow = searcher(0);
  for (let pos = 0; pos < SIZE * SIZE; pos++)
    if (!occupied.has(pos)) initial.push(evaluate(pos, shallow));
  const baseline = result(initial, 1);
  publish(baseline);
  const shortlist = initial.slice(0, difficulty === 'hard' ? 18 : 12);
  let latest = baseline;
  for (const depth of difficulty === 'hard' ? [1, 3] : [1]) {
    const search = searcher(depth);
    latest = result(
      shortlist.map(({ posId }) => evaluate(posId, search)),
      depth + 1,
    );
    publish(latest);
  }
  return latest;
}

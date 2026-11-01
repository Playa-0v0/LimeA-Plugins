export const SIZE = 15;
export const COLUMNS = 'ABCDEFGHIJKLMNO';
export const other = (player) => (player === 'human' ? 'model' : 'human');
export const colorOf = (match, player) => (player === match.black ? 'black' : 'white');
export const symbolOf = (match, player) => (player === match.black ? 'X' : 'O');
export const MODEL_PERSPECTIVE =
  '你是参与对局的当前角色，model 表示你自己，human 表示用户（你的对手）；落子、轮次、胜者和比分均使用这组固定身份，与黑白颜色无关。';

export function playerInstruction(match) {
  const describe = (player) => {
    const stones = match.moves
      .filter((move) => move.player === player)
      .map((move) => `${move.column}${move.row}`);
    return `${player === 'model' ? '你（当前角色，model）' : '用户（你的对手，human）'}执${colorOf(match, player) === 'black' ? '黑棋' : '白棋'}（${symbolOf(match, player)}），已有落点：${stones.length ? stones.join('、') : '无'}`;
  };
  return `${MODEL_PERSPECTIVE}\n本局身份：${describe('model')}；${describe('human')}。本局颜色固定，续局可能重新分配；以本轮身份为准，不沿用上一局颜色，不把对手的连线当作自己的连线。`;
}

export function coordinate(row, column) {
  if (
    !Number.isInteger(row) ||
    row < 1 ||
    row > SIZE ||
    typeof column !== 'string' ||
    !/^[A-O]$/.test(column)
  )
    throw new Error('invalid-coordinate: row must be 1..15 and column A..O');
  return `${column}${row}`;
}

export function boardOf(match) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (const move of match.moves) board[move.row - 1][COLUMNS.indexOf(move.column)] = move.player;
  return board;
}

export function lineThrough(board, row, col, player) {
  for (const [dy, dx] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const line = [{ row: row + 1, column: COLUMNS[col] }];
    for (const sign of [-1, 1]) {
      for (
        let y = row + dy * sign, x = col + dx * sign;
        y >= 0 && y < SIZE && x >= 0 && x < SIZE && board[y][x] === player;
        y += dy * sign, x += dx * sign
      ) {
        line.push({ row: y + 1, column: COLUMNS[x] });
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

export function place(match, player, row, column) {
  if (match.status !== 'active' || match.turn !== player) throw new Error('not-your-turn');
  coordinate(row, column);
  const board = boardOf(match);
  const x = COLUMNS.indexOf(column),
    y = row - 1;
  if (board[y][x]) throw new Error('cell-occupied: choose an empty point marked .');
  board[y][x] = player;
  match.moves.push({ row, column, player });
  match.winningLine = lineThrough(board, y, x, player);
  if (match.winningLine.length || match.moves.length === SIZE * SIZE) {
    match.status = 'round-over';
    match.winner = match.winningLine.length ? player : 'draw';
    match.scores[match.winner]++;
    match.reason = match.winner === 'draw' ? 'board-full' : 'five-in-row';
    match.turn = null;
  } else match.turn = other(player);
}

export function textBoard(match) {
  const rows = boardOf(match).map(
    (cells, index) =>
      `${String(index + 1).padStart(2, '0')} ${cells.map((player) => (player ? (player === match.black ? 'X' : 'O') : '.')).join(' ')}`,
  );
  return ['   ' + [...COLUMNS].join(' '), ...rows].join('\n');
}

export function roundRecord(match) {
  return {
    matchId: match.matchId,
    roundId: match.roundId,
    roundNumber: match.roundNumber,
    perspective: MODEL_PERSPECTIVE,
    humanColor: colorOf(match, 'human'),
    modelColor: colorOf(match, 'model'),
    winner: match.winner,
    completed: Boolean(match.winner),
    reason:
      match.winner === 'draw'
        ? 'board-full'
        : match.winner
          ? match.winningLine.length
            ? 'five-in-row'
            : 'resigned'
          : 'user-ended',
    // Ordered notation preserves every move without duplicating a 15x15 board.
    moves: match.moves
      .map((move) => `${move.player === 'human' ? '用户' : '你'}:${move.column}${move.row}`)
      .join(' '),
    moveCount: match.moves.length,
    scores: { ...match.scores },
  };
}

// Live boards are transient instructions. Final records must also survive in chat history.
export function toolState(match) {
  return {
    matchId: match.matchId,
    roundId: match.roundId,
    revision: match.revision,
    roundNumber: match.roundNumber,
    status: match.status,
    turn: match.turn,
    perspective: MODEL_PERSPECTIVE,
    modelColor: colorOf(match, 'model'),
    humanColor: colorOf(match, 'human'),
    modelSymbol: symbolOf(match, 'model'),
    humanSymbol: symbolOf(match, 'human'),
    moveCount: match.moves.length,
    lastMove: match.moves.at(-1) ?? null,
    winner: match.winner,
    reason: match.reason,
    replayRequested: Boolean(match.replayRequested),
    scores: { ...match.scores },
    ...(match.winner || match.status === 'ended' ? { roundRecord: roundRecord(match) } : {}),
  };
}

export function publicMatch(match) {
  if (!match) return null;
  const { operations: _operations, ...state } = match;
  return state;
}

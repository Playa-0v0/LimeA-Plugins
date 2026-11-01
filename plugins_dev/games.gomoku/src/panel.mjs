import css from './panel.css';
import { SIZE, COLUMNS } from './rules.mjs';

export function mount(container, context) {
  const en = context.language.startsWith('en');
  const tr = (zh, english) => (en ? english : zh);
  const root = document.createElement('section');
  root.className = 'gomoku';
  const style = document.createElement('style');
  style.textContent = css;
  root.innerHTML = `<header class="heading"><div><h2>${tr('五子棋', 'Gomoku')}</h2><p>${tr('和当前角色一起，落子成局。', 'A game with your current character.')}</p></div><button class="refresh" type="button">${tr('同步棋局', 'Sync game')}</button></header>
    <div class="scoreboard"><div class="player human"><span class="piece"></span><div><strong class="name">${tr('你', 'You')}</strong><span class="color-label"></span></div></div><div class="scores"><strong>0 : 0</strong><span class="round">${tr('随机分配黑白', 'Random colors')}</span></div><div class="player model"><div><strong class="name"></strong><span class="color-label"></span></div><span class="piece"></span></div></div>
    <p class="status" role="status"></p><div class="board-layout"><div class="columns" aria-hidden="true"></div><div class="rows" aria-hidden="true"></div><div class="board"><svg viewBox="0 0 15 15" aria-hidden="true"></svg><div class="cells" role="group" aria-label="${tr('五子棋棋盘', 'Gomoku board')}"></div></div></div><p class="last"></p>
    <p class="error" role="alert" hidden></p><details class="rules"><summary>${tr('玩法与规则', 'How to play')}</summary><p>${tr('15×15 自由五子棋，无禁手。黑棋先行，横、竖或斜向连成五颗及以上获胜。棋盘填满且无人获胜则和棋。点击交点落子；最后一手有圆点标记。键盘方向键选点，回车落子。角色自己思考落子，棋力取决于当前模型。', '15×15 freestyle Gomoku, with no forbidden moves. Black starts. Five or more stones in a row wins; a full board is a draw. Click an intersection to play. A dot marks the last move. Use arrow keys to select and Enter to play. Your character chooses its moves using the current model.')}</p></details>
    <footer class="bottom"><small class="note">${tr('棋局自动保存，可中断后继续', 'Saved automatically. Resume anytime.')}</small><div class="actions"><button class="resign" type="button" hidden>${tr('认输', 'Resign')}</button><button class="quit" type="button" hidden>${tr('结束游戏', 'End game')}</button><button class="start primary" type="button">${tr('开始对局', 'Start game')}</button></div></footer>`;
  root.prepend(style);
  container.append(root);
  const $ = (selector) => root.querySelector(selector);
  const cells = $('.cells'),
    status = $('.status'),
    error = $('.error');
  let match = null,
    busy = false,
    ready = false,
    hostBusy = true,
    visible = true,
    disposed = false;
  let refreshing = false,
    timer,
    epoch = 0,
    pollEpoch = 0,
    focusIndex = 112,
    syncFailed = false;
  let cancelRun = () => {},
    cancelVisibility = () => {};
  const clicks = new AbortController();
  const scope = { mode: context.mode, sessionId: context.sessionId };
  const buttons = [];
  $('.columns').replaceChildren(
    ...[...COLUMNS].map((text) => {
      const el = document.createElement('span');
      el.textContent = text;
      return el;
    }),
  );
  $('.rows').replaceChildren(
    ...Array.from({ length: SIZE }, (_, index) => {
      const el = document.createElement('span');
      el.textContent = String(index + 1);
      return el;
    }),
  );
  const lines = Array.from(
    { length: SIZE },
    (_, i) => `<path d="M.5 ${i + 0.5}H14.5 M${i + 0.5} .5V14.5"/>`,
  ).join('');
  $('.board > svg').innerHTML =
    `<g fill="none" stroke="#8b704b" stroke-width=".025">${lines}</g><g fill="#6c5232">${[
      [3.5, 3.5],
      [11.5, 3.5],
      [7.5, 7.5],
      [3.5, 11.5],
      [11.5, 11.5],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".09"/>`)
      .join('')}</g>`;
  const roleName = () => context.characterName?.trim() || tr('角色', 'Character');
  const humanCanMove = () =>
    ready && !busy && hostBusy && match?.status === 'active' && match.turn === 'human';
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  const accept = (next) => {
    if (disposed) return;
    if (next && match?.matchId === next.matchId && next.revision < match.revision) return;
    match = next;
    ready = true;
    if (syncFailed) {
      error.hidden = true;
      syncFailed = false;
    }
    render();
  };
  function render() {
    if (disposed) return;
    root.dataset.status = match?.status ?? 'idle';
    root.dataset.turn = match?.turn ?? '';
    root.dataset.roundId = match?.roundId ?? '';
    root.dataset.moves = String(match?.moves.length ?? 0);
    const name = roleName();
    $('.model .name').textContent = name;
    $('.model .name').title = name;
    for (const player of ['human', 'model']) {
      const color = match ? (match.black === player ? 'black' : 'white') : '';
      $(`.${player} .piece`).dataset.color = color;
      $(`.${player} .color-label`).textContent = !color
        ? tr('待分配', 'Unassigned')
        : color === 'black'
          ? tr('黑棋 · 先手', 'Black · first')
          : tr('白棋 · 后手', 'White · second');
      $(`.player.${player}`).dataset.turn = String(
        match?.status === 'active' && match.turn === player,
      );
    }
    $('.scores strong').textContent = `${match?.scores.human ?? 0} : ${match?.scores.model ?? 0}`;
    $('.round').textContent = match
      ? tr(
          `第 ${match.roundNumber} 局 · 和棋 ${match.scores.draw}`,
          `Round ${match.roundNumber} · Draws ${match.scores.draw}`,
        )
      : tr('随机分配黑白', 'Random colors');
    const live = match?.status === 'active';
    const over = match && ['round-over', 'waiting-replay'].includes(match.status);
    status.dataset.result = String(Boolean(over));
    status.textContent = !ready
      ? tr('正在同步棋局…', 'Syncing game…')
      : !match
        ? hostBusy
          ? tr('请等当前对话结束后再开局', 'Wait for the current conversation to finish')
          : tr('准备好了吗？开始一局五子棋吧', 'Ready for a game of Gomoku?')
        : match.status === 'ended'
          ? tr('对局已结束，比分已保存', 'Game ended. Scores saved.')
          : match.status === 'paused' || !hostBusy
            ? tr('对局已暂停，棋盘已保留', 'Game paused. Your board is saved.')
            : over
              ? match.winner === 'draw'
                ? tr('这一局和棋', 'This round is a draw')
                : match.winner === 'human'
                  ? tr('这一局，你赢了', 'You won this round')
                  : tr(`这一局，${name}赢了`, `${name} won this round`)
              : match.turn === 'human'
                ? tr('轮到你落子', 'Your turn')
                : tr(`${name}正在思考…`, `${name} is thinking…`);
    const board = new Map(
      (match?.moves ?? []).map((move) => [`${move.column}${move.row}`, move.player]),
    );
    const won = new Set((match?.winningLine ?? []).map((point) => `${point.column}${point.row}`));
    const last = match?.moves.at(-1);
    cells.dataset.humanColor = match?.black === 'human' ? 'black' : 'white';
    for (const [index, button] of buttons.entries()) {
      const point = button.dataset.point,
        player = board.get(point);
      const color = player ? (match.black === player ? 'black' : 'white') : null;
      if (color) button.dataset.color = color;
      else delete button.dataset.color;
      button.dataset.last = String(last && point === `${last.column}${last.row}`);
      button.dataset.win = String(won.has(point));
      button.disabled = !humanCanMove() || Boolean(player);
      button.tabIndex = index === focusIndex && !button.disabled ? 0 : -1;
      button.setAttribute(
        'aria-label',
        color
          ? `${point} ${color === 'black' ? tr('黑棋', 'black') : tr('白棋', 'white')}`
          : tr(`落子于 ${point}`, `Play ${point}`),
      );
    }
    if (
      humanCanMove() &&
      (buttons[focusIndex]?.disabled || !buttons.some((button) => button.tabIndex === 0))
    ) {
      focusIndex = buttons.findIndex((button) => !button.disabled);
      if (focusIndex >= 0) buttons[focusIndex].tabIndex = 0;
    }
    $('.last').textContent = last
      ? tr(
          `第 ${match.moves.length} 手 · ${last.player === 'human' ? '你' : name}落在 ${last.column}${last.row}`,
          `Move ${match.moves.length} · ${last.player === 'human' ? 'You' : name} played ${last.column}${last.row}`,
        )
      : tr('黑棋先行 · 点击交点落子', 'Black starts · Click an intersection');
    const replay = match?.status === 'waiting-replay';
    $('.start').hidden = Boolean(
      match && hostBusy && !['ended', 'paused', 'waiting-replay'].includes(match.status),
    );
    $('.start').disabled = busy || !ready || (hostBusy && !replay);
    $('.start').textContent = replay
      ? tr('再来一局', 'Play again')
      : match && !['ended'].includes(match.status)
        ? tr('继续对局', 'Resume game')
        : tr('开始对局', 'Start game');
    $('.quit').hidden = !match || match.status === 'ended';
    $('.quit').disabled = busy || !ready;
    $('.quit').textContent = over ? tr('下次再玩', 'Maybe later') : tr('结束游戏', 'End game');
    $('.resign').hidden = !live || !hostBusy;
    $('.resign').disabled = busy || !ready;
    $('.refresh').disabled = busy || refreshing;
  }
  async function refresh() {
    if (disposed || refreshing || busy || !visible) return;
    refreshing = true;
    const version = epoch;
    try {
      const next = await context.command('load-match', scope);
      if (version === epoch && !disposed) accept(next);
    } catch {
      if (!disposed && version === epoch) {
        ready = false;
        syncFailed = true;
        fail(
          tr('棋局同步失败，请点击“同步棋局”重试。', 'Could not sync. Click “Sync game” to retry.'),
        );
      }
    } finally {
      refreshing = false;
      render();
    }
  }
  function schedule() {
    const generation = ++pollEpoch;
    clearTimeout(timer);
    if (disposed || !visible) return;
    void refresh().finally(() => {
      if (!disposed && visible && generation === pollEpoch) timer = setTimeout(schedule, 600);
    });
  }
  async function act(action, point) {
    if (disposed || busy || !ready || !match) return;
    busy = true;
    epoch++;
    error.hidden = true;
    render();
    try {
      accept(
        await context.command('match-action', {
          ...scope,
          matchId: match.matchId,
          roundId: match.roundId,
          revision: match.revision,
          action,
          ...(point ? { row: Number(point.slice(1)), column: point[0] } : {}),
        }),
      );
    } catch {
      if (!disposed) {
        fail(
          tr(
            '操作未确认，已重新读取棋局，请核对后再操作。',
            'Action not confirmed. Reloading the saved board; check before trying again.',
          ),
        );
        try {
          accept(await context.command('load-match', scope));
        } catch {
          ready = false;
          syncFailed = true;
          fail(
            tr(
              '操作未确认，棋局同步也失败了，请恢复连接后同步核对。',
              'Action and sync could not be confirmed. Reconnect and sync the saved board.',
            ),
          );
        }
      }
    } finally {
      busy = false;
      render();
    }
  }
  async function start() {
    if (disposed || busy || !ready) return;
    if (match?.status === 'waiting-replay' && hostBusy) return act('replay');
    if (hostBusy) return;
    busy = true;
    epoch++;
    error.hidden = true;
    render();
    try {
      if (
        !(await context.startRun(
          'start',
          tr(
            '陪我下五子棋吧，请使用五子棋插件开始或继续对局。',
            'Play Gomoku with me. Use the Gomoku plugin to start or resume.',
          ),
        ))
      )
        throw new Error('start-failed');
    } catch {
      if (!disposed)
        fail(
          tr(
            '未能开始对局，请检查当前模型配置后重试。',
            'Could not start. Check your current model settings and try again.',
          ),
        );
    } finally {
      busy = false;
      render();
      void refresh();
    }
  }
  for (let row = 1; row <= SIZE; row++)
    for (const column of COLUMNS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cell';
      button.dataset.point = `${column}${row}`;
      button.innerHTML = '<span class="stone" aria-hidden="true"></span>';
      button.addEventListener(
        'click',
        () => {
          if (humanCanMove()) void act('move', button.dataset.point);
        },
        { signal: clicks.signal },
      );
      button.addEventListener(
        'keydown',
        (event) => {
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE }[
            event.key
          ];
          if (!delta || !humanCanMove()) return;
          event.preventDefault();
          let index = buttons.indexOf(button);
          for (let count = 0; count < SIZE * SIZE; count++) {
            index = (index + delta + SIZE * SIZE) % (SIZE * SIZE);
            if (!buttons[index].disabled) {
              focusIndex = index;
              render();
              buttons[index].focus();
              break;
            }
          }
        },
        { signal: clicks.signal },
      );
      buttons.push(button);
      cells.append(button);
    }
  $('.start').addEventListener('click', () => void start(), { signal: clicks.signal });
  $('.quit').addEventListener('click', () => void act('quit'), { signal: clicks.signal });
  $('.resign').addEventListener('click', () => void act('resign'), { signal: clicks.signal });
  $('.refresh').addEventListener('click', () => void refresh(), { signal: clicks.signal });
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    epoch++;
    pollEpoch++;
    clearTimeout(timer);
    clicks.abort();
    cancelRun();
    cancelVisibility();
    context.signal.removeEventListener('abort', cleanup);
    root.remove();
  };
  context.signal.addEventListener('abort', cleanup, { once: true });
  cancelRun = context.onRunStateChange((value) => {
    hostBusy = value;
    render();
    void refresh();
  });
  cancelVisibility = context.onVisibilityChange((value) => {
    visible = value;
    if (visible) schedule();
    else {
      pollEpoch++;
      clearTimeout(timer);
    }
  });
  render();
  if (context.signal.aborted) cleanup();
  else schedule();
  return cleanup;
}

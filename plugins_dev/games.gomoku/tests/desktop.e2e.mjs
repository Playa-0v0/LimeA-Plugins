// Run with LIMEA_REPO_DIR pointing to the host source and LIMEA_TEST_APP_DIR to a built host.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.LIMEA_REPO_DIR;
assert.ok(host && process.env.LIMEA_TEST_APP_DIR, 'Set LIMEA_REPO_DIR and LIMEA_TEST_APP_DIR');
const requireHost = createRequire(join(host, 'package.json'));
const { _electron: electron } = requireHost('playwright');
const { readProtocolStream } = await import(
  pathToFileURL(join(host, 'tests/fixtures/read-protocol-stream.ts'))
);
const { protocolStream } = await import(
  pathToFileURL(join(host, 'tests/fixtures/model-protocol-stream.ts'))
);
const plugin = fileURLToPath(new URL('..', import.meta.url));
const artifacts = join(plugin, 'artifacts');
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'limea-gomoku-e2e-')),
  profile = join(root, 'profile');
let app,
  requests = 0,
  missStart = true,
  missMove = true,
  invalidMove = true,
  forced = false,
  validatedBoards = 0;
const errors = [],
  serverErrors = [],
  logs = [];
const cols = 'ABCDEFGHIJKLMNO';
let releaseResult;
const resultGate = new Promise((resolve) => {
  releaseResult = resolve;
});
let holdResult = true;
let releaseMove;
const moveGate = new Promise((resolve) => {
  releaseMove = resolve;
});
let holdMove = false;
function saved() {
  const db = new DatabaseSync(
    join(profile, 'storage/plugin-data/games.gomoku/databases/matches.sqlite'),
    { readOnly: true },
  );
  try {
    return JSON.parse(
      db.prepare('SELECT state FROM matches ORDER BY rowid DESC LIMIT 1').get()?.state ?? 'null',
    );
  } finally {
    db.close();
  }
}
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests++;
    const names = (body.tools ?? []).map((tool) => tool.function.name);
    const start = names.find((name) => name.endsWith('_start'));
    const move = names.find((name) => name.endsWith('_place_stone'));
    let stream;
    if (start && missStart) {
      missStart = false;
      stream = protocolStream('chat-completions', { chunks: ['好呀，我们来下五子棋。'] });
    } else if (start) {
      if (holdResult && saved()?.status === 'round-over') {
        holdResult = false;
        await resultGate;
      }
      if (body.tool_choice?.function?.name === start) forced = true;
      stream = readProtocolStream(
        'chat-completions',
        {},
        { name: start, callId: `start-${requests}` },
      );
    } else if (move) {
      const state = saved();
      assert.equal(state.turn, 'model');
      const system = body.messages
        .filter((message) => message.role === 'system')
        .map((message) =>
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        )
        .join('\n');
      assert.ok(system.includes('A B C D E F G H I J K L M N O'));
      for (let row = 1; row <= 15; row++) {
        const line = [...cols]
          .map((column) => {
            const stone = state.moves.find((item) => item.row === row && item.column === column);
            return stone ? (stone.player === state.black ? 'X' : 'O') : '.';
          })
          .join(' ');
        assert.ok(
          system.includes(`${String(row).padStart(2, '0')} ${line}`),
          `board row ${row} must match persisted state`,
        );
      }
      validatedBoards++;
      if (missMove) {
        missMove = false;
        stream = protocolStream('chat-completions', { chunks: ['我想一想。'] });
      } else {
        if (holdMove) {
          holdMove = false;
          await moveGate;
        }
        const index = state.moves.filter((item) => item.player === 'model').length;
        let point = { row: 15, column: cols[index * 2] };
        if (invalidMove && state.moves.length >= 3) {
          invalidMove = false;
          point = state.moves[0];
        }
        stream = readProtocolStream(
          'chat-completions',
          {
            roundId: state.roundId,
            revision: state.revision,
            row: point.row,
            column: point.column,
          },
          { name: move, callId: `move-${requests}` },
        );
      }
    } else stream = protocolStream('chat-completions', { chunks: ['好呀，下次再一起下棋。'] });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(stream);
  } catch (error) {
    serverErrors.push(String(error));
    res.writeHead(500);
    res.end('mock-error');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, LIMEA_USER_DATA_DIR: profile, LIMEA_DISABLE_SANDBOX_SETUP: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
async function launch() {
  app = await electron.launch({
    executablePath: requireHost('electron'),
    args: [resolve(process.env.LIMEA_TEST_APP_DIR)],
    env,
  });
  app.process().stdout?.on('data', (value) => logs.push(value.toString()));
  app.process().stderr?.on('data', (value) => logs.push(value.toString()));
  const page = await app.firstWindow();
  const probeAudio = () => {
    if (window.gomokuAudioProbe) return;
    window.gomokuAudioProbe = { count: 0, duration: 0 };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        window.gomokuAudioProbe.count++;
        window.gomokuAudioProbe.duration = this.buffer.duration;
      }
      return start.apply(this, args);
    };
  };
  await page.addInitScript(probeAudio);
  await page.evaluate(probeAudio);
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') logs.push(message.text());
  });
  await page.waitForFunction(
    async () => (await window.limea?.getStartupState())?.phase === 'shell-ready',
  );
  await page.waitForFunction(async () => {
    try {
      await window.limea.getSearchSettings();
      return true;
    } catch {
      return false;
    }
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1500, height: 1080 }),
  );
  return page;
}
async function openGame(page) {
  const ws = page.locator('.workspace-root:visible');
  await ws.locator('.cy-mode-switch').getByText('Chat', { exact: true }).click();
  if (
    (await ws.locator('.workspace-content-layout').getAttribute('data-details-collapsed')) ===
    'true'
  )
    await ws.locator('.cy-sidebar-toggle[data-side=right]').click();
  if (await ws.getByRole('button', { name: '小游戏', exact: true }).count())
    await ws.getByRole('button', { name: '小游戏', exact: true }).click();
  await ws.getByRole('button', { name: '五子棋', exact: true }).click();
  await ws.locator('.gomoku').waitFor();
  return ws;
}
async function human(page) {
  await page
    .locator('.workspace-root:visible .gomoku[data-status=active][data-turn=human]')
    .waitFor();
  await page.locator('.workspace-root:visible .gomoku .cell:not(:disabled)').first().waitFor();
  return saved();
}
try {
  let page = await launch();
  await app.evaluate(
    ({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    },
    join(plugin, 'dist'),
  );
  await page.evaluate(async (baseURL) => {
    await window.limea.importSearchPlugin();
    await window.limea.setSearchPluginEnabled({ pluginId: 'games.gomoku', enabled: true });
    await window.limea.characterLibrary({ type: 'create', name: '测试棋友' });
    const channel = (await window.limea.listModelServices())
      .flatMap((item) => item.channels)
      .find((item) => item.providerId === 'deepseek');
    const model = channel.models[0];
    await window.limea.saveModelSettings({
      name: '五子棋本机验证',
      providerId: channel.providerId,
      protocol: 'chat-completions',
      baseURL,
      makeActive: true,
      apiKey: 'local-test-only',
      defaultOfferingId: model.offeringId,
      models: [{ offeringId: model.offeringId, settings: { maxOutputTokens: 2048 } }],
    });
  }, url);
  await page.reload();
  let ws = await openGame(page);
  const cards = ws.locator('.conversation-character-picker .character-tile');
  const selectedIndex = await cards.evaluateAll((elements) =>
    elements.findIndex((element) => element.textContent.includes('测试棋友')),
  );
  assert.ok(selectedIndex >= 0);
  await ws.locator('.character-tile[aria-pressed=true]').press('Home');
  for (let index = 0; index < selectedIndex; index++) await page.keyboard.press('ArrowRight');
  await ws.locator('.gomoku .model .name').filter({ hasText: '测试棋友' }).waitFor();
  await ws.getByRole('button', { name: '开始对局', exact: true }).click();
  await human(page);
  assert.ok(forced, 'missing start tool call retried');
  const waiting = requests;
  await delay(850);
  assert.equal(requests, waiting, 'no model requests during human turn');
  for (const column of 'ABCDE') {
    await human(page);
    const previous = saved().moves.length;
    const sounds = await page.evaluate(() => window.gomokuAudioProbe.count);
    if (column === 'A') holdMove = true;
    await ws.getByRole('button', { name: `落子于 ${column}8`, exact: true }).click();
    if (column === 'A') {
      await ws.locator('.gomoku[data-turn=model]').waitFor();
      assert.equal(await ws.getByRole('button', { name: '认输', exact: true }).isDisabled(), true);
      assert.equal(
        await ws.getByRole('button', { name: '结束游戏', exact: true }).isDisabled(),
        true,
      );
      const state = saved();
      const sessionId = await page.evaluate(
        async () =>
          (await window.limea.listSessions({ conversationMode: 'chat' })).items[0].sessionId,
      );
      assert.ok(sessionId);
      for (const action of ['resign', 'quit']) {
        await assert.rejects(
          page.evaluate(
            async (payload) =>
              window.limea.pluginCommand({
                pluginId: 'games.gomoku',
                method: 'match-action',
                payload,
              }),
            {
              mode: 'chat',
              sessionId,
              matchId: state.matchId,
              roundId: state.roundId,
              revision: state.revision,
              action,
            },
          ),
        );
      }
      assert.deepEqual(saved(), state, 'blocked controls must not invalidate the in-flight move');
      releaseMove();
    }
    if (column !== 'E') {
      await ws.locator(`.gomoku[data-moves="${previous + 2}"][data-turn=human]`).waitFor();
      if (column === 'A') {
        await page.waitForFunction((count) => window.gomokuAudioProbe.count === count + 2, sounds);
        const sound = await page.evaluate(() => window.gomokuAudioProbe);
        assert.ok(sound.duration > 0.1 && sound.duration < 0.4, 'packaged MP3 decoded and played');
        await ws.getByRole('button', { name: '同步棋局', exact: true }).click();
        assert.equal(
          (await page.evaluate(() => window.gomokuAudioProbe)).count,
          sound.count,
          'sync must not replay stones',
        );
        await ws.getByRole('button', { name: '声音开', exact: true }).click();
      } else if (column === 'B') {
        assert.equal(
          (await page.evaluate(() => window.gomokuAudioProbe)).count,
          sounds,
          'mute suppresses both players',
        );
        await ws.getByRole('button', { name: '声音关', exact: true }).click();
      }
      if (column === 'C')
        await ws.locator('.gomoku').screenshot({ path: join(artifacts, 'gomoku-playing.png') });
    }
  }
  await ws.locator('.gomoku[data-status=round-over]').waitFor();
  assert.equal(saved().winner, 'human');
  assert.equal(saved().scores.human, 1);
  assert.equal(await ws.locator('.cell[data-win=true]').count(), 5);
  assert.equal(
    await ws.getByRole('button', { name: '下次再玩', exact: true }).isDisabled(),
    true,
    'leaving waits until the model result response finishes',
  );
  for (const name of ['再来一局', '下次再玩']) {
    const choice = ws.getByRole('button', { name, exact: true });
    assert.ok(await choice.isVisible(), `${name} must appear before the model finishes`);
    assert.ok(
      await choice.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > innerHeight) return false;
        for (let parent = button.parentElement; parent; parent = parent.parentElement) {
          const { overflowY } = getComputedStyle(parent);
          const clip = parent.getBoundingClientRect();
          if (
            /auto|scroll|hidden|clip/.test(overflowY) &&
            (rect.top < clip.top || rect.bottom > clip.bottom)
          )
            return false;
        }
        return true;
      }),
      `${name} must be inside the visible panel without scrolling`,
    );
  }
  await ws.locator('.gomoku').screenshot({ path: join(artifacts, 'gomoku-result.png') });
  await ws.getByRole('button', { name: '再来一局', exact: true }).click();
  await ws.getByText('已选择再来一局，等待角色回应后开局。', { exact: true }).waitFor();
  assert.equal(saved().replayRequested, true, 'early replay choice must be saved');
  assert.equal(saved().roundNumber, 1, 'do not advance before the result response');
  releaseResult();
  await human(page);
  await ws.getByRole('button', { name: '认输', exact: true }).click();
  await ws.locator('.gomoku[data-status=waiting-replay]').waitFor();
  assert.deepEqual(saved().scores, { human: 1, model: 1, draw: 0 });
  await ws.getByRole('button', { name: '下次再玩', exact: true }).click();
  await ws.locator('.gomoku[data-status=ended]').waitFor();
  await ws.getByText('好呀，下次再一起下棋。', { exact: true }).waitFor();
  await ws.getByRole('button', { name: '开始对局', exact: true }).click();
  const before = await human(page);
  await ws.getByRole('button', { name: '落子于 H8', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await ws.locator(`.gomoku[data-moves="${before.moves.length + 2}"][data-turn=human]`).waitFor();
  const preserved = saved();
  assert.ok(
    preserved.moves.some(
      (move) => move.player === 'human' && move.column === 'I' && move.row === 8,
    ),
  );
  await app.close();
  app = undefined;
  page = await launch();
  ws = await openGame(page);
  if (!(await ws.locator('.gomoku[data-status=paused]').count())) {
    const session = await page.evaluate(
      async () => (await window.limea.listSessions({ conversationMode: 'chat' })).items[0],
    );
    await ws.getByText(session.title, { exact: true }).first().click();
    ws = await openGame(page);
  }
  await ws.locator('.gomoku[data-status=paused]').waitFor();
  assert.equal(
    (await page.evaluate(() => window.gomokuAudioProbe)).count,
    0,
    'restoring a board must be silent',
  );
  assert.equal(saved().roundId, preserved.roundId);
  assert.deepEqual(saved().moves, preserved.moves);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1000, height: 950 }),
  );
  await ws.locator('.gomoku').screenshot({ path: join(artifacts, 'gomoku-narrow.png') });
  assert.ok(
    await ws
      .locator('.gomoku')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  );
  await ws.getByRole('button', { name: '继续对局', exact: true }).click();
  await human(page);
  await ws.getByRole('button', { name: '结束游戏', exact: true }).click();
  await ws.locator('.gomoku[data-status=ended]').waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  assert.equal(missMove, false);
  assert.equal(invalidMove, false);
  console.log(
    JSON.stringify({
      result: 'passed',
      requests,
      validatedBoards,
      missingToolRetry: true,
      illegalMoveRetry: true,
      humanWait: true,
      win: true,
      replay: true,
      immediateResultChoices: true,
      resign: true,
      quit: true,
      restart: true,
      noOverflow: true,
      sound: true,
      mute: true,
      turnControls: true,
    }),
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
    console.log((await page.locator('body').innerText()).slice(-2000));
    console.log('audio probe:', await page.evaluate(() => window.gomokuAudioProbe));
  }
  throw error;
} finally {
  releaseResult();
  releaseMove();
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(join(artifacts, 'runtime.log'), logs.join(''));
  assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), 'limea-gomoku-e2e-'))));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

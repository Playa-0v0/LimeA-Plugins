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
const sharp = requireHost('sharp');
const { readProtocolStream } = await import(
  pathToFileURL(join(host, 'tests/fixtures/read-protocol-stream.ts'))
);
const { protocolStream } = await import(
  pathToFileURL(join(host, 'tests/fixtures/model-protocol-stream.ts'))
);
const plugin = fileURLToPath(new URL('..', import.meta.url));
const artifacts = join(plugin, 'artifacts');
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'limea-draw-guess-')),
  profile = join(root, 'profile');
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
let app,
  images = 0,
  draws = 0,
  guesses = 0,
  privateRequests = 0;
let modelSawFill = false;
const logs = [],
  errors = [],
  serverErrors = [],
  publicRequests = [];
let releaseGuess, releaseDrawing, releaseWords;
const wordGate = new Promise((resolve) => {
  releaseWords = resolve;
});
const guessGate = new Promise((resolve) => {
  releaseGuess = resolve;
});
const drawingGate = new Promise((resolve) => {
  releaseDrawing = resolve;
});
function saved() {
  const db = new DatabaseSync(
    join(profile, 'storage/plugin-data/games.draw_guess/databases/game.sqlite'),
    { readOnly: true },
  );
  try {
    return JSON.parse(
      db.prepare('SELECT state FROM games ORDER BY rowid DESC LIMIT 1').get()?.state ?? 'null',
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
    const names = (body.tools ?? []).map((tool) => tool.function.name),
      responseName = names.find((name) => name.endsWith('_respond'));
    let stream;
    if (responseName) {
      privateRequests++;
      assert.equal(names.length, 1);
      assert.equal(
        body.messages.filter((m) => m.role === 'user').length,
        1,
        'private task never inherits chat history',
      );
      const user = body.messages.find((m) => m.role === 'user');
      const text =
        typeof user.content === 'string'
          ? user.content
          : user.content
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join('');
      let value;
      if (text.includes('独立出题员')) {
        assert.equal(body.messages.filter((m) => m.role === 'system').length, 0);
        await wordGate;
        value = { words };
      } else if (text.includes('秘密候选')) value = { choice: 1 };
      else {
        const attachment = user.content.find((p) => p.type === 'image_url');
        assert.ok(attachment, 'actual rendered image is sent');
        images++;
        const data = Buffer.from(attachment.image_url.url.split(',')[1], 'base64');
        const metadata = await sharp(data).metadata();
        assert.equal(metadata.width, 800);
        assert.equal(metadata.height, 600);
        if (text.includes('你是猜测者')) {
          assert.match(text, /字数提示：标准题目共2个字/);
          guesses++;
          if (guesses > 1) {
            const pixel = await sharp(data)
              .extract({ left: 750, top: 550, width: 1, height: 1 })
              .removeAlpha()
              .raw()
              .toBuffer();
            if (pixel[0] === 239 && pixel[1] === 68 && pixel[2] === 68) modelSawFill = true;
          }
          const state = saved();
          for (const choice of state.choices)
            assert.ok(
              !JSON.stringify(body).includes(choice.word),
              'hidden candidates never enter guessing request',
            );
          const stats = await sharp(data).stats();
          assert.ok(
            stats.channels.some((c) => c.min < 100),
            'user drawing is in snapshot',
          );
          if (guesses === 1) await guessGate;
          value = { guess: guesses === 1 ? state.answer.word : '' };
        } else {
          draws++;
          if (draws === 2) {
            const stats = await sharp(data).stats();
            assert.ok(
              stats.channels.some((c) => c.min < 100),
              'model sees its own real rendered drawing',
            );
            await drawingGate;
          }
          value = {
            add: [
              {
                kind: 'ellipse',
                x: 230,
                y: 170,
                width: 280,
                height: 250,
                points: [],
                color: '#222222',
                fill: 'transparent',
                strokeWidth: 5,
              },
            ],
            remove: [],
            done: false,
          };
        }
      }
      stream = readProtocolStream('chat-completions', value, {
        name: responseName,
        callId: `private-${privateRequests}`,
      });
    } else {
      publicRequests.push(body);
      const lastUser = body.messages.findLastIndex(
        (message) =>
          message.role === 'user' && JSON.stringify(message.content).includes('一起玩你画我猜吧'),
      );
      if (body.messages.slice(lastUser + 1).some((message) => message.role === 'tool'))
        stream = protocolStream('chat-completions', {
          chunks: ['这几幅画真有意思，下次再一起画。'],
        });
      else
        stream = readProtocolStream(
          'chat-completions',
          {},
          { name: names.find((name) => name.endsWith('_play')), callId: 'open-game' },
        );
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(stream);
  } catch (error) {
    serverErrors.push(error.stack);
    res.writeHead(500);
    res.end('{}');
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
  app.process().stdout?.on('data', (v) => logs.push(v.toString()));
  app.process().stderr?.on('data', (v) => logs.push(v.toString()));
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) logs.push(message.text());
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
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1500, height: 1040 }),
  );
  return page;
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error('condition timed out');
}
async function openGame(page) {
  const ws = page.locator('.workspace-root:visible');
  await ws.locator('.cy-mode-switch').getByText('Chat', { exact: true }).click();
  if (
    (await ws.locator('.workspace-content-layout').getAttribute('data-details-collapsed')) ===
    'true'
  )
    await ws.locator('.cy-sidebar-toggle[data-side=right]').click();
  if (await ws.locator('.draw-guess').count()) return ws;
  if (await ws.getByRole('button', { name: '小游戏', exact: true }).count())
    await ws.getByRole('button', { name: '小游戏', exact: true }).click();
  await ws.getByRole('button', { name: '你画我猜', exact: true }).click();
  await ws.locator('.draw-guess').waitFor();
  return ws;
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
    await window.limea.setSearchPluginEnabled({ pluginId: 'games.draw_guess', enabled: true });
    const channel = (await window.limea.listModelServices())
      .flatMap((item) => item.channels)
      .find((item) => item.providerId === 'openai');
    const model = channel.models.find((item) => item.supportsVision);
    if (!model) throw new Error('No vision model fixture');
    await window.limea.saveModelSettings({
      name: '画板本机验证',
      providerId: channel.providerId,
      protocol: 'chat-completions',
      baseURL,
      makeActive: true,
      apiKey: 'local-test-only',
      defaultOfferingId: model.offeringId,
      models: [{ offeringId: model.offeringId, settings: { maxOutputTokens: 4096 } }],
    });
  }, url);
  await page.reload();
  await page.evaluate(() => {
    window.__drawingAudio = { decoded: 0, sources: [] };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (...args) {
      const result = await decode.apply(this, args);
      window.__drawingAudio.decoded++;
      return result;
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args),
        record = { started: false, stopped: false, loop: false };
      window.__drawingAudio.sources.push(record);
      const start = source.start,
        stop = source.stop;
      source.start = function (...args) {
        record.started = true;
        record.loop = source.loop;
        return start.apply(this, args);
      };
      source.stop = function (...args) {
        record.stopped = true;
        return stop.apply(this, args);
      };
      source.addEventListener('ended', () => {
        record.stopped = true;
      });
      return source;
    };
  });
  let ws = await openGame(page);
  let game = ws.locator('.draw-guess');
  await game.getByRole('button', { name: '开始游戏', exact: true }).click();
  await game.getByText('请稍等，正在出题中…', { exact: true }).waitFor();
  await ws.locator('.draw-guess[data-phase=preparing]').waitFor();
  assert.equal(await game.locator('.play-content').evaluate((node) => node.inert), true);
  await page.screenshot({ path: join(artifacts, 'preparing.png') });
  releaseWords();
  await game.locator('.word-choice').first().waitFor();
  await page.screenshot({ path: join(artifacts, 'choose.png') });
  const choices = [...saved().choices];
  await game.locator('.word-choice').first().click();
  await ws.locator('.draw-guess[data-phase=drawing]').waitFor();
  await game.getByText('字数提示：2 个字', { exact: true }).waitFor();
  assert.equal(await game.getByRole('button', { name: '开始画画', exact: true }).count(), 0);
  const pen = game.getByRole('button', { name: '画笔', exact: true });
  assert.equal(await pen.locator('svg').count(), 1);
  assert.equal(await pen.innerText(), '');
  const thickness = game.getByRole('slider', { name: '笔画粗细', exact: true });
  await thickness.focus();
  await thickness.press('ArrowRight');
  await until(async () => (await thickness.getAttribute('aria-valuenow')) === '5');
  const board = game.locator('.canvas-surface');
  const box = await board.boundingBox();
  assert.ok(box);
  async function stroke(offset) {
    await page.mouse.move(box.x + 70, box.y + 100 + offset);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 180 + offset, { steps: 12 });
    await page.mouse.up();
  }
  await page.mouse.move(box.x + 70, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 180, { steps: 12 });
  await until(() => guesses === 1);
  await page.mouse.up();
  await stroke(30);
  await until(() => saved().scene.shapes.length === 2);
  assert.equal(saved().scene.shapes[1].strokeWidth, 5);
  await page.keyboard.press('Control+z');
  await until(() => saved().scene.shapes.length === 1);
  await page.keyboard.press('Control+y');
  await until(() => saved().scene.shapes.length === 2);
  const composer = ws.locator('textarea').first();
  await composer.focus();
  await page.keyboard.press('Control+z');
  assert.equal(saved().scene.shapes.length, 2, 'composer focus does not undo canvas strokes');
  const worldClick = async (x, y) =>
    page.mouse.click(box.x + (x * box.width) / 800, box.y + (y * box.height) / 600);
  const pixelAt = async (x, y) =>
    board
      .locator('canvas')
      .evaluate(
        (canvas, [x, y]) =>
          Array.from(
            canvas
              .getContext('2d')
              .getImageData(
                Math.floor((x * canvas.width) / 800),
                Math.floor((y * canvas.height) / 600),
                1,
                1,
              ).data,
          ).slice(0, 3),
        [x, y],
      );
  // Close a freehand contour rather than relying on a pre-filled rectangle.
  await pen.click();
  await page.mouse.move(box.x + (350 * box.width) / 800, box.y + (160 * box.height) / 600);
  await page.mouse.down();
  for (const [x, y] of [
    [650, 160],
    [650, 430],
    [350, 430],
    [350, 160],
  ])
    await page.mouse.move(box.x + (x * box.width) / 800, box.y + (y * box.height) / 600, {
      steps: 12,
    });
  await page.mouse.up();
  await until(() => saved().scene.shapes.length === 3);
  await game.getByLabel('画笔颜色', { exact: true }).fill('#ef4444');
  await game.getByRole('button', { name: '颜料桶', exact: true }).click();
  await worldClick(500, 300);
  await until(() => saved().scene.shapes.length === 4);
  assert.equal(saved().scene.shapes[3].kind, 'fill');
  assert.deepEqual(await pixelAt(500, 300), [239, 68, 68]);
  assert.deepEqual(await pixelAt(740, 520), [255, 255, 255]);
  await delay(50);
  const beforeNoop = await page.evaluate(() => window.__drawingAudio.sources.length);
  await worldClick(500, 300);
  await delay(350);
  assert.equal(saved().scene.shapes.length, 4, 'same colour does not add a fill');
  assert.equal(
    await page.evaluate(() => window.__drawingAudio.sources.length),
    beforeNoop,
    'no-op fill stays silent',
  );
  await page.keyboard.press('Control+z');
  await until(() => saved().scene.shapes.length === 3);
  assert.deepEqual(await pixelAt(500, 300), [255, 255, 255]);
  await page.keyboard.press('Control+y');
  await until(() => saved().scene.shapes.length === 4);
  assert.deepEqual(await pixelAt(500, 300), [239, 68, 68]);
  await game.getByRole('button', { name: '橡皮', exact: true }).click();
  await worldClick(500, 160);
  await until(() => saved().scene.shapes.length === 3);
  assert.deepEqual(await pixelAt(500, 300), [239, 68, 68]);
  assert.deepEqual(
    await pixelAt(740, 520),
    [255, 255, 255],
    'removing contour never spreads a saved fill',
  );
  await page.keyboard.press('Control+z');
  await until(() => saved().scene.shapes.length === 4);
  await game.getByLabel('画笔颜色', { exact: true }).fill('#3366cc');
  await game.getByRole('button', { name: '颜料桶', exact: true }).click();
  await worldClick(740, 520);
  await until(() => saved().scene.shapes.length === 5);
  assert.deepEqual(
    await pixelAt(20, 20),
    [51, 102, 204],
    'open strokes do not seal the surrounding region',
  );
  assert.deepEqual(await pixelAt(500, 300), [239, 68, 68]);
  await page.keyboard.press('Control+z');
  await until(() => saved().scene.shapes.length === 4);
  const audio = await page.evaluate(() => window.__drawingAudio);
  assert.ok(
    audio.decoded >= 5 && audio.decoded % 5 === 0,
    'all packaged Ogg assets decode in Electron, including panel remounts',
  );
  assert.ok(audio.sources.some((source) => source.started && source.loop));
  assert.ok(
    audio.sources.filter((source) => source.loop).every((source) => source.stopped),
    'pen loops stop after release',
  );
  await game.locator('.sound-settings summary').click();
  await game.getByLabel('启用音效', { exact: true }).uncheck();
  const mutedCount = await page.evaluate(() => window.__drawingAudio.sources.length);
  await game.getByRole('button', { name: '撤销', exact: true }).click();
  await until(() => saved().scene.shapes.length === 3);
  await game.getByRole('button', { name: '重做', exact: true }).click();
  await until(() => saved().scene.shapes.length === 4);
  assert.equal(await page.evaluate(() => window.__drawingAudio.sources.length), mutedCount);
  await game.getByLabel('启用音效', { exact: true }).check();
  await game.getByLabel('画笔声音', { exact: true }).uncheck();
  await game.getByLabel('音效音量', { exact: true }).fill('20');
  await page.screenshot({ path: join(artifacts, 'bucket-and-audio.png') });
  await game.locator('.sound-settings summary').click();
  await page.screenshot({ path: join(artifacts, 'toolbar.png') });
  assert.equal(
    await game.getByRole('button', { name: '画笔', exact: true }).isEnabled(),
    true,
    'model thinking does not lock user drawing',
  );
  releaseGuess();
  await game.getByText(`猜中了！ · ${saved().answer.word}`, { exact: true }).waitFor();
  await game.getByRole('button', { name: '再来一轮', exact: true }).click();
  await until(() => draws === 2);
  assert.equal(await game.locator('.private-word').isVisible(), false);
  await game.getByText('字数提示：2 个字', { exact: true }).waitFor();
  const state = saved();
  assert.ok(state.choices.every((item) => !choices.some((prior) => item.word === prior.word)));
  await page.screenshot({ path: join(artifacts, 'model-drawing.png') });
  await game.getByRole('textbox', { name: '你的猜测', exact: true }).fill(state.answer.word);
  await game.getByRole('button', { name: '猜一下', exact: true }).click();
  await game.getByText(`猜中了！ · ${state.answer.word}`, { exact: true }).waitFor();
  releaseDrawing();
  await delay(200);
  assert.equal(saved().scene.shapes.length, 1, 'late drawing discarded');
  await game.getByRole('button', { name: '下次再玩', exact: true }).click();
  await ws
    .getByTestId('limea-workspace-v2-chat')
    .getByText('这几幅画真有意思，下次再一起画。', { exact: true })
    .waitFor();
  const publicText = JSON.stringify(publicRequests);
  for (const unused of choices.slice(1)) assert.ok(!publicText.includes(unused.word));
  assert.ok(!publicText.includes('独立出题员'));
  assert.ok(!publicText.includes('私密题目'));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1080, height: 850 }),
  );
  await page.screenshot({ path: join(artifacts, 'result-narrow.png') });
  const overflows = await game.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  assert.equal(overflows, false);
  await game.getByRole('button', { name: '开始游戏', exact: true }).click();
  await game.locator('.word-choice').first().click();
  await ws.locator('.draw-guess[data-phase=drawing]').waitFor();
  const nextBox = await game.locator('.canvas-surface').boundingBox();
  await game.getByRole('button', { name: '画笔', exact: true }).click();
  await page.mouse.move(nextBox.x + 40, nextBox.y + 70);
  await page.mouse.down();
  await page.mouse.move(nextBox.x + 110, nextBox.y + 100, { steps: 8 });
  await page.mouse.up();
  await until(() => saved().scene.shapes.length === 1);
  await game.getByLabel('画笔颜色', { exact: true }).fill('#ef4444');
  await game.getByRole('button', { name: '颜料桶', exact: true }).click();
  await page.mouse.click(nextBox.x + nextBox.width * 0.8, nextBox.y + nextBox.height * 0.8);
  await until(() => saved().scene.shapes.length === 2);
  await until(() => modelSawFill);
  await game.getByRole('button', { name: '暂停', exact: true }).click();
  await ws.locator('.draw-guess[data-phase=paused]').waitFor();
  const preserved = saved(),
    beforeRestart = privateRequests;
  await app.close();
  app = undefined;
  page = await launch();
  ws = await openGame(page);
  if (!(await ws.locator('.draw-guess[data-phase=paused]').count())) {
    const session = await page.evaluate(
      async () => (await window.limea.listSessions({ conversationMode: 'chat' })).items[0],
    );
    await ws.getByText(session.title, { exact: true }).first().click();
    ws = await openGame(page);
  }
  game = ws.locator('.draw-guess');
  await ws.locator('.draw-guess[data-phase=paused]').waitFor();
  assert.equal(privateRequests, beforeRestart, 'restart never resends a private request');
  assert.equal(saved().id, preserved.id);
  assert.deepEqual(saved().scene, preserved.scene);
  assert.deepEqual(saved().choices, preserved.choices);
  assert.equal(
    saved().scene.shapes[1].kind,
    'fill',
    'fill masks survive a full application restart',
  );
  await game.locator('.sound-settings summary').click();
  assert.equal(await game.getByLabel('画笔声音', { exact: true }).isChecked(), false);
  assert.equal(await game.getByLabel('音效音量', { exact: true }).inputValue(), '20');
  await game.locator('.sound-settings summary').click();
  await game.getByRole('button', { name: '继续这一轮', exact: true }).click();
  await ws.locator('.draw-guess[data-phase=drawing]').waitFor();
  assert.equal(saved().answer.word, preserved.answer.word);
  await page.screenshot({ path: join(artifacts, 'restored.png') });
  await game.getByRole('button', { name: '结束游戏', exact: true }).click();
  await ws.locator('.draw-guess[data-phase=ended]').waitFor();
  assert.deepEqual(serverErrors, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      images,
      draws,
      guesses,
      privateRequests,
      humanDrawingDuringRequest: true,
      modelSeesDrawing: true,
      secretsIsolated: true,
      immediateResult: true,
      lateDrawingDiscarded: true,
      narrow: true,
      midStrokeObservation: true,
      restart: true,
      wordCountHints: true,
      autoStartOnChoice: true,
      preparationOverlay: true,
      iconToolbarAndSlider: true,
      undoRedoShortcuts: true,
      closedAndOpenFill: true,
      stableFillAfterErase: true,
      fillUndoRedoAndRestart: true,
      modelSawFill,
      decodedSounds: 5,
      soundMuteAndPreferences: true,
    }),
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
    console.log((await page.locator('body').innerText()).slice(-3000));
  }
  console.log(serverErrors);
  throw error;
} finally {
  releaseWords();
  releaseGuess();
  releaseDrawing();
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(join(artifacts, 'runtime.log'), logs.join('\n'));
  assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), 'limea-draw-guess-'))));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

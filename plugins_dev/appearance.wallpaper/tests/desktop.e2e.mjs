import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const host = process.env.LIMEA_REPO_DIR;
assert.ok(host && process.env.LIMEA_TEST_APP_DIR, 'Set host paths');
const requireHost = createRequire(join(host, 'package.json'));
const { _electron: electron } = requireHost('playwright');
const plugin = fileURLToPath(new URL('..', import.meta.url));
const artifacts = join(plugin, 'artifacts');
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'limea-wallpaper-e2e-'));
const profile = join(root, 'profile');
const web = join(root, 'web');
await mkdir(web);
await sharp({ create: { width: 1280, height: 800, channels: 3, background: '#185c74' } })
  .png()
  .toFile(join(root, 'image.png'));
await writeFile(
  join(web, 'project.json'),
  JSON.stringify({ title: 'Web fixture', type: 'web', file: 'index.html', preview: 'preview.png' }),
);
await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#84654a' } })
  .png()
  .toFile(join(web, 'preview.png'));
await writeFile(
  join(web, 'index.html'),
  '<!doctype html><style>body{margin:0;background:#8d4071;color:white;font:40px system-ui}div{padding:100px;animation:p 2s infinite alternate}@keyframes p{to{transform:translateX(50px)}}</style><div id="web-fixture">Web wallpaper</div>',
);
let app, page;
const messages = [];
const command = (method, payload) =>
  page.evaluate(
    async ({ method, payload }) =>
      (
        await window.limea.pluginCommand({
          pluginId: 'appearance.wallpaper',
          method,
          ...(payload === undefined ? {} : { payload }),
        })
      ).result,
    { method, payload },
  );
async function launch() {
  const env = { ...process.env, LIMEA_USER_DATA_DIR: profile, LIMEA_DISABLE_SANDBOX_SETUP: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  app = await electron.launch({
    executablePath: requireHost('electron'),
    args: [resolve(process.env.LIMEA_TEST_APP_DIR)],
    env,
  });
  app.process().stderr?.on('data', (value) => messages.push(value.toString()));
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      messages.push(
        m
          .text()
          .replace(/data:font\/woff2;base64,[^']+/, '[inline font]')
          .slice(0, 500),
      );
  });
  page.on('pageerror', (e) => messages.push(e.message));
  await page.waitForFunction(async () => {
    try {
      return (
        (await window.limea.getStartupState()).phase === 'shell-ready' &&
        (await window.limea.getPluginSettings())
      );
    } catch {
      return false;
    }
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1200, height: 850 }),
  );
  await page.evaluate(() => window.limea.getPluginSettings());
}
async function pick(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await command('pick');
}
async function active() {
  await page.waitForFunction(
    () => document.documentElement.dataset.backgroundActive === 'wallpaper',
    null,
    { timeout: 60000 },
  );
  assert.equal((await command('list')).error, null);
}
try {
  await launch();
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    },
    join(plugin, 'dist'),
  );
  await page.evaluate(async () => {
    await window.limea.importPlugin();
    await window.limea.setPluginEnabled({ pluginId: 'appearance.wallpaper', enabled: true });
    // Enable typing for visual checks; this local-only profile never sends a model request.
    const channel = (await window.limea.listModelServices())
      .flatMap((vendor) => vendor.channels)
      .find((entry) => entry.providerId === 'deepseek');
    await window.limea.saveModelSettings({
      name: '壁纸界面检查',
      providerId: 'deepseek',
      protocol: 'chat-completions',
      defaultOfferingId: channel.defaultOfferingId,
      models: [{ offeringId: channel.defaultOfferingId, settings: { maxOutputTokens: 8192 } }],
      apiKey: 'local-wallpaper-preview-only',
      baseURL: 'http://127.0.0.1:1',
    });
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.limea));
  await pick(join(root, 'image.png'));
  await active();
  let player = page.frames().find((f) => f.url().includes('/runtime/index.html'));
  await player.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1280);
  assert.equal(await player.evaluate(() => typeof window.limea), 'undefined');
  await page.screenshot({ path: join(artifacts, 'image.png') });
  await command('configure', { opacity: 0.7, shellDim: 0.55, blur: 18, fps: 15 });
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--ui-wallpaper-blur') === '18px',
  );
  await app.close();
  await launch();
  await active();
  assert.equal((await command('list')).settings.blur, 18);
  assert.equal((await command('list')).settings.shellDim, 0.55);
  if (process.env.LIMEA_TEST_VIDEO) {
    await pick(process.env.LIMEA_TEST_VIDEO);
    await page.waitForFunction(() => !document.documentElement.dataset.backgroundActive);
    await active();
    player = page.frames().find((f) => f.url().includes('/runtime/index.html'));
    await player.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    console.log(
      'minimize',
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          minimized: w.isMinimized(),
          visible: w.isVisible(),
        })),
      ),
      await page.evaluate(() => document.visibilityState),
      await player.evaluate(() => ({
        visibility: document.visibilityState,
        paused: document.querySelector('video')?.paused,
      })),
    );
    await player.waitForFunction(() => document.querySelector('video')?.paused, null, {
      polling: 100,
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await player.waitForFunction(() => !document.querySelector('video')?.paused);
  }
  await pick(join(web, 'project.json'));
  await page.waitForFunction(() => !document.documentElement.dataset.backgroundActive);
  await active();
  await page.waitForFunction(
    () => document.querySelector('.limea-background-layer iframe') !== null,
  );
  const webFrame = await (async () => {
    for (let i = 0; i < 100; i++) {
      const frame = page
        .frames()
        .find(
          (f) =>
            f.url().includes('/index.html') &&
            !f.url().includes('/runtime/') &&
            f.url().startsWith('http://127.0.0.1'),
        );
      if (frame) return frame;
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  assert.ok(webFrame, 'web frame mounted');
  assert.equal(await webFrame.evaluate(() => typeof window.limea), 'undefined');
  await page.screenshot({ path: join(artifacts, 'web.png') });
  if (process.env.LIMEA_TEST_SCENE) {
    await pick(process.env.LIMEA_TEST_SCENE);
    await page.waitForFunction(() => !document.documentElement.dataset.backgroundActive);
    await active();
    player = page.frames().find((f) => f.url().includes('/runtime/index.html'));
    await player.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return c && c.width > 0 && c.height > 0;
    });
    // Capture actual frames, not just an allocated canvas or a ready promise.
    for (let i = 0; i < 30; i++) {
      const png = await player.locator('canvas').first().screenshot();
      const stats = await sharp(png).stats();
      if (stats.entropy > 2) break;
      assert.ok(i < 29, 'scene must render non-blank pixels');
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.screenshot({ path: join(artifacts, 'scene.png') });
  }
  await page.locator('.workspace-root:visible .sidebar-settings').click();
  await page
    .locator('.settings-navigation:visible')
    .getByRole('button', { name: '外观', exact: true })
    .click();
  await page.locator('.settings-appearance-colors').waitFor();
  await page.screenshot({
    path: join(artifacts, 'appearance-glass-on.png'),
    animations: 'disabled',
  });
  await page
    .locator('.settings-navigation:visible')
    .getByRole('button', { name: '插件', exact: true })
    .click();
  const card = page.locator('.plugin-manager-card').filter({ hasText: '壁纸与玻璃外观' });
  await card.waitFor();
  await page.screenshot({ path: join(artifacts, 'settings-page.png'), animations: 'disabled' });
  await card.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '壁纸与玻璃外观 · 设置' });
  await dialog.getByRole('button', { name: '选择文件', exact: true }).waitFor();
  const library = dialog.getByRole('list', { name: '壁纸库', exact: true });
  await library.locator('img:not([hidden])').first().waitFor();
  const imageCard = library.getByRole('button', { name: 'image.png · 图片', exact: true });
  const webCard = library.getByRole('button', { name: 'Web fixture · 网页', exact: true });
  await imageCard.locator('img:not([hidden])').waitFor();
  await webCard.locator('img:not([hidden])').waitFor();
  for (const card of [imageCard, webCard]) {
    const size = await card
      .locator('img')
      .evaluate((el) => ({ width: el.naturalWidth, height: el.naturalHeight, src: el.src }));
    assert.ok(size.width > 0 && size.width <= 320 && size.height <= 180);
    assert.ok(size.src.startsWith('data:image/webp;base64,'));
  }
  await imageCard.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.plugin-settings-content')
        .shadowRoot.querySelector('.wallpaper-item[aria-pressed="true"]')?.title === 'image.png',
  );
  assert.equal((await command('playback')).item.title, 'image.png');
  await webCard.focus();
  await webCard.press('Enter');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.plugin-settings-content')
        .shadowRoot.querySelector('.wallpaper-item[aria-pressed="true"]')?.title === 'Web fixture',
  );
  assert.equal((await command('playback')).item.title, 'Web fixture');
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: join(artifacts, 'wallpaper-preview-grid.png'),
    animations: 'disabled',
  });
  assert.equal(await dialog.locator('[data-plugin-settings-control]').count(), 11);
  const fps = dialog.getByRole('combobox', { name: '帧率上限', exact: true });
  await fps.focus();
  await fps.press('Space');
  await page.getByRole('listbox').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement?.textContent === '60');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('[aria-label="帧率上限"]')?.textContent?.trim() === '60',
  );
  assert.equal((await command('list')).settings.fps, 60);
  await fps.focus();
  await fps.press('Space');
  await page.getByRole('listbox').waitFor();
  await page.screenshot({ path: join(artifacts, 'settings-host-select.png') });
  await page.keyboard.press('Escape');
  assert.equal(
    await dialog.isVisible(),
    true,
    'Escape closes the select before the settings dialog',
  );
  assert.equal(await fps.evaluate((el) => document.activeElement === el), true);
  await fps.press('Tab');
  assert.equal(
    await dialog
      .getByRole('combobox', { name: '填充方式', exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  const shellDim = dialog.getByRole('slider', { name: '外框加深', exact: true });
  assert.equal(
    await shellDim.getAttribute('aria-valuenow'),
    '0.55',
    'frame shading must survive restart',
  );
  await shellDim.scrollIntoViewIfNeeded();
  const thumbBox = await shellDim.boundingBox();
  const trackBox = await shellDim.evaluate((el) => {
    const rect = el
      .closest('[data-slot="slider"]')
      .querySelector('[data-slot="slider-track"]')
      .getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  });
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trackBox.x + trackBox.width * 0.45, thumbBox.y + thumbBox.height / 2, {
    steps: 5,
  });
  const draggedValue = Number(await shellDim.getAttribute('aria-valuenow'));
  assert.notEqual(draggedValue, 0.55);
  assert.equal(
    (await command('list')).settings.shellDim,
    0.55,
    'dragging previews without saving until release',
  );
  await page.mouse.up();
  await page.waitForFunction(
    (value) =>
      document.documentElement.style.getPropertyValue('--ui-wallpaper-shell-dim') === String(value),
    draggedValue,
  );
  assert.equal((await command('list')).settings.shellDim, draggedValue);
  await shellDim.focus();
  await shellDim.press('Home');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--ui-wallpaper-shell-dim') === '0',
  );
  await shellDim.press('End');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--ui-wallpaper-shell-dim') === '0.8',
  );
  assert.equal((await command('list')).settings.shellDim, 0.8);
  await command('configure', { shellDim: 0.35 });
  assert.notEqual(
    await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  const glass = dialog.getByRole('switch', { name: '玻璃外观', exact: true });
  await glass.uncheck();
  await page.waitForFunction(() => document.documentElement.dataset.backgroundGlass === 'false');
  assert.equal((await command('list')).settings.glass, false, 'glass choice must be saved');
  assert.equal(await glass.isChecked(), false, 'saved state must not turn the checkbox back on');
  assert.equal(
    await page
      .locator('.limea-background-layer')
      .evaluate((el) => getComputedStyle(el, '::after').backdropFilter),
    'none',
    'turning glass off must remove blur',
  );
  assert.equal(
    await page
      .locator('.workspace-root:visible .settings-page:visible')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
    'turning glass off must not hide the wallpaper behind an opaque settings page',
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('[data-plugin-settings-control]').count(),
    0,
    'closing settings releases all host controls',
  );
  await page.screenshot({
    path: join(artifacts, 'settings-glass-off.png'),
    animations: 'disabled',
  });
  await page
    .locator('.settings-navigation:visible')
    .getByRole('button', { name: '外观', exact: true })
    .click();
  await page.locator('.settings-appearance-colors').waitFor();
  await page.screenshot({
    path: join(artifacts, 'appearance-glass-off.png'),
    animations: 'disabled',
  });
  await page
    .locator('.settings-navigation:visible')
    .getByRole('button', { name: '插件', exact: true })
    .click();
  await card.getByRole('button', { name: '设置', exact: true }).click();
  await glass.waitFor();
  assert.equal(await glass.isChecked(), false, 'reopening settings must retain glass off');
  await glass.check();
  await page.waitForFunction(() => document.documentElement.dataset.backgroundGlass === 'true');
  assert.equal(
    await page
      .locator('.limea-background-layer')
      .evaluate((el) => getComputedStyle(el, '::after').backdropFilter),
    'blur(18px)',
    'turning glass back on must restore the configured blur',
  );
  await dialog.getByRole('switch', { name: '暂停播放', exact: true }).check();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="暂停播放"]')?.getAttribute('aria-checked') === 'true',
  );
  assert.equal((await command('list')).settings.paused, true);
  assert.equal(
    (await command('list')).settings.fps,
    60,
    'other settings changes must preserve the selected frame rate',
  );
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: join(artifacts, 'settings.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page
    .locator('.workspace-root:visible')
    .getByRole('button', { name: '返回工作区', exact: true })
    .click();
  await page
    .locator('.workspace-root:visible .cy-mode-switch')
    .getByText('Chat', { exact: true })
    .click();
  await page.locator('.workspace-root[data-conversation-mode="chat"]:visible').waitFor();
  await page
    .locator('.workspace-root:visible .cy-composer textarea')
    .fill('输入文字时，也可以看到背景。');
  await page.screenshot({ path: join(artifacts, 'composer-glass-on.png'), animations: 'disabled' });
  await command('configure', { glass: false });
  await page.waitForFunction(() => document.documentElement.dataset.backgroundGlass === 'false');
  await page.screenshot({
    path: join(artifacts, 'composer-glass-off.png'),
    animations: 'disabled',
  });
  await page.locator('.workspace-root:visible button.sidebar-profile:visible').click();
  const profileMenu = page.locator('.sidebar-profile-menu:not(.sidebar-profile-menu-subcontent)');
  await profileMenu.getByRole('menuitem', { name: /界面语言/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('.sidebar-profile-menu-subcontent').waitFor();
  await page.screenshot({
    path: join(artifacts, 'profile-menu-glass-off.png'),
    animations: 'disabled',
  });
  await command('configure', { glass: true });
  await page.waitForFunction(() => document.documentElement.dataset.backgroundGlass === 'true');
  await page.screenshot({
    path: join(artifacts, 'profile-menu-glass-on.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const workspaceRoot = await page.evaluate(
    async () => (await window.limea.getWorkspaces()).defaultWorkspace.root,
  );
  assert.ok(resolve(workspaceRoot).startsWith(resolve(profile) + sep));
  const previewFile = 'wallpaper-tab-preview.md';
  await writeFile(
    join(workspaceRoot, previewFile),
    '# 标签材质预览\n\n选中文件标签后，仍然可以透出壁纸。\n',
  );
  await page
    .locator('.workspace-root:visible .cy-mode-switch')
    .getByText('Work', { exact: true })
    .click();
  await page.locator('.workspace-root[data-conversation-mode="work"]:visible').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1700, 1000));
  const workspace = page.locator('.workspace-root:visible');
  const expandDetails = workspace.getByRole('button', { name: '展开右侧栏', exact: true });
  if (await expandDetails.isVisible()) await expandDetails.click();
  await workspace.getByRole('button', { name: '文件', exact: true }).click();
  await workspace.locator(`[data-key="${previewFile}"]`).click();
  await workspace.getByRole('heading', { name: '标签材质预览', exact: true }).waitFor();
  await page.screenshot({
    path: join(artifacts, 'workspace-tabs-glass-on.png'),
    animations: 'disabled',
  });
  await command('configure', { glass: false });
  await page.waitForFunction(() => document.documentElement.dataset.backgroundGlass === 'false');
  const previewTab = workspace.getByRole('tab', { name: previewFile, exact: true });
  await previewTab.hover();
  await page.screenshot({
    path: join(artifacts, 'workspace-tabs-glass-off.png'),
    animations: 'disabled',
  });
  await previewTab.locator('..').locator('.workspace-tab-close').click();
  await previewTab.waitFor({ state: 'detached' });
  const playback = await command('playback');
  await page.evaluate(async () =>
    window.limea.setPluginEnabled({ pluginId: 'appearance.wallpaper', enabled: false }),
  );
  await page.reload();
  await page.waitForFunction(() => !document.documentElement.dataset.backgroundActive);
  await assert.rejects(fetch(playback.item.runtime + 'index.html'));
  console.log(
    JSON.stringify(
      {
        passed: true,
        tested: [
          'image',
          'web',
          ...(process.env.LIMEA_TEST_SCENE ? ['scene'] : []),
          ...(process.env.LIMEA_TEST_VIDEO ? ['video', 'hidden pause'] : []),
          'settings',
          'preview-grid-selection-thumbnails',
          'host-controls-keyboard-drag-cleanup',
          'glass-toggle',
          'frame-shading-setting',
          'restart',
          'disable',
        ],
        messages,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(messages);
  if (page) {
    console.error(await command('list').catch(() => null));
    await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}

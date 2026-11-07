import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts');
const id = 'games.fixture';
const manifest = (version) => ({
  id,
  name: '测试插件',
  version,
  hostVersion: '>=0.1.0',
  entry: 'backend.mjs',
  permissions: [],
});

async function fixture() {
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'release-test-'));
  for (const path of ['scripts', 'entries', `plugins_dev/${id}`, 'dist'])
    await mkdir(join(directory, path), { recursive: true });
  for (const name of [
    'pack-plugin.mjs',
    'check-catalog.mjs',
    'market-docs.mjs',
    'distribution-files.mjs',
    'prune-releases.mjs',
  ]) {
    await copyFile(join(root, 'scripts', name), join(directory, 'scripts', name));
  }
  await writeFile(
    join(directory, 'README.md'),
    '# 汇总\n\n<!-- plugins:start -->\n\n<!-- plugins:end -->\n',
  );
  await writeFile(join(directory, 'catalog.json'), JSON.stringify({ version: 1, plugins: [] }));
  await writeFile(
    join(directory, 'entries', `${id}.json`),
    JSON.stringify({
      author: '作者',
      description: '测试',
      category: 'games',
      tier: 'official',
      license: 'MIT',
      repository: `plugins_dev/${id}`,
      documentation: `plugins_dev/${id}/README.md`,
    }),
  );
  for (const path of [`plugins_dev/${id}/README.md`, `plugins_dev/${id}/LICENSE`, 'dist/LICENSE'])
    await writeFile(join(directory, path), 'MIT fixture\n');
  await writeFile(join(directory, 'dist/backend.mjs'), 'export default {};\n');
  await writeFile(join(directory, 'dist/limea.plugin.json'), JSON.stringify(manifest('1.0.0')));
  return directory;
}

function run(directory, script, ...args) {
  return spawnSync(process.execPath, [join(directory, 'scripts', script), ...args], {
    cwd: directory,
    encoding: 'utf8',
  });
}

function succeeded(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function cleanup(directory) {
  const inside = relative(artifacts, directory);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('发布保留过渡文件，清理后每个插件仅有一个正式包且不删除源码', async () => {
  const directory = await fixture();
  try {
    succeeded(run(directory, 'pack-plugin.mjs', 'dist', `entries/${id}.json`));
    const first = JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8'));
    assert.equal(first.plugins[0].archive, `plugins/${id}/1.0.0.zip`);
    assert.equal(first.plugins[0].tier, 'official');
    assert.equal(first.plugins[0].license, undefined, '仓库展示字段不能泄漏到严格的宿主清单');
    assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /测试插件/);
    succeeded(run(directory, 'pack-plugin.mjs', 'dist', `entries/${id}.json`));
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8')), first);
    await writeFile(join(directory, 'dist/limea.plugin.json'), JSON.stringify(manifest('1.0.1')));
    succeeded(run(directory, 'pack-plugin.mjs', 'dist', `entries/${id}.json`));
    assert.equal((await readdir(join(directory, 'plugins', id))).length, 2);
    succeeded(run(directory, 'check-catalog.mjs', '--allow-stale'));
    assert.notEqual(run(directory, 'check-catalog.mjs').status, 0);
    succeeded(run(directory, 'prune-releases.mjs'));
    succeeded(run(directory, 'check-catalog.mjs'));
    assert.deepEqual(await readdir(join(directory, 'plugins', id)), ['1.0.1.zip']);
    assert.equal(
      await readFile(join(directory, 'plugins_dev', id, 'LICENSE'), 'utf8'),
      'MIT fixture\n',
    );
  } finally {
    await cleanup(directory);
  }
});

test('拒绝同版本覆盖，校验失败时清理不移除旧文件', async () => {
  const directory = await fixture();
  try {
    succeeded(run(directory, 'pack-plugin.mjs', 'dist', `entries/${id}.json`));
    const original = await readFile(join(directory, 'catalog.json'), 'utf8');
    const archive = join(directory, `plugins/${id}/1.0.0.zip`);
    const bytes = await readFile(archive);
    await writeFile(join(directory, 'dist/backend.mjs'), 'export default { changed: true };\n');
    assert.notEqual(run(directory, 'pack-plugin.mjs', 'dist', `entries/${id}.json`).status, 0);
    assert.equal(await readFile(join(directory, 'catalog.json'), 'utf8'), original);
    assert.deepEqual(await readFile(archive), bytes);
    await writeFile(join(directory, `plugins/${id}/old.zip`), 'fallback');
    await writeFile(archive, 'corrupt');
    assert.notEqual(run(directory, 'prune-releases.mjs').status, 0);
    assert.equal(await readFile(join(directory, `plugins/${id}/old.zip`), 'utf8'), 'fallback');
  } finally {
    await cleanup(directory);
  }
});

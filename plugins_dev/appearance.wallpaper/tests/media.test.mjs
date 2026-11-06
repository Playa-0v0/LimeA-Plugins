import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaServer } from '../src/media-server.mjs';
import { pickedItem, projectItem } from '../src/library.mjs';
import { validateOptions } from '../src/backend.mjs';

test('media streams ranges; capability, file selection and realpath boundaries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wallpaper-media-'));
  const runtime = join(root, 'runtime'),
    assets = join(root, 'assets');
  await mkdir(runtime);
  await mkdir(assets);
  await writeFile(join(assets, 'video.mp4'), '0123456789');
  await writeFile(join(assets, 'secret.txt'), 'secret');
  const server = await createMediaServer(runtime);
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = await server.register(assets, ['video.mp4']);
  const range = await fetch(base + 'video.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '2345');
  assert.equal(
    (await fetch(base + 'video.mp4', { method: 'HEAD' })).headers.get('content-length'),
    '10',
  );
  assert.equal((await fetch(base + 'secret.txt')).status, 403);
  assert.equal(
    (await fetch(base.replace(/\/[a-f0-9]{48}\//, '/wrong/') + 'video.mp4')).status,
    403,
  );
  assert.equal((await fetch(base + 'video.mp4', { method: 'POST' })).status, 405);
  const all = await server.register(assets);
  await symlink(runtime, join(assets, 'escape'), 'junction');
  await writeFile(join(runtime, 'private.txt'), 'private');
  assert.equal((await fetch(all + 'escape/private.txt')).status, 403);
  assert.equal((await fetch(all)).status, 403);
});
test('project paths stay in their root and application projects are rejected', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wallpaper-project-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'project.json'),
    JSON.stringify({ type: 'application', file: 'run.exe' }),
  );
  await assert.rejects(projectItem(root));
  await writeFile(
    join(root, 'project.json'),
    JSON.stringify({ type: 'web', file: '../outside.html' }),
  );
  await assert.rejects(projectItem(root));
  await writeFile(join(root, 'index.html'), '<h1>Wallpaper</h1>');
  await writeFile(
    join(root, 'project.json'),
    JSON.stringify({ title: 'Web', type: 'web', file: 'index.html' }),
  );
  const item = await pickedItem(join(root, 'project.json'));
  assert.equal(item.type, 'web');
  assert.equal(item.project, true);
});
test('settings reject non-finite, unknown and unsafe values', () => {
  for (const value of [
    { opacity: NaN },
    { opacity: 0 },
    { fps: 900 },
    { glass: 'true' },
    { current: '../x' },
    { blur: Infinity },
    { shellDim: NaN },
    { shellDim: -0.1 },
    { shellDim: 0.81 },
    { shellDim: '0.35' },
  ])
    assert.throws(() => validateOptions(value));
  assert.deepEqual(
    validateOptions({ glass: true, opacity: 0.8, fps: 30, blur: 12, dim: 0.3, fit: 'cover' }),
    { glass: true, opacity: 0.8, fps: 30, blur: 12, dim: 0.3, fit: 'cover' },
  );
  assert.deepEqual(validateOptions({ shellDim: 0 }), { shellDim: 0 });
  assert.deepEqual(validateOptions({ shellDim: 0.8 }), { shellDim: 0.8 });
});

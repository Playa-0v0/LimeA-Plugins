import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewFile, projectItem, pickedItem } from '../src/library.mjs';
import { createPreviewReader } from '../src/previews.mjs';

test('existing projects discover declared/conventional covers without rescanning and reject escapes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wallpaper-preview-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'index.html'), 'web');
  await writeFile(join(root, 'outside.jpg'), 'outside');
  await writeFile(join(project, 'cover.png'), 'inside');
  const metadata = (preview) =>
    writeFile(
      join(project, 'project.json'),
      JSON.stringify({ type: 'web', file: 'index.html', preview }),
    );
  await metadata('cover.png');
  const item = await projectItem(project);
  assert.equal(await previewFile(item), join(project, 'cover.png'));
  await metadata('../outside.jpg');
  assert.equal(await previewFile(item), null);
  await symlink(root, join(project, 'escape'), 'junction');
  await metadata('escape/outside.jpg');
  assert.equal(await previewFile(item), null);
  await metadata('missing.png');
  await writeFile(join(project, 'preview.jpg'), 'fallback');
  assert.equal(await previewFile(item), join(project, 'preview.jpg'));
  const standalone = await pickedItem(join(project, 'cover.png'));
  assert.equal(await previewFile(standalone), join(project, 'cover.png'));
  await writeFile(join(project, 'video.mp4'), 'video');
  assert.equal(
    await previewFile(await pickedItem(join(project, 'video.mp4'))),
    null,
    'standalone videos must not read unrelated sibling files',
  );
});
test('preview reads are bounded, cached by source revision and tolerate deleted or unsupported files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wallpaper-preview-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'image.png');
  await writeFile(path, 'first');
  const item = await pickedItem(path);
  let calls = 0;
  const read = createPreviewReader({
    thumbnail: async (bytes) => {
      calls++;
      return 'data:image/webp;base64,' + bytes.toString('base64');
    },
  });
  const first = await read(item);
  assert.equal(await read(item), first);
  assert.equal(calls, 1);
  await writeFile(path, 'replacement');
  assert.notEqual(await read(item), first);
  assert.equal(calls, 2);
  await truncate(path, 32 * 1024 * 1024 + 1);
  assert.equal(await read(item), null);
  assert.equal(calls, 2);
  await rm(path);
  assert.equal(await read(item), null);
  assert.equal(await createPreviewReader(undefined)(item), null);
});

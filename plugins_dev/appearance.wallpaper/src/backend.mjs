import { fileURLToPath } from 'node:url';
import { createMediaServer } from './media-server.mjs';
import { pickedItem, discoverItems } from './library.mjs';
import { createPreviewReader } from './previews.mjs';

export const defaults = {
  current: null,
  revision: 0,
  glass: true,
  opacity: 0.86,
  shellDim: 0.35,
  blur: 12,
  dim: 0.25,
  fps: 30,
  paused: false,
  fit: 'cover',
};
export const migrations = [
  {
    id: '1000_initial',
    sql: `CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL); CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  },
];
export function validateOptions(value) {
  const next = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置无效');
  for (const [key, v] of Object.entries(value)) {
    if (['glass', 'paused'].includes(key) && typeof v === 'boolean') next[key] = v;
    else if (key === 'fit' && ['cover', 'contain', 'stretch'].includes(v)) next[key] = v;
    else if (key === 'fps' && [15, 30, 60].includes(v)) next[key] = v;
    else if (
      { opacity: [0.5, 1], shellDim: [0, 0.8], blur: [0, 24], dim: [0, 0.8] }[key]?.every(
        (n, i) => typeof v === 'number' && Number.isFinite(v) && (i ? v <= n : v >= n),
      )
    )
      next[key] = v;
    else throw new Error('设置值超出范围');
  }
  return next;
}
export async function apply(ctx) {
  const db = await ctx.storage.openDatabase({ name: 'wallpaper', migrations });
  const server = await createMediaServer(fileURLToPath(new URL('./runtime/', import.meta.url)));
  const readPreview = createPreviewReader(ctx.images);
  let closed = false,
    queue = Promise.resolve(),
    runtimeError = null;
  ctx.onDispose(async () => {
    closed = true;
    await queue;
    await server.close();
    await db.close();
  });
  const state = async () => ({
    ...defaults,
    ...JSON.parse((await db.get('SELECT value FROM settings WHERE id=1'))?.value ?? '{}'),
  });
  const save = (value) =>
    db.run(
      'INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      [JSON.stringify(value)],
    );
  const register = (name, action) =>
    ctx.commands.register(name, (payload) => {
      const pending = queue.then(() => {
        if (closed) throw new Error('插件已停用');
        return action(payload);
      });
      queue = pending.catch(() => {});
      return pending;
    });
  const remember = (item) => ({
    sql: 'INSERT INTO items(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    params: [item.id, JSON.stringify(item)],
  });
  register('list', async () => ({
    settings: await state(),
    previewsSupported: Boolean(ctx.images),
    error: runtimeError,
    items: (await db.all('SELECT value FROM items ORDER BY id')).map((row) => {
      const { id, title, type } = JSON.parse(row.value);
      return { id, title, type };
    }),
  }));
  register('preview', async (id) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw new Error('壁纸不存在');
    const row = await db.get('SELECT value FROM items WHERE id=?', [id]);
    if (!row) throw new Error('壁纸不存在');
    return { src: await readPreview(JSON.parse(row.value)) };
  });
  register('pick', async () => {
    const selected = await ctx.dialog.pickFile([
      {
        name: '壁纸 / Wallpaper',
        extensions: [
          'json',
          'png',
          'jpg',
          'jpeg',
          'webp',
          'gif',
          'avif',
          'bmp',
          'mp4',
          'webm',
          'mov',
          'm4v',
        ],
      },
    ]);
    if (selected.status !== 'selected' || closed) return { canceled: true };
    const item = await pickedItem(selected.path);
    const previous = await state();
    const options = { ...previous, current: item.id, revision: previous.revision + 1 };
    await db.transaction([
      remember(item),
      {
        sql: 'INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        params: [JSON.stringify(options)],
      },
    ]);
    runtimeError = null;
    return { selected: item.id };
  });
  register('scan', async () => {
    const items = await discoverItems();
    if (closed) return { count: 0 };
    if (items.length) await db.transaction(items.map(remember));
    return { count: items.length };
  });
  register('select', async (input) => {
    if (
      input !== null &&
      (typeof input !== 'string' || !(await db.get('SELECT id FROM items WHERE id=?', [input])))
    )
      throw new Error('壁纸不存在');
    const previous = await state();
    await save({ ...previous, current: input, revision: previous.revision + 1 });
    runtimeError = null;
    return null;
  });
  register('configure', async (input) => {
    await save({ ...(await state()), ...validateOptions(input) });
    return null;
  });
  register('clear', async () => {
    await save({ ...(await state()), current: null });
    runtimeError = null;
    return null;
  });
  register('report', (input) => {
    runtimeError = typeof input === 'string' ? input.slice(0, 300) : null;
    return null;
  });
  register('playback', async () => {
    const options = await state();
    const row =
      options.current && (await db.get('SELECT value FROM items WHERE id=?', [options.current]));
    if (!row) return { settings: options, item: null };
    const item = JSON.parse(row.value);
    try {
      const base = await server.register(item.root, item.project ? null : [item.file]);
      const { root: _root, ...publicItem } = item;
      return { settings: options, item: { ...publicItem, base, runtime: server.runtime } };
    } catch {
      runtimeError = '壁纸文件已移动或无法访问，请重新选择';
      return { settings: options, item: null, error: runtimeError };
    }
  });
}

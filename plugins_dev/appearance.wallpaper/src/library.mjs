import { stat, realpath } from 'node:fs/promises';
import { dirname, extname, basename, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createSteamDiscoveryKit } from '../vendor/steam-discovery.mjs';
import { createWallpaperScanKit } from '../vendor/wallpaper-scan.mjs';
const probe = async (path, kind) => {
  try {
    const s = await stat(path);
    return kind ? s[kind]() : true;
  } catch {
    return false;
  }
};
const discovery = createSteamDiscoveryKit({ WE_APPID: '431960', pathExistsP: (p) => probe(p) });
const scan = createWallpaperScanKit({
  WE_APPID: '431960',
  pathExistsP: (p) => probe(p),
  isFileP: (p) => probe(p, 'isFile'),
  isDirectoryP: (p) => probe(p, 'isDirectory'),
  extOf: (p) => extname(p).slice(1).toLowerCase(),
  schemeToCss: () => null,
});
export async function projectItem(directory) {
  const root = await realpath(directory);
  const project = await scan.readProjectP(root);
  if (!project || !['image', 'video', 'web', 'scene'].includes(project.type))
    throw new Error('不支持此壁纸项目');
  const declared = resolve(root, project.file);
  const rel = relative(root, declared);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('项目入口超出目录');
  const file =
    project.type === 'scene' ? await scan.resolveSceneMainFileP(root, project.file) : project.file;
  if (!file) throw new Error('找不到场景文件');
  const actual = await realpath(resolve(root, file));
  const child = relative(root, actual);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('项目入口超出目录');
  return {
    id: createHash('sha256').update(root).digest('hex').slice(0, 24),
    root,
    file: child.replaceAll('\\', '/'),
    type: project.type,
    title: project.title,
    project: true,
  };
}
export async function pickedItem(path) {
  if (basename(path).toLowerCase() === 'project.json') return projectItem(dirname(path));
  const file = await realpath(path);
  const extension = extname(file).toLowerCase();
  const type = /\.(png|jpe?g|webp|gif|avif|bmp)$/.test(extension)
    ? 'image'
    : /\.(mp4|webm|mov|m4v)$/.test(extension)
      ? 'video'
      : null;
  if (!type) throw new Error('请选择图片、视频或 project.json');
  return {
    id: createHash('sha256').update(file).digest('hex').slice(0, 24),
    root: dirname(file),
    file: basename(file),
    type,
    title: basename(file),
    project: false,
  };
}
// Follow upstream project.preview and its conventional cover filenames. Existing
// saved items are resolved lazily, so upgrading does not require a fresh scan.
export async function previewFile(item) {
  try {
    const root = await realpath(item.root);
    const project = item.project ? await scan.readProjectP(root) : null;
    const candidates = item.project
      ? [
          project?.preview,
          'preview.jpg',
          'preview.png',
          'preview.gif',
          'preview.webp',
          ...(item.type === 'image' ? [item.file] : []),
        ]
      : item.type === 'image'
        ? [item.file]
        : [];
    for (const name of candidates) {
      if (typeof name !== 'string' || !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(name)) continue;
      const declared = resolve(root, name);
      const rel = relative(root, declared);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
      try {
        const actual = await realpath(declared);
        const child = relative(root, actual);
        if (!child || child.startsWith('..') || isAbsolute(child)) continue;
        if ((await stat(actual)).isFile()) return actual;
      } catch {
        /* Missing covers do not make the wallpaper unavailable. */
      }
    }
  } catch {
    /* Source directory was removed. */
  }
  return null;
}
export async function discoverItems() {
  const [install, libraries] = await Promise.all([
    discovery.locateWallpaperEngineP(),
    discovery.owningLibrariesP(),
  ]);
  const rows = await scan.enumerateWallpapersAsync(install, libraries);
  const result = [];
  for (const row of rows.slice(0, 1000)) {
    try {
      result.push(await projectItem(row.dirAbs));
    } catch {
      /* Unsupported or unavailable project. */
    }
  }
  return result;
}

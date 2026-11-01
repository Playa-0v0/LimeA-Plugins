import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';

// 只检查分发目录；绝不进入 plugins_dev 或跟随链接。
export async function distributionFiles(root) {
  const files = [];
  async function walk(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const name = `${path}/${entry.name}`;
      const info = await lstat(join(root, name));
      if (info.isSymbolicLink()) throw new Error(`分发目录不允许链接：${name}`);
      if (info.isDirectory()) await walk(name);
      else if (info.isFile() && /\.(zip|png|webp|jpg)$/.test(name)) files.push(name);
      else throw new Error(`分发目录含未知文件：${name}`);
    }
  }
  for (const path of ['plugins', 'icons', 'packages']) await walk(path);
  return files.sort();
}

export function currentResources(catalog) {
  return new Set(
    catalog.plugins.flatMap((plugin) => [
      plugin.archive,
      ...(plugin.icon ? [plugin.icon.path] : []),
    ]),
  );
}

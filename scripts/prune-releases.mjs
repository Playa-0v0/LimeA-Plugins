import { readFile, unlink, readdir, rmdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionFiles, currentResources } from './distribution-files.mjs';
import { checkCatalog } from './check-catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await checkCatalog(root, true);
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
const keep = currentResources(catalog);
const obsolete = (await distributionFiles(root)).filter((path) => !keep.has(path));
for (const path of obsolete) {
  const target = resolve(root, path);
  const parent = resolve(root, path.split('/')[0]);
  const inside = relative(parent, target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside))
    throw new Error('清理目标超出分发目录');
  await unlink(target);
  console.log(`移除旧分发文件：${path}`);
}
async function removeEmpty(path, boundary) {
  const inside = relative(boundary, resolve(path));
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('空目录超出清理范围');
  const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries)
    if (entry.isDirectory()) await removeEmpty(join(path, entry.name), boundary);
  await rmdir(path).catch((error) => {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  });
}
for (const directory of ['plugins', 'icons', 'packages']) {
  const boundary = resolve(root, directory);
  await removeEmpty(boundary, boundary);
}
console.log(`保留 ${keep.size} 个当前分发文件`);

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
if (catalog.version !== 1 || !Array.isArray(catalog.plugins)) throw new Error('清单格式无效');
const ids = new Set();
for (const item of catalog.plugins) {
  if (ids.has(item.id)) throw new Error('插件 ID 重复');
  ids.add(item.id);
  for (const resource of [{ path: item.archive, sha256: item.sha256 }, ...(item.icon ? [item.icon] : [])]) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(resource.path) || resource.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('资源路径无效');
    const bytes = await readFile(join(root, resource.path));
    if (createHash('sha256').update(bytes).digest('hex') !== resource.sha256) throw new Error(`资源校验失败：${resource.path}`);
  }
}
console.log(`目录验证通过：${ids.size} 个插件`);

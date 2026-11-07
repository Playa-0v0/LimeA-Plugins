import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safePath, readMetadata, syncReadme } from './market-docs.mjs';
import { distributionFiles, currentResources } from './distribution-files.mjs';

export async function checkCatalog(root, allowStale = false) {
  const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
  if (catalog.version !== 1 || !Array.isArray(catalog.plugins)) throw new Error('清单格式无效');
  const ids = new Set();
  for (const item of catalog.plugins) {
    if (
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(item.id) ||
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(item.version)
    )
      throw new Error('插件标识或版本无效');
    if (ids.has(item.id)) throw new Error('插件 ID 重复');
    ids.add(item.id);
    if (item.archive !== `plugins/${item.id}/${item.version}.zip`)
      throw new Error('安装包路径不符合目录规范');
    if (item.icon && !item.icon.path.startsWith(`icons/${item.id}/${item.version}.`))
      throw new Error('图标路径不符合目录规范');
    if (!['official', 'community'].includes(item.tier)) throw new Error('插件层级无效');
    const metadata = await readMetadata(root, item.id);
    if (
      metadata.author !== item.author ||
      metadata.description !== item.description ||
      metadata.category !== item.category ||
      metadata.tier !== item.tier
    )
      throw new Error('市场清单与条目资料不一致');
    for (const resource of [
      { path: item.archive, sha256: item.sha256 },
      ...(item.icon ? [item.icon] : []),
    ]) {
      if (!safePath(resource.path)) throw new Error('资源路径无效');
      const bytes = await readFile(join(root, resource.path));
      if (createHash('sha256').update(bytes).digest('hex') !== resource.sha256)
        throw new Error(`资源校验失败：${resource.path}`);
    }
  }
  await syncReadme(root, catalog, true);
  const keep = currentResources(catalog);
  const stale = (await distributionFiles(root)).filter((path) => !keep.has(path));
  if (!allowStale && stale.length)
    throw new Error(`存在旧分发文件，发布过渡后运行 npm run prune:releases：${stale.join(', ')}`);
  console.log(`目录验证通过：${ids.size} 个插件`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkCatalog(
    fileURLToPath(new URL('../', import.meta.url)),
    process.argv.includes('--allow-stale'),
  );
}

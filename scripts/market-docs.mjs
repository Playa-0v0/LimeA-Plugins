import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function safePath(value) {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9_./-]+$/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

export async function readMetadata(root, id, path = join(root, 'entries', `${id}.json`)) {
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  if (
    !metadata.author ||
    !metadata.description ||
    !['games', 'appearance', 'tools', 'other'].includes(metadata.category) ||
    !/^[a-zA-Z0-9.+() -]{1,100}$/.test(metadata.license ?? '')
  ) {
    throw new Error('条目必须声明作者、简介、分类和许可证标识');
  }
  const repository = metadata.repository;
  if (
    !safePath(repository) &&
    !(typeof repository === 'string' && /^https:\/\/[^\s<>"|()]+$/.test(repository))
  ) {
    throw new Error('源码／原仓库地址无效');
  }
  if (safePath(repository)) await stat(join(root, repository));
  for (const path of [
    `plugins_dev/${id}/README.md`,
    `plugins_dev/${id}/LICENSE`,
    metadata.documentation,
    ...(metadata.assetLicense ? [metadata.assetLicense] : []),
  ]) {
    if (!safePath(path)) throw new Error('插件文档路径无效');
    if (!(await readFile(join(root, path), 'utf8')).trim())
      throw new Error(`插件文档为空：${path}`);
  }
  return metadata;
}

const cell = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replace(/[\r\n]+/g, ' ');

export async function renderTable(root, catalog) {
  const rows = [
    '| 序号 | 图标 | 名称 | 作者 | 协议 | 源码／原仓库 | 文档 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [index, plugin] of catalog.plugins.entries()) {
    const metadata = await readMetadata(root, plugin.id);
    if (plugin.icon && !safePath(plugin.icon.path)) throw new Error('图标路径无效');
    const icon = plugin.icon
      ? `<img src="${plugin.icon.path}" width="40" height="40" alt="">`
      : '—';
    const license =
      `[${cell(metadata.license)}](plugins_dev/${plugin.id}/LICENSE)` +
      (metadata.assetLicense ? ` · [素材说明](${metadata.assetLicense})` : '');
    const repository = `[${safePath(metadata.repository) ? '本仓库' : '原仓库'}](${metadata.repository})`;
    rows.push(
      `| ${index + 1} | ${icon} | ${cell(plugin.name)} | ${cell(metadata.author)} | ${license} | ${repository} | [说明](${metadata.documentation}) |`,
    );
  }
  return '<!-- prettier-ignore -->\n' + rows.join('\n');
}

export async function syncReadme(root, catalog, check = false) {
  const path = join(root, 'README.md');
  const readme = await readFile(path, 'utf8');
  const start = '<!-- plugins:start -->';
  const end = '<!-- plugins:end -->';
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from < 0 || to < from) throw new Error('README 缺少插件表格标记');
  const updated =
    readme.slice(0, from + start.length) +
    '\n\n' +
    (await renderTable(root, catalog)) +
    '\n\n' +
    readme.slice(to);
  if (check && updated !== readme) throw new Error('首页插件表格过期，请运行 npm run docs:plugins');
  if (!check) await writeFile(path, updated);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
  await syncReadme(root, catalog, process.argv.includes('--check'));
}

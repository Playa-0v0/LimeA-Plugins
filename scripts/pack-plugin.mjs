import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, rename } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipFile } from 'yazl';

const root = fileURLToPath(new URL('../', import.meta.url));
const [input, metadataFile] = process.argv.slice(2);
if (!input || !metadataFile) throw new Error('用法：npm run pack:plugin -- <插件 dist 目录> <条目描述 JSON>');
const directory = resolve(input);
const manifest = JSON.parse(await readFile(join(directory, 'limea.plugin.json'), 'utf8'));
const metadata = JSON.parse(await readFile(resolve(metadataFile), 'utf8'));
if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(manifest.id) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error('插件 ID 或版本无效');
if (!metadata.author || !metadata.description || !['games', 'appearance', 'tools', 'other'].includes(metadata.category)) throw new Error('条目必须声明作者、简介和分类');
const files = new Map();
let total = 0;
async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('安装包不能包含链接或特殊文件');
    if (stat.isDirectory()) { await walk(path); continue; }
    const key = relative(directory, path).replaceAll('\\', '/');
    if (key.split('/').some((part) => part.startsWith('.') || /[<>:"|?*]/.test(part))) throw new Error(`不支持的文件路径：${key}`);
    total += stat.size;
    if (total > 32 * 1024 * 1024 || files.size >= 5000) throw new Error('安装包超过宿主大小或文件数量限制');
    files.set(key, await readFile(path));
  }
}
await walk(directory);
if (!files.has(manifest.entry)) throw new Error('缺少后端入口');
const zip = new ZipFile();
for (const [name, bytes] of files) zip.addBuffer(bytes, name, { mtime: new Date('2020-01-01T00:00:00Z'), mode: 0o100644 });
zip.end();
const chunks = [];
for await (const chunk of zip.outputStream) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const archive = `packages/${manifest.id}/${manifest.version}.zip`;
const target = join(root, archive);
await mkdir(dirname(target), { recursive: true });
const previous = await readFile(target).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
if (previous && sha256(previous) !== sha256(bytes)) throw new Error('同版本内容已存在且不同，请先提升插件版本');
await writeFile(target, bytes);
const entry = { id: manifest.id, name: manifest.name, description: metadata.description, author: metadata.author, version: manifest.version, hostVersion: manifest.hostVersion, category: metadata.category, permissions: manifest.permissions ?? [], archive, sha256: sha256(bytes) };
if (metadata.icon) {
  const icon = files.get(metadata.icon);
  if (!icon || !/\.(png|webp|jpg)$/.test(metadata.icon) || icon.length > 2 * 1024 * 1024) throw new Error('图标必须是安装包中的 PNG、WebP 或 JPG，且小于 2 MiB');
  const path = `icons/${manifest.id}-${manifest.version}.${metadata.icon.split('.').at(-1)}`;
  await mkdir(join(root, 'icons'), { recursive: true });
  await writeFile(join(root, path), icon);
  entry.icon = { path, sha256: sha256(icon) };
}
const catalogPath = join(root, 'catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
catalog.plugins = [...catalog.plugins.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id));
await writeFile(`${catalogPath}.tmp`, JSON.stringify(catalog, null, 2) + '\n');
await rename(`${catalogPath}.tmp`, catalogPath);
console.log(`已打包 ${entry.name} ${entry.version} (${bytes.length} 字节)；运行 npm run check 验证后再发布`);

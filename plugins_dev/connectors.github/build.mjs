import { build } from 'esbuild';
import { mkdir, copyFile, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/backend.mjs'],
  outfile: 'dist/backend.mjs',
  bundle: true,
  platform: 'node',
  banner: {
    js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: 'eof',
  format: 'esm',
  target: 'node24',
});
await build({
  entryPoints: ['src/page.mjs'],
  outfile: 'dist/page.mjs',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome140',
  loader: { '.css': 'text' },
});
for (const name of ['limea.plugin.json', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.txt'])
  await copyFile(name, 'dist/' + name);
await cp('assets', 'dist/assets', { recursive: true });
await cp('skills', 'dist/skills', { recursive: true });
// Retain license texts for runtime dependencies included in the bundled backend.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [await readFile('THIRD-PARTY-NOTICES.txt', 'utf8')];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  const files = await readdir(path);
  for (const name of files.filter((name) => /^(?:licen[sc]e|copying)(?:$|\.)/i.test(name))) {
    notices.push(path + '@' + info.version + '\n' + (await readFile(path + '/' + name, 'utf8')));
  }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'));
console.log('构建完成：导入 plugins_dev/connectors.github/dist');

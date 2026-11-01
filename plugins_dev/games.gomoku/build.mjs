import { build } from 'esbuild';
import sharp from 'sharp';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/engine-worker.mjs'],
  outfile: 'dist/engine-worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
});
await build({
  entryPoints: ['src/backend.mjs'],
  outfile: 'dist/backend.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
});
await build({
  entryPoints: ['src/panel.mjs'],
  outfile: 'dist/panel.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome140',
  minify: true,
  loader: { '.css': 'text' },
});
await sharp('assets/icon.svg').resize(192, 192).png().toFile('dist/assets/icon.png');
await cp('limea.plugin.json', 'dist/limea.plugin.json');
await cp('LICENSE', 'dist/LICENSE');
await cp('THIRD-PARTY-NOTICES.txt', 'dist/THIRD-PARTY-NOTICES.txt');
await cp('assets/stone.mp3', 'dist/assets/stone.mp3');
await cp('ASSETS.md', 'dist/ASSETS.md');
console.log('构建完成：导入 plugins_dev/games.gomoku/dist 并启用。');

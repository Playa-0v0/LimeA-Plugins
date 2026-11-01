import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/backend.mjs'],
  outfile: 'dist/backend.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
});
await build({
  entryPoints: ['src/panel.js'],
  outfile: 'dist/panel.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome140',
  minify: true,
  legalComments: 'eof',
});
await cp('limea.plugin.json', 'dist/limea.plugin.json');
await cp('assets/game-shark.glb', 'dist/assets/game-shark.glb');
await cp('assets/icon.png', 'dist/assets/icon.png');
await cp('LICENSE', 'dist/LICENSE');
await cp('ASSETS.md', 'dist/ASSETS.md');
await cp('node_modules/three/LICENSE', 'dist/THREE-LICENSE.txt');
console.log('构建完成：在 LimeA 设置 → 插件中导入 dist 目录');

import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
await mkdir('dist', { recursive: true });
for (const name of ['backend', 'panel', 'page']) {
  await build({
    entryPoints: [`src/${name}.mjs`],
    outfile: `dist/${name}.mjs`,
    bundle: true,
    format: 'esm',
    platform: name === 'backend' ? 'node' : 'browser',
    target: name === 'backend' ? 'node24' : 'chrome140',
    loader: { '.css': 'text' },
  });
}
for (const name of ['limea.plugin.json', 'LICENSE', 'ASSETS.md']) await cp(name, `dist/${name}`);
await mkdir('dist/assets', { recursive: true });
await cp('assets/icon.png', 'dist/icon.png');
await cp('assets/banner.webp', 'dist/assets/banner.webp');
await cp('assets/audio', 'dist/assets/audio', { recursive: true });
console.log('构建完成：在支持接口 11 的 LimeA 中导入 plugins_dev/games.draw_guess/dist。');

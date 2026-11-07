import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
await rm('dist', { recursive: true, force: true });
await mkdir('dist/runtime', { recursive: true });
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/backend.mjs'],
  outfile: 'dist/backend.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
await build({
  entryPoints: ['src/background.mjs'],
  outfile: 'dist/background.mjs',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome140',
  loader: { '.css': 'text' },
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
await build({
  entryPoints: ['src/player.mjs'],
  outfile: 'dist/runtime/player.mjs',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: true,
  target: 'chrome140',
});
await writeFile(
  'dist/runtime/index.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#wallpaper{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#wallpaper{position:fixed;inset:0}</style></head><body><div id="wallpaper"></div><script type="module" src="./player.mjs"></script></body></html>',
);
await sharp('assets/icon-source.png')
  .resize(192, 192)
  .png()
  .toFile('dist/assets/icon.png');
for (const file of [
  'limea.plugin.json',
  'LICENSE',
  'ASSETS.md',
  'README.md',
  'THIRD-PARTY-NOTICES.txt',
])
  await cp(file, `dist/${file}`);
await cp('assets/banner.webp', 'dist/assets/banner.webp');
await cp('vendor/LICENSE-dsh', 'dist/LICENSE-dsh');
await cp('node_modules/mediabunny/src', 'dist/sources/mediabunny', { recursive: true });
await cp('node_modules/mediabunny/package.json', 'dist/sources/mediabunny/package.json');
// Keep upstream notices for every dependency shipped in the bundles.
for (const pkg of [
  'webwallgl',
  'mediabunny',
  'serve-handler',
  'bytes',
  'content-disposition',
  'fast-url-parser',
  'mime-types',
  'mime-db',
  'minimatch',
  'path-is-inside',
  'path-to-regexp',
  'range-parser',
  'balanced-match',
  'brace-expansion',
  'concat-map',
  'punycode',
]) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try {
      await writeFile(`dist/LICENSE-${pkg}.txt`, await readFile(`node_modules/${pkg}/${name}`));
      break;
    } catch {}
  }
}
console.log('Built appearance.wallpaper/dist (interface 11)');

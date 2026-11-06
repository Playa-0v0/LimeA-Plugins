import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import handler from 'serve-handler';

// serve-handler owns streaming, byte ranges, HEAD and content types. This adapter
// only exposes registered project roots, with fresh capabilities on every start.
export async function createMediaServer(runtimeRoot) {
  const secret = randomBytes(24).toString('hex');
  const roots = new Map([['runtime', { root: await realpath(runtimeRoot), files: null }]]);
  const server = createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/');
      if (parts[1] !== secret || !roots.has(parts[2])) {
        res.writeHead(403).end();
        return;
      }
      const { root, files } = roots.get(parts[2]);
      const name = decodeURIComponent(parts.slice(3).join('/'));
      if (files && !files.includes(name)) {
        res.writeHead(403).end();
        return;
      }
      if (
        !name ||
        name.includes('\\') ||
        name.includes(':') ||
        name.split('/').some((p) => !p || p === '.' || p === '..')
      ) {
        res.writeHead(403).end();
        return;
      }
      const file = await realpath(resolve(root, name));
      const child = relative(root, file);
      if (!child || child.startsWith('..') || isAbsolute(child) || !(await stat(file)).isFile()) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      req.url = '/' + name.split('/').map(encodeURIComponent).join('/');
      await handler(req, res, {
        public: root,
        directoryListing: false,
        cleanUrls: false,
        symlinks: false,
        etag: false,
      });
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}/${secret}`;
  return {
    runtime: `${base}/runtime/`,
    async register(directory, files = null) {
      const root = await realpath(directory);
      for (const [id, value] of roots)
        if (value.root === root && JSON.stringify(value.files) === JSON.stringify(files))
          return `${base}/${id}/`;
      const id = randomBytes(16).toString('hex');
      roots.set(id, { root, files });
      return `${base}/${id}/`;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      roots.clear();
    },
  };
}

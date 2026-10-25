import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

export interface SwitchableServer {
  url: string;
  /** Serve a different build from now on — like deploying a new version. */
  serve(dir: string): void;
  close(): Promise<void>;
}

/** Minimal static server whose document root can be swapped mid-test. Never caches. */
export async function startServer(initialDir: string): Promise<SwitchableServer> {
  let root = initialDir;
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(root)) return void res.writeHead(403).end();
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://localhost:${port}`,
    serve: (dir) => void (root = dir),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

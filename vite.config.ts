import { defineConfig, type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { readdirSync, readFileSync, statSync, createReadStream } from 'node:fs';

const cesiumPackage = dirname(createRequire(import.meta.url).resolve('cesium/package.json'));
const cesiumRoot = join(cesiumPackage, 'Build', 'Cesium');
const cesiumFolders = new Set(['Assets', 'Workers', 'Widgets', 'ThirdParty']);
const mimeTypes: Record<string, string> = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.wasm': 'application/wasm' };

function cesiumAssets(): Plugin {
  return {
    name: 'giftportals-local-cesium-assets',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/cesium', (req, res, next) => {
        let relative: string;
        try { relative = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, ''); } catch { res.statusCode = 400; res.end(); return; }
        if (relative === 'LICENSE.md') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); createReadStream(join(cesiumPackage, 'LICENSE.md')).on('error', () => res.destroy()).pipe(res); return; }
        const file = resolve(cesiumRoot, relative);
        if (!cesiumFolders.has(relative.split('/')[0]) || !file.startsWith(cesiumRoot + sep)) { res.statusCode = 404; res.end(); return; }
        try { if (!statSync(file).isFile()) return next(); } catch { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', mimeTypes[extname(file)] || 'application/octet-stream');
        createReadStream(file).on('error', () => { res.destroy(); }).pipe(res);
      });
    },
    generateBundle() {
      const emitFolder = (relative: string) => {
        for (const entry of readdirSync(join(cesiumRoot, relative), { withFileTypes: true })) {
          const child = `${relative}/${entry.name}`;
          if (entry.isDirectory()) emitFolder(child);
          else if (entry.isFile()) this.emitFile({ type: 'asset', fileName: `cesium/${child}`, source: readFileSync(join(cesiumRoot, child)) });
        }
      };
      for (const folder of cesiumFolders) emitFolder(folder);
      this.emitFile({ type: 'asset', fileName: 'cesium/LICENSE.md', source: readFileSync(join(cesiumPackage, 'LICENSE.md')) });
    },
  };
}

export default defineConfig({
  server: {
    headers: { 'Referrer-Policy': 'strict-origin' },
    fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.local-giftportals/**'] },
    // Generated binary assets and QA captures do not need hot reload. Excluding
    // them also avoids Windows EBUSY watcher crashes during asset mirroring.
    watch: { ignored: ['**/.local-giftportals/**', '**/public/demo/**', '**/outputs/**'] },
  },
  preview: { headers: { 'Referrer-Policy': 'strict-origin' } },
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  plugins: [cesiumAssets(), {
    name: 'giftportals-api-development',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== '/api/giftportals' && path !== '/api/tick' && path !== '/api/instant' && path !== '/api/story-audio') return next();
        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of req) {
              const bytes = Buffer.from(chunk); size += bytes.length;
              if (size > (path === '/api/instant' ? 17 * 1024 * 1024 : path === '/api/story-audio' ? 9 * 1024 * 1024 : 16384)) { res.statusCode = 413; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:false,error:{code:'BODY_TOO_LARGE',message:'Request body is too large.'}})); return; }
              chunks.push(bytes);
            }
            Object.assign(req, { body: Buffer.concat(chunks).toString('utf8') });
          }
          const module = await server.ssrLoadModule(path === '/api/story-audio' ? '/api/story-audio.ts' : path === '/api/instant' ? '/api/instant.ts' : path === '/api/tick' ? '/api/tick.ts' : '/api/giftportals.ts');
          await module.default(req, res);
        } catch {
          res.statusCode = 503; res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ok:false,error:{code:'LOCAL_API_UNAVAILABLE',message:'The development API is unavailable. Stored cloud memories are unchanged.'}}));
        }
      });
    },
  }],
  build: { target: 'es2022', chunkSizeWarningLimit: 700, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});

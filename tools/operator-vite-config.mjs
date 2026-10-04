import { join, resolve } from 'node:path';

/** Operator CLIs transform server TS only. They must not scan browser entries
 * or invalidate the dependency optimizer cache of an already open preview. */
export function operatorViteConfig(root) {
  if (typeof root !== 'string' || !root) throw Error('OPERATOR_ROOT_INVALID');
  const project = resolve(root);
  return {
    root: project,
    configFile: false,
    cacheDir: join(project, '.local-giftportals', '.vite-operator'),
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent',
    server: {
      middlewareMode: true,
      hmr: false,
      fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.local-giftportals/**'] },
    },
    appType: 'custom',
  };
}

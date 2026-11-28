// Full-page render harness for #SmarterDesign before/after shots.
// Serves the REAL app (index.html, router, layout, guards) with four modules
// swapped for offline stand-ins, so any route renders with Kings Club data
// and no network. See ../SKILL.md section 6.
import { loadConfigFromFile, mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const swaps = [
  [/\/src\/lib\/supabase\.ts$/, path.join(HERE, 'supabase-stub.ts')],
  [/\/src\/contexts\/ClubWorkspaceContext\.tsx$/, path.join(HERE, 'workspace-stub.ts')],
  [/\/src\/hooks\/useClubNavigationAccess\.ts$/, path.join(HERE, 'access-stub.ts')],
  [/\/src\/hooks\/useAuthUser\.ts$/, path.join(HERE, 'auth-stub.ts')],
];
const stubs = {
  name: 'smarter-design-harness-stubs',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (importer && importer.startsWith(HERE)) return null;
    const r = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!r) return null;
    for (const [re, to] of swaps) if (re.test(r.id.split('?')[0])) return to;
    return null;
  },
};

export default async () => {
  const base = (
    await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.join(ROOT, 'vite.config.ts')
    )
  ).config;
  return mergeConfig(base, {
    root: ROOT,
    plugins: [stubs],
    // No file watching: on a small container the watcher exhausts inotify.
    server: { host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] }, fs: { allow: [ROOT] } },
    // Pre-bundle recharts with React, or a late re-optimise loads two React copies.
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.tsx'],
      include: ['recharts', 'react', 'react-dom'],
    },
  });
};

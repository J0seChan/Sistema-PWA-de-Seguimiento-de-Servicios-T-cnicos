import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Inyecta en dist/sw.js la lista de archivos a precachear y una versión de build. */
function swPrecache(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files = walk(outDir).map((p) => relative(outDir, p).split('\\').join('/')).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const swPath = join(outDir, 'sw.js');
      const src = readFileSync(swPath, 'utf8')
        .replace('self.__PRECACHE__ || []', JSON.stringify(files))
        .replace('__BUILD_VERSION__', String(Date.now()));
      writeFileSync(swPath, src);
    },
  };
}

// base './' = rutas relativas: funciona en GitHub Pages (usuario.github.io/repo) sin configurar nada.
export default defineConfig({ base: './', plugins: [swPrecache()], build: { target: 'es2022' } });

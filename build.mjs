/**
 * Build script for WebSpace.
 *
 * Bundles `src/main.js` and `src/styles/app.css` with esbuild into `dist/`,
 * transpiled down to Chromium 53 so the app runs on webOS 4.x (2018) TVs and
 * newer. Static files (index.html, appinfo.json, icons, licences) are copied.
 *
 * Usage:
 *   node build.mjs           production build (minified)
 *   node build.mjs --dev     unminified build with inline source maps
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const dev = process.argv.includes('--dev');

/** Oldest browser engine supported: webOS 4.x ships Chromium 53. */
const TARGET = ['chrome53'];

const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (appinfo.version !== pkg.version) {
  console.warn(`! appinfo.json version (${appinfo.version}) differs from package.json (${pkg.version})`);
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const file of ['index.html', 'appinfo.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(file, `dist/${file}`);
cpSync('licenses', 'dist/licenses', { recursive: true });
// assets/icons/source holds the logo's source; only the rendered sizes ship.
cpSync('assets/icons', 'dist/icons', { recursive: true, filter: (src) => !/[\\/]source([\\/]|$)/.test(src) });

await esbuild.build({
  entryPoints: { app: 'src/main.js', style: 'src/styles/app.css' },
  bundle: true,
  outdir: 'dist',
  target: TARGET,
  format: 'iife',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  define: {
    __APP_VERSION__: JSON.stringify(appinfo.version),
    __APP_ID__: JSON.stringify(appinfo.id),
  },
  logLevel: 'warning',
});
console.log('built dist/');

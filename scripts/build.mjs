// Empaqueta el código de la página (src/client) en public/app.js.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/client/main.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'esm',
  target: ['safari15', 'chrome100', 'edge100'],
  splitting: true,
  entryNames: 'app',
  chunkNames: 'js/[name]-[hash]',
  outdir: 'public',
  logLevel: 'info',
});

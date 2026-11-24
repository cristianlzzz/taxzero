// Empaqueta el código de la página (src/client) en public/app.js.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

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

// Lector de PDF (rooming list de Opera): su proceso en segundo plano se sirve tal cual.
mkdirSync('public/js', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/js/pdf.worker.min.mjs');

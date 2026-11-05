import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('www', { recursive: true });
await build({
  entryPoints: ['src/android-speech-bridge.mjs'],
  outfile: 'www/android-speech-bridge.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});
console.log('Built www/android-speech-bridge.js');

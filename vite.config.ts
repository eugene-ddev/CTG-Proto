import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

// `npm run build:single` собирает один index.html со всеми ассетами внутри —
// его можно открыть двойным кликом или выложить как артефакт.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  // имена функций в стеке ошибок — чтобы по скрину ошибки было видно, где упало
  esbuild: { keepNames: true },
  // версия прототипа — из package.json; поднимаю с каждым обновлением
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 4096,
  },
}));

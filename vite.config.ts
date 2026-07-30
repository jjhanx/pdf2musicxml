import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/** OSMD/VexFlow TO_CODA 기본 라벨 "To" → "To Coda" (기호는 그대로). postinstall 패치와 동일 규칙. */
function osmdToCodaLabelPlugin(): Plugin {
  const from = 'TO_CODA:this.drawSymbolText(t,e,"To",!0)';
  const to = 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)';
  return {
    name: 'osmd-to-coda-label',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('opensheetmusicdisplay')) return;
      if (!code.includes(from)) return;
      return { code: code.replace(from, to), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), osmdToCodaLabelPlugin()],
  optimizeDeps: {
    include: ['opensheetmusicdisplay'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
  },
});

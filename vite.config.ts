import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/** OSMD/VexFlow 진행 제어 라벨 — postinstall 패치와 동일 규칙. */
function osmdNavigationLabelPlugin(): Plugin {
  const patches: [string, string][] = [
    ['TO_CODA:this.drawSymbolText(t,e,"To",!0)', 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)'],
    ['type.DS:this.drawSymbolText(t,e,"D.S.",!1)', 'type.DS:this.drawSymbolText(t,e,"D.S.",!0)'],
    [
      's&&f.renderGlyph(n,o,a,40,"v4d",!0)',
      's&&f.renderGlyph(n,o,a,40,this.symbol_type===pt.type.DS?"v8c":"v4d",!0)',
    ],
  ];
  return {
    name: 'osmd-navigation-labels',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('opensheetmusicdisplay')) return;
      let next = code;
      let hit = false;
      for (const [from, to] of patches) {
        if (next.includes(from)) {
          next = next.replace(from, to);
          hit = true;
        }
      }
      if (!hit) return;
      return { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), osmdNavigationLabelPlugin()],
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

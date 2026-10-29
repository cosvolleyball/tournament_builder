import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite produces content-hashed assets for GitHub Pages. Keeping dependencies in
 * separate chunks lets browsers reuse cached React / Supabase code when only the
 * Tournament Builder UI changes. This does not promise a smaller total download.
 */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/tournament_builder/' : '/',
  build: {
    // Use normal minification and code-splitting; no runtime or auth changes.
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('/node_modules/@supabase/')) return 'vendor-supabase';
          if (id.includes('/node_modules/lucide-react/')) return 'vendor-icons';
        },
      },
    },
  },
}));

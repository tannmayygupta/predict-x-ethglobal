import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/content.tsx',
      name: 'PredictXOverlay',
      formats: ['iife'],
      fileName: () => 'content.js'
    },
    rollupOptions: { output: { assetFileNames: 'content.[ext]' } }
  }
});

import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const isReplitDev = process.env.NODE_ENV !== 'production' && process.env.REPL_ID !== undefined;

const replitPlugins = isReplitDev
  ? [
      (await import('@replit/vite-plugin-runtime-error-modal')).default(),
      await import('@replit/vite-plugin-cartographer').then((m) =>
        m.cartographer({
          root: path.resolve(import.meta.dirname, '..'),
        }),
      ),
      await import('@replit/vite-plugin-dev-banner').then((m) => m.devBanner()),
    ]
  : [];

// PORT is a runtime/dev-server setting, not a requirement for a production build.
// Replit provides it automatically, while Vercel does not provide it during `vite build`.
const port = Number(process.env.PORT || 5173);

// Replit's BASE_PATH is only needed in its hosted environment. A normal Vercel
// deployment serves the Vite app from the site root.
const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), ...replitPlugins],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});

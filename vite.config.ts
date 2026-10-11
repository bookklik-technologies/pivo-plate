import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; description: string };
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 5000000 },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_DESCRIPTION__: JSON.stringify(pkg.description) },
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    manifestFilename: 'manifest.webmanifest',
    manifest: {
      name: 'PiVo Plate',
      short_name: 'PiVo Plate',
      description: pkg.description,
      id: './',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#11161d',
      background_color: '#11161d',
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
      maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      navigateFallback: 'index.html'
    }
  })]
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // one copy of React for the app and the Privy SDK (a second copy breaks hooks)
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['@privy-io/react-auth'] },
  build: {
    rollupOptions: {
      output: {
        // chunks made only of third-party code (the Privy SDK and its deps) get a `vendor-` name so the
        // service worker can skip them at install time and cache them on first use instead
        chunkFileNames: (chunk) =>
          chunk.moduleIds.length > 0 && chunk.moduleIds.every((id) => id.includes('node_modules') || id.startsWith('\0'))
            ? 'assets/vendor-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Relay',
        short_name: 'Relay',
        description: 'Swap crypto, buy and sell with mobile money, and earn on FCFA liquidity.',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#ECEBEF',
        theme_color: '#ECEBEF',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // app shell + self-hosted fonts are precached
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        globIgnores: ['**/vendor-*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // quotes, rates and order status must never come from cache
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
          // hashed, immutable vendor chunks: fetched once when first needed, then served from cache
          { urlPattern: ({ url }) => /\/assets\/vendor-[^/]+\.js$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'vendor-chunks', expiration: { maxEntries: 400 } } },
        ],
      },
    }),
    cloudflare(),
  ],
});

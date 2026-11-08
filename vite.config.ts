import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const APP_VERSION = '1.0.0';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.ico', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        id: '/',
        name: 'Facebook Seller OS — ব্যবসা ব্যবস্থাপনা',
        short_name: 'Seller OS',
        description:
          'ফেসবুক ও অনলাইন বিক্রেতাদের জন্য অফলাইন-ফার্স্ট ব্যবসা ব্যবস্থাপনা অ্যাপ: অর্ডার, কাস্টমার, স্টক, কুরিয়ার, ক্যাশ অন ডেলিভারি, খরচ ও রিপোর্ট।',
        lang: 'bn-BD',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f6f7f9',
        theme_color: '#15803d',
        categories: ['business', 'productivity', 'finance'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
        shortcuts: [
          { name: 'নতুন অর্ডার', short_name: 'অর্ডার', url: '/orders/new' },
          { name: 'নতুন প্রোডাক্ট', short_name: 'প্রোডাক্ট', url: '/products/new' },
          { name: 'পেমেন্ট', short_name: 'পেমেন্ট', url: '/payments' },
          { name: 'রিপোর্ট', short_name: 'রিপোর্ট', url: '/reports' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Never cache authenticated/dynamic app data endpoints (there are none):
        // the app is fully local, so runtime caching is limited to same-origin static assets.
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, request }) => sameOrigin && request.destination === 'document',
            handler: 'NetworkFirst',
            options: { cacheName: 'fsos-html', networkTimeoutSeconds: 5 },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          db: ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Inject a strict Content-Security-Policy into the built index.html only.
 * Kept out of dev because Vite's HMR needs eval and a websocket connection.
 * The app makes no cross-origin requests, so everything is 'self' — plus
 * blob: for the audio-worklet module and inline styles for Vue's :style
 * bindings.
 */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  // Served from a GitHub Pages project subpath (https://<user>.github.io/
  // sound-desk-sim/). Change to '/' for a user/org page or a custom domain.
  base: '/sound-desk-sim/',
  plugins: [
    csp(),
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Sound Desk Sim',
        short_name: 'SoundDesk',
        description:
          'An in-browser live-sound-mixing learning tool: a full channel-strip signal chain you can hear in real time.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})

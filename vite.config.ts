import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const defaultSiteUrl = 'https://ondivpdfeditor.com'

// Inject the canonical production origin into index.html so deployment on a
// different domain only requires setting VITE_SITE_URL before `npm run build`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || defaultSiteUrl).replace(
    /\/+$/,
    '',
  )

  return {
    plugins: [
      react(),
      {
        name: 'inject-site-url',
        transformIndexHtml(html) {
          return html.replaceAll('__SITE_URL__', siteUrl)
        },
      },
    ],
  }
})

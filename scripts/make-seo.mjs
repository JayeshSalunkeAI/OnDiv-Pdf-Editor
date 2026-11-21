// Generates public/robots.txt and public/sitemap.xml for the canonical origin.
// Runs automatically before `npm run dev` and `npm run build`.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from 'vite'

const defaultSiteUrl = 'https://ondivpdfeditor.com'
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production'
const env = loadEnv(mode, process.cwd(), '')
const siteUrl = (
  process.env.VITE_SITE_URL ||
  env.VITE_SITE_URL ||
  defaultSiteUrl
).replace(/\/+$/, '')

const publicDir = path.join(process.cwd(), 'public')
mkdirSync(publicDir, { recursive: true })

writeFileSync(
  path.join(publicDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
  'utf8',
)

const lastmod = new Date().toISOString().slice(0, 10)
writeFileSync(
  path.join(publicDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
  'utf8',
)

console.log(`seo: ${siteUrl}/ (robots.txt + sitemap.xml)`)

// Copies the PDF.js runtime assets (CMaps, standard fonts, WASM decoders, ICC
// profiles) into /public so the editor works offline and doesn't depend on a CDN.
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'node_modules', 'pdfjs-dist')
const target = path.join(root, 'public', 'pdfjs')
const folders = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

await mkdir(target, { recursive: true })
for (const folder of folders) {
  await cp(path.join(source, folder), path.join(target, folder), {
    recursive: true,
    force: true,
  })
  console.log(`copied pdfjs/${folder}`)
}

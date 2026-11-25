import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Util } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { FontFaceId, FontKind, TextLine, TextWord } from '../types'
import { fontFaceFromName, nativeFontStyle } from './fonts'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const base = import.meta.env.BASE_URL
const asset = (folder: string) => `${base}pdfjs/${folder}/`

export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    // PDF.js transfers the buffer to its worker, so pass a copy and keep the
    // original bytes around for the export engine.
    data: bytes.slice(),
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
  })
  return task.promise
}

/** Releases worker resources for a document opened with {@link openPdf}. */
export function closePdf(pdf: PDFDocumentProxy): Promise<void> {
  return pdf.loadingTask.destroy()
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'PasswordException') {
      return 'This PDF is password-protected. Encrypted files are not editable yet.'
    }
    if (/password/i.test(error.message)) {
      return 'This PDF is password-protected. Encrypted files are not editable yet.'
    }
    return error.message
  }
  return String(error)
}

interface PdfTextItem {
  str: string
  dir: string
  transform: number[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

interface WorkingItem {
  text: string
  left: number
  right: number
  top: number
  bottom: number
  baseline: number
  fontSize: number
  fontFamily: FontKind
  fontFace: FontFaceId
  bold: boolean
  italic: boolean
  hasEOL: boolean
}

export function normalizeFont(family: string | undefined): FontKind {
  const value = (family ?? '').toLowerCase()
  if (/mono|courier|consol/.test(value)) return 'mono'
  if (/serif|times|georgia|garamond|book/.test(value) && !/sans/.test(value)) {
    return 'serif'
  }
  return 'sans'
}

/**
 * Turns PDF.js text items into line-level editing targets. Rotated text is
 * skipped on purpose: patching it correctly needs a full text-matrix rewrite,
 * which is outside this editor's scope.
 */
export async function extractTextLines(page: PDFPageProxy): Promise<TextLine[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: WorkingItem[] = []

  for (const raw of content.items) {
    if (!('str' in raw)) continue
    const item = raw as PdfTextItem
    const text = item.str.replace(/\s+/g, ' ')
    if (!text.trim()) {
      // Keep a marker so line grouping can break on heavily spaced pages.
      if (item.hasEOL) items.push(emptyItem())
      continue
    }

    const tx = Util.transform(viewport.transform, item.transform)
    const angle = Math.atan2(tx[1], tx[0])
    if (Math.abs(angle) > 0.01) continue

    const fontSize = Math.hypot(tx[2], tx[3])
    if (!Number.isFinite(fontSize) || fontSize < 1) continue

    const style = content.styles[item.fontName]
    const fontName = style?.fontFamily
    const fontFamily = normalizeFont(fontName)
    const nativeStyle = nativeFontStyle(fontName)
    const ascent = Math.min(1.05, Math.max(0.6, style?.ascent || 0.8))
    const descent = Math.max(-0.4, Math.min(-0.05, style?.descent ?? -0.2))
    const left = tx[4]
    const baseline = tx[5]
    const top = baseline - fontSize * ascent
    const bottom = baseline - fontSize * descent

    items.push({
      text,
      left,
      right: left + Math.max(item.width, fontSize * 0.3),
      top,
      bottom,
      baseline,
      fontSize,
      fontFamily,
      fontFace: fontFaceFromName(fontName, fontFamily),
      bold: nativeStyle.bold,
      italic: nativeStyle.italic,
      hasEOL: item.hasEOL,
    })
  }

  const lines: TextLine[] = []
  let current: WorkingItem[] = []

  const flush = () => {
    const group = current
    current = []
    if (!group.length) return
    const text = group
      .map((item) => item.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return

    const left = Math.min(...group.map((item) => item.left))
    const top = Math.min(...group.map((item) => item.top))
    const right = Math.max(...group.map((item) => item.right))
    const bottom = Math.max(...group.map((item) => item.bottom))
    const fontSize = group[0].fontSize
    const fontFamily = group[0].fontFamily
    const baseline = group[0].baseline
    const lineId = `native-${page.pageNumber}-${lines.length}`
    const lineWords: TextWord[] = []
    let wordIndex = 0

    for (const item of group) {
      const trimmed = item.text.trim()
      if (!trimmed) continue
      const baseOffset = item.text.indexOf(trimmed)
      const itemWidth = item.right - item.left
      const tokens = trimmed.match(/\S+/g) ?? []
      let cursor = 0
      for (const token of tokens) {
        const index = trimmed.indexOf(token, cursor)
        if (index < 0) continue
        cursor = index + token.length
        const start = baseOffset + index
        const end = start + token.length
        const ratioStart = start / Math.max(1, item.text.length)
        const ratioEnd = end / Math.max(1, item.text.length)
        lineWords.push({
          id: `${lineId}-w${wordIndex++}`,
          text: token,
          x: item.left + itemWidth * ratioStart,
          y: item.top,
          width: Math.max(1, itemWidth * (ratioEnd - ratioStart)),
          height: Math.max(1, item.bottom - item.top),
          lineId,
          fontSize: item.fontSize,
          fontFamily: item.fontFamily,
          fontFace: item.fontFace,
          bold: item.bold,
          italic: item.italic,
          baseline: item.baseline - item.top,
          source: 'native',
        })
      }
    }

    const bold =
      lineWords.length > 0
        ? lineWords.filter((word) => word.bold).length > lineWords.length / 2
        : group[0].bold

    lines.push({
      id: lineId,
      text,
      x: left,
      y: top,
      width: Math.max(4, right - left),
      height: Math.max(4, bottom - top),
      fontSize,
      fontFamily,
      fontFace: group[0].fontFace,
      bold,
      italic: group[0].italic,
      baseline: baseline - top,
      source: 'native',
      words: lineWords.length ? lineWords : undefined,
    })
  }

  for (const item of items) {
    if (!item.text) {
      flush()
      continue
    }
    const previous = current[current.length - 1]
    if (previous) {
      const sameBaseline = Math.abs(previous.baseline - item.baseline) < 2
      const sameSize = Math.abs(previous.fontSize - item.fontSize) < 1
      const gap = item.left - previous.right
      const joins =
        sameBaseline && sameSize && gap > -previous.fontSize * 0.5 && gap < previous.fontSize * 1.4
      if (!joins || previous.hasEOL) {
        flush()
      }
    }
    if (!current.length) {
      current.push({ ...item })
    } else {
      const previous = current[current.length - 1]
      const gap = item.left - previous.right
      const needsSpace = gap > item.fontSize * 0.12 && !/\s$/.test(previous.text)
      previous.text += (needsSpace ? ' ' : '') + item.text
      previous.right = Math.max(previous.right, item.right)
      previous.top = Math.min(previous.top, item.top)
      previous.bottom = Math.max(previous.bottom, item.bottom)
      previous.hasEOL = item.hasEOL
    }
  }
  flush()

  return lines.filter((line) => line.text.length > 0 && line.width > 2 && line.height > 2)
}

function emptyItem(): WorkingItem {
  return {
    text: '',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    baseline: -10000,
    fontSize: 1,
    fontFamily: 'sans',
    fontFace: 'liberation',
    bold: false,
    italic: false,
    hasEOL: true,
  }
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  scale: number,
): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  return { canvas, scale }
}

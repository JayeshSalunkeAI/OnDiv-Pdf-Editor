import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib'
import type { FontFaceId, FontKind, OcrPage, Patch } from '../types'
import { closePdf, extractTextLines, openPdf, renderPageToCanvas } from './pdf'
import { loadFontBytes, variantFor } from './fonts'

type PdfLib = typeof import('pdf-lib')

const sanitize = (input: string, charset?: Set<number>) => {
  const value = input
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?')
  if (!charset) return value
  let out = ''
  for (const char of value) {
    if (char === '\n' || charset.has(char.codePointAt(0) ?? 0)) out += char
    else out += '?'
  }
  return out
}

function intersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.w > b.x && a.y < b.y + b.height && a.y + a.h > b.y
}

const isMaskPatch = (patch: Patch) =>
  patch.kind === 'redact' || (patch.kind === 'text' && Boolean(patch.mask))

const isSecurePatch = (patch: Patch) =>
  patch.kind === 'redact' && Boolean(patch.secure)

export interface ExportOptions {
  searchable: boolean
}

const parseColor = (lib: PdfLib, value: string | undefined) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value ?? '')
  if (!match) return lib.rgb(0, 0, 0)
  const n = parseInt(match[1], 16)
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

interface FontHandle {
  font: PDFFont
  /** False when embedding failed and the standard PDF font is used instead. */
  custom: boolean
  charset: Set<number> | null
}

const standardTable = (lib: PdfLib): Record<FontKind, [string, string, string, string]> => ({
  sans: [
    lib.StandardFonts.Helvetica,
    lib.StandardFonts.HelveticaBold,
    lib.StandardFonts.HelveticaOblique,
    lib.StandardFonts.HelveticaBoldOblique,
  ],
  serif: [
    lib.StandardFonts.TimesRoman,
    lib.StandardFonts.TimesRomanBold,
    lib.StandardFonts.TimesRomanItalic,
    lib.StandardFonts.TimesRomanBoldItalic,
  ],
  mono: [
    lib.StandardFonts.Courier,
    lib.StandardFonts.CourierBold,
    lib.StandardFonts.CourierOblique,
    lib.StandardFonts.CourierBoldOblique,
  ],
})

function makeFontGetter(doc: PDFDocument, lib: PdfLib) {
  const cache = new Map<string, Promise<FontHandle>>()
  let fontkitReady: Promise<void> | null = null

  const prepareFontkit = () => {
    if (!fontkitReady) {
      fontkitReady = import('@pdf-lib/fontkit').then((module) => {
        doc.registerFontkit(module.default)
      })
    }
    return fontkitReady
  }

  const standardFont = async (family: FontKind, bold: boolean, italic: boolean) => {
    const table = standardTable(lib)
    const index = bold && italic ? 3 : bold ? 1 : italic ? 2 : 0
    return doc.embedFont(table[family][index])
  }

  return async (
    face: FontFaceId | undefined,
    family: FontKind = 'sans',
    bold = false,
    italic = false,
  ): Promise<FontHandle> => {
    const variant = variantFor(bold, italic)
    const key = face ? `face:${face}:${variant}` : `std:${family}:${variant}`
    const cached = cache.get(key)
    if (cached) return cached

    const pending = (async (): Promise<FontHandle> => {
      if (face) {
        try {
          await prepareFontkit()
          const bytes = await loadFontBytes(face, variant)
          // @pdf-lib/fontkit truncates Carlito's glyf table during subsetting,
          // which leaves extractable text that renders blank. Embed Carlito
          // whole (only the used variant, ~300 kB compressed); every other
          // bundled face subsets cleanly.
          const subset = face !== 'carlito'
          const font = await doc.embedFont(bytes, { subset })
          return { font, custom: true, charset: new Set(font.getCharacterSet()) }
        } catch {
          // A font can fail to embed on unusual platforms. Export should still
          // succeed, so fall back to the matching standard PDF face.
        }
      }
      const font = await standardFont(family, bold, italic)
      return { font, custom: false, charset: null }
    })()

    cache.set(key, pending)
    return pending
  }
}

/**
 * Paints either the visual masks (covers and text backgrounds) or the
 * destructive redaction masks. Secure masks are always solid black and are
 * painted after replacement text so they win any overlap, matching preview.
 */
function drawMasks(
  page: PDFPage,
  patches: Patch[],
  lib: PdfLib,
  secureOnly: boolean,
) {
  for (const patch of patches) {
    const secure = isSecurePatch(patch)
    if (secureOnly ? !secure : secure || !isMaskPatch(patch)) continue
    const box = page.getCropBox()
    page.drawRectangle({
      x: box.x + patch.x,
      y: box.y + box.height - patch.y - patch.h,
      width: Math.max(0.5, patch.w),
      height: Math.max(0.5, patch.h),
      color: secure ? lib.rgb(0, 0, 0) : parseColor(lib, patch.bgColor ?? '#ffffff'),
    })
  }
}

async function drawTextPatches(
  page: PDFPage,
  patches: Patch[],
  getFont: ReturnType<typeof makeFontGetter>,
  lib: PdfLib,
) {
  for (const patch of patches) {
    if (patch.kind !== 'text' || !patch.text?.trim()) continue
    const box = page.getCropBox()
    const handle = await getFont(
      patch.fontFace,
      patch.fontFamily ?? 'sans',
      Boolean(patch.bold),
      Boolean(patch.italic),
    )
    const font = handle.font
    const size = Math.min(200, Math.max(4, patch.fontSize ?? 12))
    const lines = sanitize(patch.text, handle.charset ?? undefined).split('\n')
    // A word replacement grows into following whitespace when it can, so the
    // patch box is the final allowed width. Shrink the face just enough to fit
    // instead of letting a longer word run over its neighbour.
    let drawSize = size
    if (patch.wordId) {
      const widest = Math.max(
        0,
        ...lines.map((line) => font.widthOfTextAtSize(line, size)),
      )
      if (widest > patch.w && widest > 0) {
        drawSize = Math.max(1, size * (patch.w / widest))
      }
    }
    const ascent = font.heightAtSize(drawSize, { descender: false })
    const top = box.y + box.height - patch.y
    const baseline = top - (patch.baseline == null ? ascent : patch.baseline)
    const color = parseColor(lib, patch.color ?? '#111827')
    for (const [index, line] of lines.entries()) {
      const lineBaseline = baseline - index * drawSize * 1.18
      page.drawText(line, {
        x: box.x + patch.x,
        y: lineBaseline,
        size: drawSize,
        font,
        color,
      })
      if (patch.underline && line) {
        const width = font.widthOfTextAtSize(line, drawSize)
        page.drawLine({
          start: { x: box.x + patch.x, y: lineBaseline - drawSize * 0.12 },
          end: { x: box.x + patch.x + width, y: lineBaseline - drawSize * 0.12 },
          thickness: Math.max(0.5, drawSize * 0.055),
          color,
        })
      }
    }
  }
}

/**
 * Adds the invisible OCR layer for one page. On flattened pages the original
 * text is gone, so OCR is written back even when it was only a preview before.
 * Lines that touch a cover or redaction are omitted; `padding` keeps them clear
 * of the box edge so verification does not fail on descenders.
 */
async function addOcrLayer(
  page: PDFPage,
  result: OcrPage | undefined,
  masks: Patch[],
  box: { x: number; y: number; width: number; height: number },
  getFont: ReturnType<typeof makeFontGetter>,
  lib: PdfLib,
  flattened: boolean,
) {
  if (!result || result.status !== 'done' || !result.lines.length) return
  if (!flattened && !result.applyTextLayer) return
  if (page.getRotation().angle % 360 !== 0) return
  const { font } = await getFont(undefined, 'sans')
  const padding = flattened ? 1.5 : 0
  for (const line of result.lines) {
    const lineBounds = {
      x: line.x - padding,
      y: line.y - padding,
      width: line.width + padding * 2,
      height: line.height + padding * 2,
    }

    // When word boxes exist, write them separately so a single-word edit only
    // removes that word from the searchable layer instead of the whole line.
    if (line.words?.length) {
      for (const word of line.words) {
        const bounds = {
          x: word.x - padding,
          y: word.y - padding,
          width: word.width + padding * 2,
          height: word.height + padding * 2,
        }
        if (masks.some((mask) => intersects(mask, bounds))) continue
        const text = sanitize(word.text).trim()
        if (!text) continue
        const baseSize = Math.min(
          72,
          Math.max(4, word.fontSize ?? line.height * 0.82),
        )
        const naturalWidth = font.widthOfTextAtSize(text, baseSize)
        const fit =
          naturalWidth > 0 && word.width > 0
            ? Math.min(1.6, Math.max(0.6, word.width / naturalWidth))
            : 1
        const size = baseSize * fit
        const baselineTop =
          word.y +
          (word.baseline == null ? word.height * 0.8 : word.baseline)
        page.drawText(text, {
          x: box.x + word.x,
          y: box.y + box.height - baselineTop,
          size,
          font,
          color: lib.rgb(0, 0, 0),
          opacity: 0,
        })
      }
      continue
    }

    if (masks.some((mask) => intersects(mask, lineBounds))) continue
    const text = sanitize(line.text).trim()
    if (!text) continue
    const baseSize = Math.min(72, Math.max(4, line.height * 0.82))
    const naturalWidth = font.widthOfTextAtSize(text, baseSize)
    const fit =
      naturalWidth > 0 && line.width > 0
        ? Math.min(1.6, Math.max(0.6, line.width / naturalWidth))
        : 1
    const size = baseSize * fit
    const baselineTop =
      line.baseline == null ? line.y + line.height * 0.8 : line.y + line.baseline
    page.drawText(text, {
      x: box.x + line.x,
      y: box.y + box.height - baselineTop,
      size,
      font,
      color: lib.rgb(0, 0, 0),
      opacity: 0,
    })
  }
}

function rejectRotatedPatches(pages: PDFPage[], patches: Patch[]) {
  for (const patch of patches) {
    const page = pages[patch.pageIndex]
    if (!page) continue
    if (page.getRotation().angle % 360 !== 0) {
      throw new Error(
        `Page ${patch.pageIndex + 1} uses a /Rotate entry. Rotation-aware overlay export is not implemented yet.`,
      )
    }
  }
}

/**
 * Non-destructive export: keep the original page content and paint covers,
 * replacement text, and the invisible OCR layer on top. This path is
 * byte-for-byte behaviourally identical to the original exporter.
 */
async function exportOverlayPdf(
  bytes: Uint8Array,
  patches: Patch[],
  ocr: Record<number, OcrPage>,
  options: ExportOptions,
): Promise<Uint8Array> {
  const lib = await import('pdf-lib')
  const doc = await lib.PDFDocument.load(bytes)
  const pages = doc.getPages()
  rejectRotatedPatches(pages, patches)
  const getFont = makeFontGetter(doc, lib)

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pagePatches = patches.filter((patch) => patch.pageIndex === pageIndex)
    if (!pagePatches.length) continue
    drawMasks(pages[pageIndex], pagePatches, lib, false)
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pagePatches = patches.filter((patch) => patch.pageIndex === pageIndex)
    if (!pagePatches.length) continue
    await drawTextPatches(pages[pageIndex], pagePatches, getFont, lib)
  }

  if (options.searchable) {
    for (const [key, result] of Object.entries(ocr)) {
      const pageIndex = Number(key) - 1
      const page = pages[pageIndex]
      if (!page) continue
      const masks = patches.filter(
        (patch) => patch.pageIndex === pageIndex && isMaskPatch(patch),
      )
      await addOcrLayer(page, result, masks, page.getCropBox(), getFont, lib, false)
    }
  }

  doc.setProducer('OnDiv PDF Editor')
  doc.setModificationDate(new Date())
  return doc.save()
}

/** A4 at 300 DPI is ~8.7 MP; keep pathological page sizes within budget. */
const TARGET_DPI = 300
const MAX_RASTER_DIMENSION = 10_000
const MAX_RASTER_PIXELS = 24_000_000

function rasterScale(width: number, height: number) {
  let scale = TARGET_DPI / 72
  const longest = Math.max(width, height)
  if (longest * scale > MAX_RASTER_DIMENSION) {
    scale = MAX_RASTER_DIMENSION / longest
  }
  if (width * height * scale * scale > MAX_RASTER_PIXELS) {
    scale = Math.sqrt(MAX_RASTER_PIXELS / (width * height))
  }
  return Math.max(0.1, scale)
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  )
  if (!blob) throw new Error('Could not encode a redacted page image.')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Renders one page with its overlays applied to a temporary single-page PDF,
 * then rasterizes it at up to 300 DPI. The temporary file is never part of the
 * output; only the resulting pixels are.
 */
async function flattenPage(
  source: PDFDocument,
  pageIndex: number,
  pagePatches: Patch[],
  lib: PdfLib,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const temp = await lib.PDFDocument.create()
  const [page] = await temp.copyPages(source, [pageIndex])
  temp.addPage(page)

  // Annotations can paint above page content; drop them before rasterizing so
  // a comment or form widget cannot hide a redaction box.
  stripPageKeys(page, lib)

  const getFont = makeFontGetter(temp, lib)
  drawMasks(page, pagePatches, lib, false)
  await drawTextPatches(page, pagePatches, getFont, lib)
  drawMasks(page, pagePatches, lib, true)
  // pdf-lib's draw helpers normalize the page and add an empty /Annots
  // array; strip again so nothing annotation-shaped reaches the raster.
  stripPageKeys(page, lib)

  const tempBytes = await temp.save()
  const pdf = await openPdf(tempBytes)
  try {
    const proxy = await pdf.getPage(1)
    const base = proxy.getViewport({ scale: 1 })
    const { canvas } = await renderPageToCanvas(proxy, rasterScale(base.width, base.height))
    try {
      return {
        bytes: await canvasToJpeg(canvas),
        width: base.width,
        height: base.height,
      }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await closePdf(pdf).catch(() => undefined)
  }
}

const PAGE_PRIVATE_KEYS = [
  'Annots',
  'AA',
  'Metadata',
  'PieceInfo',
  'StructParents',
  'Tabs',
  'Thumb',
  'AF',
]

const DOCUMENT_PRIVATE_KEYS = [
  'Metadata',
  'PieceInfo',
  'StructTreeRoot',
  'MarkInfo',
  'Outlines',
  'Names',
  'AcroForm',
  'OpenAction',
  'AA',
  'JavaScript',
  'Perms',
  'AF',
  'Collection',
  'PageLabels',
]

function stripPageKeys(page: PDFPage, lib: PdfLib) {
  for (const key of PAGE_PRIVATE_KEYS) page.node.delete(lib.PDFName.of(key))
}

function stripDocumentKeys(doc: PDFDocument, lib: PdfLib) {
  for (const key of DOCUMENT_PRIVATE_KEYS) doc.catalog.delete(lib.PDFName.of(key))
}

/**
 * Re-opens the finished file and fails closed if any extractable text still
 * overlaps a redaction rectangle. With searchable export enabled this also
 * checks that the freshly written OCR layer avoided the redacted areas.
 */
async function verifySecureExport(
  result: Uint8Array,
  secureByPage: Map<number, Patch[]>,
) {
  let pdf
  try {
    pdf = await openPdf(result)
  } catch (error) {
    throw new Error(
      `Redaction verification could not reopen the exported PDF: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  try {
    for (const [pageIndex, rects] of secureByPage) {
      const page = await pdf.getPage(pageIndex + 1)
      const lines = await extractTextLines(page)
      const hit = lines.find((line) =>
        rects.some((rect) => intersects(rect, line)),
      )
      if (hit) {
        throw new Error(
          `Redaction verification failed on page ${pageIndex + 1}: extractable text still overlaps a redaction area.`,
        )
      }
    }
  } finally {
    await closePdf(pdf).catch(() => undefined)
  }
}

/**
 * Destructive export. The document is rebuilt from scratch: pages without
 * redactions are copied and sanitized, and every page carrying a secure
 * redaction is replaced by a high-resolution image of the composed page.
 */
async function exportSecurePdf(
  bytes: Uint8Array,
  patches: Patch[],
  ocr: Record<number, OcrPage>,
  options: ExportOptions,
): Promise<Uint8Array> {
  const lib = await import('pdf-lib')
  const source = await lib.PDFDocument.load(bytes)
  const sourcePages = source.getPages()
  rejectRotatedPatches(sourcePages, patches)

  const secureByPage = new Map<number, Patch[]>()
  for (const patch of patches) {
    if (!isSecurePatch(patch) || !sourcePages[patch.pageIndex]) continue
    const list = secureByPage.get(patch.pageIndex) ?? []
    list.push(patch)
    secureByPage.set(patch.pageIndex, list)
  }

  const out = await lib.PDFDocument.create()
  const getFont = makeFontGetter(out, lib)

  for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
    const pagePatches = patches.filter((patch) => patch.pageIndex === pageIndex)
    const masks = pagePatches.filter(isMaskPatch)

    if (secureByPage.has(pageIndex)) {
      const flat = await flattenPage(source, pageIndex, pagePatches, lib)
      const image = await out.embedJpg(flat.bytes)
      const outPage = out.addPage([flat.width, flat.height])
      outPage.drawImage(image, {
        x: 0,
        y: 0,
        width: flat.width,
        height: flat.height,
      })
      if (options.searchable) {
        await addOcrLayer(
          outPage,
          ocr[pageIndex + 1],
          masks,
          { x: 0, y: 0, width: flat.width, height: flat.height },
          getFont,
          lib,
          true,
        )
      }
      stripPageKeys(outPage, lib)
      continue
    }

    const [copied] = await out.copyPages(source, [pageIndex])
    out.addPage(copied)
    stripPageKeys(copied, lib)
    drawMasks(copied, pagePatches, lib, false)
    await drawTextPatches(copied, pagePatches, getFont, lib)
    if (options.searchable) {
      await addOcrLayer(
        copied,
        ocr[pageIndex + 1],
        masks,
        copied.getCropBox(),
        getFont,
        lib,
        false,
      )
    }
    stripPageKeys(copied, lib)
  }

  stripDocumentKeys(out, lib)
  const now = new Date()
  out.setProducer('OnDiv PDF Editor')
  out.setCreator('OnDiv PDF Editor')
  out.setCreationDate(now)
  out.setModificationDate(now)

  const result = await out.save()
  await verifySecureExport(result, secureByPage)
  return result
}

export async function exportPdf(
  bytes: Uint8Array,
  patches: Patch[],
  ocr: Record<number, OcrPage>,
  options: ExportOptions,
): Promise<Uint8Array> {
  if (patches.some(isSecurePatch)) {
    return exportSecurePdf(bytes, patches, ocr, options)
  }
  return exportOverlayPdf(bytes, patches, ocr, options)
}

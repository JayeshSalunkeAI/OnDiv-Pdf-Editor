import type { FontFaceId, FontKind, FontVariant } from '../types'
import { extractInkMask, normalizeInk } from './ocr-style'
import type { PixelBox } from './ocr-style'

import liberationRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import liberationBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import liberationItalicUrl from '../assets/fonts/LiberationSans-Italic.ttf?url'
import liberationBoldItalicUrl from '../assets/fonts/LiberationSans-BoldItalic.ttf?url'
import carlitoRegularUrl from '../assets/fonts/Carlito-Regular.ttf?url'
import carlitoBoldUrl from '../assets/fonts/Carlito-Bold.ttf?url'
import carlitoItalicUrl from '../assets/fonts/Carlito-Italic.ttf?url'
import carlitoBoldItalicUrl from '../assets/fonts/Carlito-BoldItalic.ttf?url'
import tinosRegularUrl from '../assets/fonts/Tinos-Regular.ttf?url'
import tinosBoldUrl from '../assets/fonts/Tinos-Bold.ttf?url'
import tinosItalicUrl from '../assets/fonts/Tinos-Italic.ttf?url'
import tinosBoldItalicUrl from '../assets/fonts/Tinos-BoldItalic.ttf?url'
import caladeaRegularUrl from '../assets/fonts/Caladea-Regular.ttf?url'
import caladeaBoldUrl from '../assets/fonts/Caladea-Bold.ttf?url'
import caladeaItalicUrl from '../assets/fonts/Caladea-Italic.ttf?url'
import caladeaBoldItalicUrl from '../assets/fonts/Caladea-BoldItalic.ttf?url'
import cousineRegularUrl from '../assets/fonts/Cousine-Regular.ttf?url'
import cousineBoldUrl from '../assets/fonts/Cousine-Bold.ttf?url'
import cousineItalicUrl from '../assets/fonts/Cousine-Italic.ttf?url'
import cousineBoldItalicUrl from '../assets/fonts/Cousine-BoldItalic.ttf?url'

export interface FontFaceDefinition {
  id: FontFaceId
  label: string
  shortLabel: string
  kind: FontKind
  cssFamily: string
  /** Lower-case fragments found in PDF font names. */
  aliases: string[]
  variants: Record<FontVariant, string>
  license: string
}

export const FONT_FACES: readonly FontFaceDefinition[] = [
  {
    id: 'liberation',
    label: 'Liberation Sans',
    shortLabel: 'Liberation Sans',
    kind: 'sans',
    cssFamily: 'OnDiv Liberation Sans',
    aliases: ['liberation sans', 'liberation', 'arial', 'helvetica', 'arimo', 'sans-serif'],
    variants: {
      regular: liberationRegularUrl,
      bold: liberationBoldUrl,
      italic: liberationItalicUrl,
      boldItalic: liberationBoldItalicUrl,
    },
    license: 'SIL Open Font License 1.1 · Arial-metric',
  },
  {
    id: 'carlito',
    label: 'Carlito',
    shortLabel: 'Carlito',
    kind: 'sans',
    cssFamily: 'OnDiv Carlito',
    aliases: ['carlito', 'calibri'],
    variants: {
      regular: carlitoRegularUrl,
      bold: carlitoBoldUrl,
      italic: carlitoItalicUrl,
      boldItalic: carlitoBoldItalicUrl,
    },
    license: 'SIL Open Font License 1.1 · Calibri-metric',
  },
  {
    id: 'tinos',
    label: 'Tinos',
    shortLabel: 'Tinos',
    kind: 'serif',
    cssFamily: 'OnDiv Tinos',
    aliases: ['tinos', 'times new roman', 'times', 'georgia', 'garamond', 'book antiqua'],
    variants: {
      regular: tinosRegularUrl,
      bold: tinosBoldUrl,
      italic: tinosItalicUrl,
      boldItalic: tinosBoldItalicUrl,
    },
    license: 'SIL Open Font License 1.1 · Times-metric',
  },
  {
    id: 'caladea',
    label: 'Caladea',
    shortLabel: 'Caladea',
    kind: 'serif',
    cssFamily: 'OnDiv Caladea',
    aliases: ['caladea', 'cambria'],
    variants: {
      regular: caladeaRegularUrl,
      bold: caladeaBoldUrl,
      italic: caladeaItalicUrl,
      boldItalic: caladeaBoldItalicUrl,
    },
    license: 'SIL Open Font License 1.1 · Cambria-metric',
  },
  {
    id: 'cousine',
    label: 'Cousine',
    shortLabel: 'Cousine',
    kind: 'mono',
    cssFamily: 'OnDiv Cousine',
    aliases: ['cousine', 'courier new', 'courier', 'consolas', 'monospace'],
    variants: {
      regular: cousineRegularUrl,
      bold: cousineBoldUrl,
      italic: cousineItalicUrl,
      boldItalic: cousineBoldItalicUrl,
    },
    license: 'SIL Open Font License 1.1 · Courier-metric',
  },
]

export const FONT_FACE_BY_ID: Record<FontFaceId, FontFaceDefinition> = Object.fromEntries(
  FONT_FACES.map((face) => [face.id, face]),
) as Record<FontFaceId, FontFaceDefinition>

export const DEFAULT_FACE_BY_KIND: Record<FontKind, FontFaceId> = {
  sans: 'liberation',
  serif: 'tinos',
  mono: 'cousine',
}

export const fontFaceLabel = (id: FontFaceId | undefined) =>
  id ? FONT_FACE_BY_ID[id].label : ''

export function isFontFaceId(value: string | undefined): value is FontFaceId {
  return Boolean(value && value in FONT_FACE_BY_ID)
}

export function fontFaceKind(id: FontFaceId): FontKind {
  return FONT_FACE_BY_ID[id].kind
}

export function variantFor(bold: boolean, italic: boolean): FontVariant {
  if (bold && italic) return 'boldItalic'
  if (bold) return 'bold'
  if (italic) return 'italic'
  return 'regular'
}

/** Maps an arbitrary PDF font name to the closest bundled face. */
export function fontFaceFromName(
  name: string | undefined,
  kind: FontKind = 'sans',
): FontFaceId {
  const value = (name ?? '').toLowerCase()
  if (/carlito|calibri/.test(value)) return 'carlito'
  if (/caladea|cambria/.test(value)) return 'caladea'
  if (/cousine|courier|consol|mono/.test(value)) return 'cousine'
  if (/tinos|times|georgia|garamond|serif|book/.test(value)) return 'tinos'
  if (/liberation|arial|helvetica|arimo/.test(value)) return 'liberation'
  return DEFAULT_FACE_BY_KIND[kind]
}

export function nativeFontStyle(name: string | undefined) {
  const value = (name ?? '').toLowerCase()
  return {
    bold: /(bold|black|heavy|semibold|demi|extrabold|ultrabold)/.test(value),
    italic: /(italic|oblique)/.test(value),
  }
}

const FALLBACK_STACK: Record<FontKind, string> = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'Consolas, "Courier New", monospace',
}

/** CSS stack for previews: bundled face first, then the generic fallback. */
export function previewFontFamily(kind: FontKind, face?: FontFaceId) {
  if (!face) return FALLBACK_STACK[kind]
  return `"${FONT_FACE_BY_ID[face].cssFamily}", ${FALLBACK_STACK[kind]}`
}

let stylesInjected = false

/** Injects the @font-face rules once. Browsers fetch each file on first use. */
export function ensureFontStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const style = document.createElement('style')
  style.id = 'ondiv-font-faces'
  style.textContent = FONT_FACES.flatMap((face) =>
    (Object.entries(face.variants) as [FontVariant, string][]).map(([variant, url]) => {
      const italic = variant === 'italic' || variant === 'boldItalic'
      const bold = variant === 'bold' || variant === 'boldItalic'
      return `@font-face{font-family:"${face.cssFamily}";src:url("${url}") format("truetype");font-weight:${bold ? 700 : 400};font-style:${italic ? 'italic' : 'normal'};font-display:swap}`
    }),
  ).join('\n')
  document.head.append(style)
}

const fontStyleCache = new Map<string, Promise<void>>()

/** Resolves once the given variant is available to canvas and CSS rendering. */
export function ensureFontVariant(
  faceId: FontFaceId,
  variant: FontVariant = 'regular',
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  ensureFontStyles()
  const key = `${faceId}:${variant}`
  const cached = fontStyleCache.get(key)
  if (cached) return cached

  const face = FONT_FACE_BY_ID[faceId]
  const bold = variant === 'bold' || variant === 'boldItalic'
  const italic = variant === 'italic' || variant === 'boldItalic'
  const spec = `${italic ? 'italic ' : ''}${bold ? 700 : 400} 64px "${face.cssFamily}"`
  const promise = document.fonts
    .load(spec, 'AaBbGgJjQq0123456789')
    .then(() => undefined)
    .catch(() => undefined)
  fontStyleCache.set(key, promise)
  return promise
}

const bytesCache = new Map<string, Promise<Uint8Array>>()

/** Fetches the raw TTF used for PDF embedding. Cached by asset URL. */
export function loadFontBytes(
  faceId: FontFaceId,
  variant: FontVariant,
): Promise<Uint8Array> {
  const url = FONT_FACE_BY_ID[faceId].variants[variant]
  const cached = bytesCache.get(url)
  if (cached) return cached
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Could not load the bundled ${FONT_FACE_BY_ID[faceId].label} font.`)
    }
    return new Uint8Array(await response.arrayBuffer())
  })
  bytesCache.set(url, promise)
  promise.catch(() => bytesCache.delete(url))
  return promise
}

const GRID_WIDTH = 160
const GRID_HEIGHT = 44
const MATCH_FONT_SIZE = 52
const MAX_MATCH_CHARS = 96
const MAX_MATCH_LINES = 10

let scratchCanvas: HTMLCanvasElement | null = null
let measureCanvas: HTMLCanvasElement | null = null

function scratch() {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas')
  return scratchCanvas
}

function measureText(text: string, font: string) {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return text.length * MATCH_FONT_SIZE * 0.55
  ctx.font = font
  return ctx.measureText(text).width
}

function canvasFontSpec(faceId: FontFaceId, variant: FontVariant) {
  const face = FONT_FACE_BY_ID[faceId]
  const bold = variant === 'bold' || variant === 'boldItalic'
  const italic = variant === 'italic' || variant === 'boldItalic'
  return `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${MATCH_FONT_SIZE}px "${face.cssFamily}"`
}

/** Renders a line of OCR text in one bundled variant and returns its ink mask. */
function renderLineMask(
  text: string,
  faceId: FontFaceId,
  variant: FontVariant,
) {
  const value = text.replace(/\s+/g, ' ').trim().slice(0, MAX_MATCH_CHARS)
  if (!value) return null
  const font = canvasFontSpec(faceId, variant)
  const padding = 18
  const width = Math.max(32, Math.ceil(measureText(value, font)) + padding * 2)
  const height = Math.ceil(MATCH_FONT_SIZE * 1.8)
  const canvas = scratch()
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.font = font
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(value, padding, Math.round(MATCH_FONT_SIZE * 1.32))
  return extractInkMask(canvas, { x0: 0, y0: 0, x1: width, y1: height }, 0)
}

/** XOR/union distance between two normalized masks, with a small shift search. */
function maskDistance(a: Uint8Array, b: Uint8Array) {
  let best = 1
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      let mismatch = 0
      let union = 0
      for (let y = 1; y < GRID_HEIGHT - 1; y++) {
        const by = y + dy
        if (by < 0 || by >= GRID_HEIGHT) continue
        for (let x = 1; x < GRID_WIDTH - 1; x++) {
          const bx = x + dx
          if (bx < 0 || bx >= GRID_WIDTH) continue
          const av = a[y * GRID_WIDTH + x]
          const bv = b[by * GRID_WIDTH + bx]
          if (av || bv) union++
          if (av !== bv) mismatch++
        }
      }
      if (union) best = Math.min(best, mismatch / union)
    }
  }
  return best
}

export interface FontMatchSample {
  text: string
  box: PixelBox
}

export interface FontMatchResult {
  face: FontFaceId
  confidence: number
  scores: Record<FontFaceId, number>
}

const defaultScores = () =>
  Object.fromEntries(FONT_FACES.map((face) => [face.id, 0])) as Record<FontFaceId, number>

/**
 * Compares OCR line crops with the bundled families. Each line votes for the
 * family whose glyph shapes and proportions fit best; the page winner is the
 * family with the most weighted votes. Regular and bold variants are tried for
 * every family so stroke weight does not decide the family.
 */
export async function matchPageFont(
  canvas: HTMLCanvasElement,
  samples: FontMatchSample[],
): Promise<FontMatchResult> {
  const fallback: FontMatchResult = {
    face: 'liberation',
    confidence: 0,
    scores: defaultScores(),
  }
  if (typeof document === 'undefined' || !samples.length) return fallback

  await Promise.all(
    FONT_FACES.flatMap((face) => [
      ensureFontVariant(face.id, 'regular'),
      ensureFontVariant(face.id, 'bold'),
    ]),
  )

  const chosen = samples
    .filter((sample) => sample.text.replace(/\s+/g, ' ').trim().length >= 6)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, MAX_MATCH_LINES)

  const totals = defaultScores()
  const votes = defaultScores()
  let totalWeight = 0

  for (const sample of chosen) {
    const source = extractInkMask(canvas, sample.box, 1)
    if (!source || source.width < 10 || source.height < 5) continue
    const sourceMask = normalizeInk(source, GRID_WIDTH, GRID_HEIGHT)
    const weight = Math.min(120, sample.text.trim().length) * Math.max(1, source.height)

    const lineScores = Object.fromEntries(
      FONT_FACES.map((face) => [face.id, Infinity]),
    ) as Record<FontFaceId, number>
    for (const face of FONT_FACES) {
      for (const variant of ['regular', 'bold'] as FontVariant[]) {
        const rendered = renderLineMask(sample.text, face.id, variant)
        if (!rendered) continue
        const distance = maskDistance(
          sourceMask,
          normalizeInk(rendered, GRID_WIDTH, GRID_HEIGHT),
        )
        lineScores[face.id] = Math.min(lineScores[face.id], distance)
      }
    }

    let winner: FontFaceId | null = null
    let winnerScore = Infinity
    for (const face of FONT_FACES) {
      const score = lineScores[face.id]
      if (!Number.isFinite(score)) continue
      totals[face.id] += score * weight
      if (score < winnerScore) {
        winnerScore = score
        winner = face.id
      }
    }
    if (winner) {
      votes[winner] += weight
      totalWeight += weight
    }
  }

  if (!totalWeight) return fallback

  let face: FontFaceId = 'liberation'
  let bestVotes = -1
  let bestTotal = Infinity
  for (const definition of FONT_FACES) {
    const vote = votes[definition.id]
    const total = totals[definition.id]
    if (vote > bestVotes || (vote === bestVotes && total < bestTotal)) {
      face = definition.id
      bestVotes = vote
      bestTotal = total
    }
  }

  const scores = defaultScores()
  for (const definition of FONT_FACES) {
    scores[definition.id] = votes[definition.id] / totalWeight
  }

  return {
    face,
    confidence: votes[face] / totalWeight,
    scores,
  }
}

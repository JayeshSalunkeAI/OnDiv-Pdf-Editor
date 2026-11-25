/**
 * Pixel-level style analysis for scanned text lines. Everything here works on
 * the OCR render canvas, so the measurements share the same resolution as
 * Tesseract's boxes.
 */

export interface PixelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface InkMask {
  mask: Uint8Array
  width: number
  height: number
  inkCount: number
}

export interface OcrLineStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  background: string
  coreRatio: number
  slant: number
}

export interface OcrWordStyle {
  coreRatio: number
}

interface CropPixels {
  width: number
  height: number
  originX: number
  originY: number
  gray: Uint8Array
  rgba: Uint8ClampedArray
  threshold: number
  /** Full-crop mask. Use {@link tightMask} for measurements. */
  ink: Uint8Array
  inkCount: number
  left: number
  top: number
  right: number
  bottom: number
}

const isInk = (crop: CropPixels, x: number, y: number) => crop.ink[y * crop.width + x] === 1

function otsuThreshold(histogram: Uint32Array, total: number) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]
  let sumBehind = 0
  let weightBehind = 0
  let best = 0
  let threshold = 128
  for (let i = 0; i < 256; i++) {
    weightBehind += histogram[i]
    if (!weightBehind) continue
    const weightAhead = total - weightBehind
    if (!weightAhead) break
    sumBehind += i * histogram[i]
    const meanBehind = sumBehind / weightBehind
    const meanAhead = (sum - sumBehind) / weightAhead
    const between = weightBehind * weightAhead * (meanBehind - meanAhead) ** 2
    if (between > best) {
      best = between
      threshold = i
    }
  }
  return threshold
}

function readCrop(
  canvas: HTMLCanvasElement,
  box: PixelBox,
  pad: number,
  withColor: boolean,
): CropPixels | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const originX = Math.max(0, Math.floor(box.x0) - pad)
  const originY = Math.max(0, Math.floor(box.y0) - pad)
  const width = Math.min(
    canvas.width - originX,
    Math.max(1, Math.ceil(box.x1 - box.x0) + pad * 2),
  )
  const height = Math.min(
    canvas.height - originY,
    Math.max(1, Math.ceil(box.y1 - box.y0) + pad * 2),
  )
  if (width < 2 || height < 2) return null

  let rgba: Uint8ClampedArray
  try {
    rgba = ctx.getImageData(originX, originY, width, height).data
  } catch {
    return null
  }

  const gray = new Uint8Array(width * height)
  const histogram = new Uint32Array(256)
  for (let i = 0; i < width * height; i++) {
    const value = Math.round(
      0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2],
    )
    gray[i] = value
    histogram[value]++
  }

  const threshold = otsuThreshold(histogram, width * height)
  const ink = new Uint8Array(width * height)
  let inkCount = 0
  let left = width
  let top = height
  let right = 0
  let bottom = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] <= threshold) {
        const index = y * width + x
        ink[index] = 1
        inkCount++
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (!inkCount || left > right || top > bottom) return null

  return {
    width,
    height,
    originX,
    originY,
    gray,
    rgba: withColor ? rgba : new Uint8ClampedArray(0),
    threshold,
    ink,
    inkCount,
    left,
    top,
    right,
    bottom,
  }
}

function tightMask(crop: CropPixels): InkMask {
  const width = crop.right - crop.left + 1
  const height = crop.bottom - crop.top + 1
  const mask = new Uint8Array(width * height)
  let inkCount = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (crop.ink[(crop.top + y) * crop.width + crop.left + x]) {
        mask[y * width + x] = 1
        inkCount++
      }
    }
  }
  return { mask, width, height, inkCount }
}

/** Extracts the tight ink mask of a region, ignoring surrounding whitespace. */
export function extractInkMask(
  canvas: HTMLCanvasElement,
  box: PixelBox,
  pad = 1,
): InkMask | null {
  const crop = readCrop(canvas, box, pad, false)
  return crop ? tightMask(crop) : null
}

/**
 * Fits a mask into a fixed grid while preserving its aspect ratio. Used to
 * compare OCR line crops with rendered font candidates at the same scale.
 */
export function normalizeInk(mask: InkMask, gridWidth: number, gridHeight: number) {
  const out = new Uint8Array(gridWidth * gridHeight)
  if (!mask.width || !mask.height) return out
  const scale = Math.min(gridWidth / mask.width, gridHeight / mask.height)
  const width = Math.max(1, Math.round(mask.width * scale))
  const height = Math.max(1, Math.round(mask.height * scale))
  const offsetX = Math.floor((gridWidth - width) / 2)
  const offsetY = Math.floor((gridHeight - height) / 2)
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(mask.height - 1, Math.floor((y / height) * mask.height))
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(mask.width - 1, Math.floor((x / width) * mask.width))
      if (mask.mask[sourceY * mask.width + sourceX]) {
        out[(offsetY + y) * gridWidth + offsetX + x] = 1
      }
    }
  }
  return out
}

/** Distance from every ink pixel to the nearest background pixel. */
function distanceTransform(mask: InkMask): Float32Array {
  const { mask: ink, width, height } = mask
  const infinity = 1e9
  const distance = new Float32Array(width * height)
  for (let i = 0; i < distance.length; i++) {
    distance[i] = ink[i] ? infinity : 0
  }

  const straight = 1
  const diagonal = Math.SQRT2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (!ink[index]) continue
      let value = distance[index]
      if (x > 0) value = Math.min(value, distance[index - 1] + straight)
      if (y > 0) value = Math.min(value, distance[index - width] + straight)
      if (x > 0 && y > 0) {
        value = Math.min(value, distance[index - width - 1] + diagonal)
      }
      if (x < width - 1 && y > 0) {
        value = Math.min(value, distance[index - width + 1] + diagonal)
      }
      distance[index] = value
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x
      if (!ink[index]) continue
      let value = distance[index]
      if (x < width - 1) value = Math.min(value, distance[index + 1] + straight)
      if (y < height - 1) value = Math.min(value, distance[index + width] + straight)
      if (x < width - 1 && y < height - 1) {
        value = Math.min(value, distance[index + width + 1] + diagonal)
      }
      if (x > 0 && y < height - 1) {
        value = Math.min(value, distance[index + width - 1] + diagonal)
      }
      distance[index] = value
    }
  }
  return distance
}

/**
 * Fraction of ink pixels that sit in the thick core of a stroke. The cutoff is
 * proportional to the line's cap height, which makes the score independent of
 * the OCR render scale and the document's font size. Bold faces keep a much
 * larger core than regular faces at the same size.
 */
export function coreRatio(mask: InkMask, capHeightPx: number): number {
  const { mask: ink, inkCount } = mask
  if (!inkCount || mask.width < 3 || mask.height < 3) return 0
  const distance = distanceTransform(mask)

  // 1.5 px at a 24 px cap height is the calibrated cutoff. Small text keeps a
  // floor so the score does not collapse to "everything is core".
  const cutoff = Math.max(1.25, 1.5 * (capHeightPx / 24))
  let core = 0
  for (let i = 0; i < distance.length; i++) {
    if (ink[i] && distance[i] >= cutoff) core++
  }
  return core / inkCount
}

/**
 * Measures one OCR word. The score is intentionally not classified here: the
 * caller compares it with the page's word-score distribution.
 */
export function analyzeWordStyle(
  canvas: HTMLCanvasElement,
  box: PixelBox,
  capHeightPx: number,
): OcrWordStyle {
  const crop = readCrop(canvas, box, 2, false)
  if (!crop) return { coreRatio: 0 }
  const mask = tightMask(crop)
  if (mask.width < 3 || mask.height < 3) return { coreRatio: 0 }
  return { coreRatio: coreRatio(mask, capHeightPx) }
}

/** Returns the best horizontal shift of the top third onto the bottom third. */
function slantOf(mask: InkMask) {
  const { mask: ink, width, height } = mask
  if (width < 20 || height < 8) return 0
  const band = Math.max(1, Math.floor(height / 3))
  const range = Math.max(2, Math.round(height * 0.35))
  let bestShift = 0
  let bestScore = -1
  for (let shift = -range; shift <= range; shift++) {
    let score = 0
    for (let y = 0; y < band; y++) {
      const bottomY = height - 1 - y
      for (let x = 0; x < width; x++) {
        if (!ink[y * width + x]) continue
        const shifted = x + shift
        if (shifted < 0 || shifted >= width) continue
        if (ink[bottomY * width + shifted]) score++
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestShift = shift
    }
  }
  return bestShift / height
}

function detectUnderline(crop: CropPixels, baselinePx: number | undefined) {
  const inkWidth = crop.right - crop.left + 1
  if (inkWidth < 20) return false
  const baselineRow = baselinePx == null ? null : baselinePx - crop.originY
  const start = Math.max(
    crop.top,
    baselineRow == null
      ? crop.top + Math.round((crop.bottom - crop.top + 1) * 0.65)
      : Math.round(baselineRow) + 1,
  )
  const end = Math.min(crop.height - 1, crop.bottom + 6)
  for (let y = start; y <= end; y++) {
    let run = 0
    let longest = 0
    for (let x = crop.left; x <= crop.right; x++) {
      if (isInk(crop, x, y)) {
        run++
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }
    if (longest >= inkWidth * 0.45 && longest >= 18) return true
  }
  return false
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`

function sampleColors(crop: CropPixels) {
  if (!crop.rgba.length) return { color: '#111827', background: '#ffffff' }
  let inkR = 0
  let inkG = 0
  let inkB = 0
  let inkWeight = 0
  let bgR = 0
  let bgG = 0
  let bgB = 0
  let bgWeight = 0

  for (let y = crop.top; y <= crop.bottom; y++) {
    for (let x = crop.left; x <= crop.right; x++) {
      const index = y * crop.width + x
      if (!crop.ink[index]) continue
      const weight = Math.max(1, crop.threshold - crop.gray[index] + 1) ** 2
      inkR += crop.rgba[index * 4] * weight
      inkG += crop.rgba[index * 4 + 1] * weight
      inkB += crop.rgba[index * 4 + 2] * weight
      inkWeight += weight
    }
  }
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const index = y * crop.width + x
      if (crop.ink[index]) continue
      const weight = Math.max(1, crop.gray[index] - crop.threshold) ** 2
      bgR += crop.rgba[index * 4] * weight
      bgG += crop.rgba[index * 4 + 1] * weight
      bgB += crop.rgba[index * 4 + 2] * weight
      bgWeight += weight
    }
  }

  return {
    color: inkWeight
      ? hex(inkR / inkWeight, inkG / inkWeight, inkB / inkWeight)
      : '#111827',
    background: bgWeight ? hex(bgR / bgWeight, bgG / bgWeight, bgB / bgWeight) : '#ffffff',
  }
}

/**
 * Measures the visual style of one OCR line. Bold detection uses average
 * stroke thickness (ink / skeleton) plus a one-pixel erosion ratio; italic uses
 * the shear between the upper and lower thirds; underline looks for a long
 * horizontal run at or below the baseline. All three are heuristics, so the
 * inspector exposes manual toggles.
 */
export function analyzeLineStyle(
  canvas: HTMLCanvasElement,
  box: PixelBox,
  baselinePx: number | undefined,
  capHeightPx: number,
): OcrLineStyle {
  const fallback: OcrLineStyle = {
    bold: false,
    italic: false,
    underline: false,
    color: '#111827',
    background: '#ffffff',
    coreRatio: 0,
    slant: 0,
  }
  const crop = readCrop(canvas, box, 6, true)
  if (!crop) return fallback

  const mask = tightMask(crop)
  if (mask.width < 6 || mask.height < 4) {
    return { ...fallback, ...sampleColors(crop) }
  }

  const ratio = coreRatio(mask, capHeightPx)
  const slant = slantOf(mask)
  const colors = sampleColors(crop)
  return {
    // Whole-line bold is only a fallback when Tesseract returns no word boxes.
    // A mixed line is intentionally left regular.
    bold: ratio >= 0.55,
    italic: slant <= -0.045,
    underline: detectUnderline(crop, baselinePx),
    color: colors.color,
    background: colors.background,
    coreRatio: ratio,
    slant,
  }
}

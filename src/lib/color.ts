export interface SampledColors {
  bg: string
  fg: string
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`

function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function distance(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Samples the rendered page under a text box so replacement text can blend
 * into scanned paper and tinted backgrounds. The most common colour is treated
 * as background; the most common sufficiently-different colour as ink.
 */
export function sampleColors(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
  pixelsPerPoint: number,
): SampledColors {
  const fallback = { bg: '#ffffff', fg: '#111827' }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback

  const px = pixelsPerPoint
  const pad = 2
  const sx = Math.max(0, Math.floor(rect.x * px) - pad)
  const sy = Math.max(0, Math.floor(rect.y * px) - pad)
  const sw = Math.min(canvas.width - sx, Math.ceil(rect.w * px) + pad * 2)
  const sh = Math.min(canvas.height - sy, Math.ceil(rect.h * px) + pad * 2)
  if (sw < 2 || sh < 2) return fallback

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data
  } catch {
    return fallback
  }

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += 8) {
    if (data[i + 3] < 32) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  if (!buckets.size) return fallback
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  const dominant = sorted[0]
  const bgRgb = [dominant.r / dominant.count, dominant.g / dominant.count, dominant.b / dominant.count]

  const ink =
    sorted
      .slice(1, 24)
      .map((bucket) => ({
        bucket,
        rgb: [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count],
      }))
      .filter(
        (entry) =>
          distance(entry.rgb, bgRgb) > 55 &&
          entry.bucket.count >= Math.max(2, dominant.count * 0.01),
      )
      .sort((a, b) => b.bucket.count - a.bucket.count)[0]?.rgb ?? null

  const bg = hex(bgRgb[0], bgRgb[1], bgRgb[2])
  if (!ink) {
    const dark = luminance(bgRgb[0], bgRgb[1], bgRgb[2]) < 0.45
    return { bg, fg: dark ? '#f8fafc' : '#111827' }
  }
  return { bg, fg: hex(ink[0], ink[1], ink[2]) }
}

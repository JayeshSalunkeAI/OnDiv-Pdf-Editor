import type { FontFaceId, TextLine, TextWord } from '../types'
import { fontFaceKind, matchPageFont } from './fonts'
import type { FontMatchSample } from './fonts'
import { analyzeLineStyle, analyzeWordStyle } from './ocr-style'
import type { OcrLineStyle } from './ocr-style'

/**
 * Fraction of a word's ink that must sit in the stroke core before the word is
 * treated as bold. The core cutoff inside {@link analyzeWordStyle} scales with
 * cap height, so this ratio stays stable across scan resolutions.
 */
const BOLD_CORE_RATIO = 0.485

interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface RawWord {
  text: string
  confidence: number
  bbox: Bbox
}

interface RawLine {
  text: string
  confidence: number
  bbox: Bbox
  baseline?: Bbox
  words: RawWord[]
}

interface RawPage {
  text: string
  confidence: number
  blocks: { paragraphs: { lines: RawLine[] }[] }[] | null
}

interface OcrWorker {
  recognize: (
    image: HTMLCanvasElement,
    options?: object,
    output?: object,
  ) => Promise<{ data: RawPage }>
  terminate: () => Promise<unknown>
}

export interface ProgressMessage {
  status: string
  progress: number
}

export interface ParsedOcr {
  text: string
  confidence: number
  lines: TextLine[]
  words: TextWord[]
  fontFace: FontFaceId
  boldLines: number
  boldWords: number
  italicLines: number
  underlinedLines: number
}

let worker: OcrWorker | null = null
let workerLanguage = ''
let workerPromise: Promise<OcrWorker> | null = null
let progressSink: (message: ProgressMessage) => void = () => {}

async function getWorker(language: string): Promise<OcrWorker> {
  if (worker && workerLanguage === language) return worker
  if (workerPromise && workerLanguage === language) return workerPromise
  if (worker) {
    const old = worker
    worker = null
    await old.terminate().catch(() => undefined)
  }

  workerLanguage = language
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js')
    const created = (await createWorker(language, 1, {
      logger: (message: ProgressMessage) => progressSink(message),
    })) as unknown as OcrWorker
    worker = created
    return created
  })()

  try {
    return await workerPromise
  } finally {
    workerPromise = null
  }
}

export async function recognizePage(
  canvas: HTMLCanvasElement,
  pageNumber: number,
  language: string,
  onProgress: (message: ProgressMessage) => void,
  scale: number,
): Promise<ParsedOcr> {
  const instance = await getWorker(language)
  progressSink = onProgress
  const result = await instance.recognize(canvas, {}, { text: true, blocks: true })
  const data = result.data
  const lines: TextLine[] = []
  const words: TextWord[] = []
  const samples: FontMatchSample[] = []
  const lineMetrics: {
    line: TextLine
    style: OcrLineStyle
    capHeightPx: number
    metrics: { word: TextWord; ratio: number }[]
  }[] = []

  const toPoints = (bbox: Bbox) => {
    const x = bbox.x0 / scale
    const y = bbox.y0 / scale
    const width = Math.max(0, (bbox.x1 - bbox.x0) / scale)
    const height = Math.max(0, (bbox.y1 - bbox.y0) / scale)
    return { x, y, width, height }
  }

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const box = toPoints(line.bbox)
        const text = line.text.replace(/\s+/g, ' ').trim()
        if (!text || box.width < 2 || box.height < 2) continue

        const baselinePx = line.baseline?.y0
        const capHeightPx =
          baselinePx != null && baselinePx > line.bbox.y0
            ? baselinePx - line.bbox.y0
            : line.bbox.y1 - line.bbox.y0
        const fontSize = Math.min(72, Math.max(6, capHeightPx / scale / 0.72))
        const style = analyzeLineStyle(canvas, line.bbox, baselinePx, capHeightPx)
        const lineId = `ocr-${pageNumber}-${lines.length}`
        const lineWords: TextWord[] = []
        const metrics: { word: TextWord; ratio: number }[] = []

        for (const word of line.words ?? []) {
          const wordText = word.text.trim()
          if (!wordText) continue
          const wordBox = toPoints(word.bbox)
          if (wordBox.width < 1 || wordBox.height < 1) continue
          const wordStyle = analyzeWordStyle(canvas, word.bbox, capHeightPx)
          const textWord: TextWord = {
            id: `${lineId}-w${lineWords.length}`,
            text: wordText,
            ...wordBox,
            lineId,
            fontSize,
            fontFamily: 'sans',
            bold: false,
            italic: style.italic,
            underline: style.underline,
            color: style.color,
            baseline:
              baselinePx != null ? baselinePx / scale - wordBox.y : undefined,
            source: 'ocr',
            confidence: word.confidence,
          }
          lineWords.push(textWord)
          metrics.push({ word: textWord, ratio: wordStyle.coreRatio })
        }

        if (!lineWords.length) {
          lineWords.push({
            id: `${lineId}-w0`,
            text,
            ...box,
            lineId,
            fontSize,
            fontFamily: 'sans',
            bold: false,
            italic: style.italic,
            underline: style.underline,
            color: style.color,
            baseline: baselinePx != null ? baselinePx / scale - box.y : undefined,
            source: 'ocr',
            confidence: line.confidence,
          })
        }

        words.push(...lineWords)
        const textLine: TextLine = {
          id: lineId,
          text,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fontSize,
          fontFamily: 'sans',
          bold: false,
          italic: style.italic,
          underline: style.underline,
          color: style.color,
          baseline: baselinePx != null ? baselinePx / scale - box.y : undefined,
          source: 'ocr',
          confidence: line.confidence,
          words: lineWords,
        }
        lines.push(textLine)
        lineMetrics.push({ line: textLine, style, capHeightPx, metrics })
        samples.push({ text, box: line.bbox })
      }
    }
  }

  if (lines.length) {
    onProgress({ status: 'matching typeface', progress: 0.99 })
    const match = await matchPageFont(canvas, samples)
    const kind = fontFaceKind(match.face)
    for (const line of lines) {
      line.fontFace = match.face
      line.fontFamily = kind
      for (const word of line.words ?? []) {
        word.fontFace = match.face
        word.fontFamily = kind
      }
    }

    const pageCutoff = pageBoldCutoff(
      lineMetrics.flatMap((entry) =>
        entry.metrics
          .filter(
            (metric) =>
              metric.word.text.trim().length >= 2 && metric.ratio > 0,
          )
          .map((metric) => metric.ratio),
      ),
    )
    let boldLines = 0
    let boldWords = 0
    for (const entry of lineMetrics) {
      let votes = 0
      let eligible = 0

      for (const metric of entry.metrics) {
        const value = metric.word.text.trim()
        const measured = value.length >= 2 && metric.ratio > 0
        if (measured) {
          eligible++
          if (metric.ratio >= pageCutoff) votes++
        }
        metric.word.bold = measured ? metric.ratio >= pageCutoff : undefined
      }

      entry.line.bold =
        eligible > 0
          ? votes / eligible > 0.5
          : entry.style.coreRatio >= pageCutoff + 0.03

      // Punctuation and words without usable ink follow the line's weight.
      for (const word of entry.line.words ?? []) {
        if (word.bold == null) word.bold = entry.line.bold
      }

      if (entry.line.bold) boldLines++
      boldWords +=
        entry.line.words?.filter((word) => word.bold).length ?? 0
    }

    return {
      text: data.text.trim(),
      confidence: Math.round(data.confidence ?? 0),
      lines,
      words,
      fontFace: match.face,
      boldLines,
      boldWords,
      italicLines: lines.filter((line) => line.italic).length,
      underlinedLines: lines.filter((line) => line.underline).length,
    }
  }

  return {
    text: data.text.trim(),
    confidence: Math.round(data.confidence ?? 0),
    lines,
    words,
    fontFace: 'liberation',
    boldLines: 0,
    boldWords: 0,
    italicLines: 0,
    underlinedLines: 0,
  }
}

/**
 * Chooses a page-wide regular/bold boundary from the word scores. Otsu's
 * method finds the split that best separates the two clusters. The split is
 * only used when the clusters are clearly apart and the heavy cluster looks
 * like real bold text; otherwise the fixed cutoff keeps an all-regular page
 * from inventing bold words.
 */
function pageBoldCutoff(ratios: number[]): number {
  const values = ratios.filter((ratio) => ratio > 0).sort((a, b) => a - b)
  if (values.length < 8) return BOLD_CORE_RATIO

  const total = values.reduce((sum, value) => sum + value, 0)
  let sumLow = 0
  let bestVariance = -1
  let bestIndex = -1
  for (let i = 0; i < values.length - 1; i++) {
    sumLow += values[i]
    const countLow = i + 1
    const countHigh = values.length - countLow
    const meanLow = sumLow / countLow
    const meanHigh = (total - sumLow) / countHigh
    const variance = countLow * countHigh * (meanHigh - meanLow) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      bestIndex = i
    }
  }
  if (bestIndex < 0) return BOLD_CORE_RATIO

  const mean = (items: number[]) =>
    items.reduce((sum, value) => sum + value, 0) / items.length
  const lowValues = values.slice(0, bestIndex + 1)
  const highValues = values.slice(bestIndex + 1)
  const maxLow = lowValues[lowValues.length - 1]
  const minHigh = highValues[0]
  const cutoff = (maxLow + minHigh) / 2
  const separation = mean(highValues) - mean(lowValues)
  const heavyMean = mean(highValues)
  const heavyMax = highValues[highValues.length - 1]

  const clear =
    minHigh - maxLow >= 0.01 &&
    separation >= 0.08 &&
    heavyMean >= 0.38 &&
    heavyMax >= 0.42 &&
    mean(lowValues) <= 0.45 &&
    cutoff >= 0.28 &&
    cutoff <= 0.55
  return clear ? cutoff : BOLD_CORE_RATIO
}

export function friendlyOcrStatus(status: string): string {
  switch (status) {
    case 'loading tesseract core':
      return 'Loading OCR engine…'
    case 'initializing tesseract':
      return 'Starting OCR engine…'
    case 'loading language traineddata':
      return 'Downloading language model…'
    case 'initializing api':
      return 'Preparing language model…'
    case 'recognizing text':
      return 'Recognising text…'
    case 'matching typeface':
      return 'Matching the original typeface…'
    default:
      return 'Preparing OCR…'
  }
}

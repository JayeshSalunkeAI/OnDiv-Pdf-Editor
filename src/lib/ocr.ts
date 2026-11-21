import type { FontFaceId, OcrWord, TextLine } from '../types'
import { fontFaceKind, matchPageFont } from './fonts'
import type { FontMatchSample } from './fonts'
import { analyzeLineStyle, analyzeWordStyle } from './ocr-style'

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
  words: OcrWord[]
  fontFace: FontFaceId
  boldLines: number
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
  const words: OcrWord[] = []
  const samples: FontMatchSample[] = []

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
        const lineWords: OcrWord[] = []
        for (const word of line.words ?? []) {
          const wordText = word.text.trim()
          if (!wordText) continue
          const wordBox = toPoints(word.bbox)
          if (wordBox.width < 1 || wordBox.height < 1) continue
          lineWords.push({ text: wordText, ...wordBox })
        }
        if (!lineWords.length) {
          lineWords.push({ text, ...box })
        }
        words.push(...lineWords)

        const baselinePx = line.baseline?.y0
        const capHeightPx =
          baselinePx != null && baselinePx > line.bbox.y0
            ? baselinePx - line.bbox.y0
            : line.bbox.y1 - line.bbox.y0
        const fontSize = Math.min(72, Math.max(6, capHeightPx / scale / 0.72))
        const style = analyzeLineStyle(canvas, line.bbox, baselinePx, capHeightPx)

        // Bold is voted per word so a bold name inside a regular sentence does
        // not turn the whole replacement bold. Mixed lines stay regular and the
        // inspector still exposes a manual toggle.
        let boldVotes = 0
        let eligibleWords = 0
        for (const word of line.words ?? []) {
          if (word.text.trim().length < 2) continue
          eligibleWords++
          if (analyzeWordStyle(canvas, word.bbox, capHeightPx).bold) boldVotes++
        }
        const bold =
          eligibleWords > 0 ? boldVotes / eligibleWords > 0.5 : style.bold

        lines.push({
          id: `ocr-${pageNumber}-${lines.length}`,
          text,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fontSize,
          fontFamily: 'sans',
          bold,
          italic: style.italic,
          underline: style.underline,
          color: style.color,
          baseline: baselinePx != null ? baselinePx / scale - box.y : undefined,
          source: 'ocr',
          confidence: line.confidence,
        })
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
    }
    return {
      text: data.text.trim(),
      confidence: Math.round(data.confidence ?? 0),
      lines,
      words,
      fontFace: match.face,
      boldLines: lines.filter((line) => line.bold).length,
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
    italicLines: 0,
    underlinedLines: 0,
  }
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

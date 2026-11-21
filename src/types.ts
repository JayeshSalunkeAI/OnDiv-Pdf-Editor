export type Tool = 'select' | 'text' | 'add-text' | 'whiteout' | 'redact'

export type FontKind = 'sans' | 'serif' | 'mono'

/** Bundled metric-compatible families used for font matching and embedding. */
export type FontFaceId = 'liberation' | 'carlito' | 'tinos' | 'caladea' | 'cousine'

export type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic'

export interface Patch {
  id: string
  pageIndex: number
  kind: 'text' | 'redact'
  /** Page coordinates in PDF points, top-left origin, at 100% zoom. */
  x: number
  y: number
  w: number
  h: number
  text?: string
  fontSize?: number
  fontFamily?: FontKind
  /** Bundled face that matches the source document. Wins over fontFamily. */
  fontFace?: FontFaceId
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  /** Distance from the top of the crop box to the original text baseline. */
  baseline?: number
  /** Paint this colour behind replacement text to hide the original glyphs. */
  mask?: boolean
  bgColor?: string
  /** True for destructive redaction: the page is flattened on export. */
  secure?: boolean
  /** Native text line or OCR line this patch replaces. */
  lineId?: string
  source?: 'native' | 'ocr' | 'manual'
  createdAt: number
}

export interface TextLine {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontFamily: FontKind
  /** Closest bundled face to the source glyphs, when one could be matched. */
  fontFace?: FontFaceId
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  /** Distance from the top of the crop box to the text baseline, in points. */
  baseline?: number
  source: 'native' | 'ocr'
  confidence?: number
}

export interface OcrWord {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrPage {
  status: 'idle' | 'running' | 'done' | 'error'
  progress: number
  message: string
  confidence?: number
  text?: string
  lines: TextLine[]
  words: OcrWord[]
  /** Typeface that best matched the page's scan. */
  fontFace?: FontFaceId
  boldLines?: number
  italicLines?: number
  underlinedLines?: number
  /** Only scanned pages get an invisible searchable text layer on export. */
  applyTextLayer?: boolean
  error?: string
}

export type BusyKind = 'opening' | 'exporting' | 'ocr' | null

export interface PageSize {
  width: number
  height: number
}

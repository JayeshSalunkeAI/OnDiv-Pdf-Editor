import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  BusyKind,
  OcrPage,
  PageSize,
  Patch,
  TextLine,
  Tool,
} from './types'
import {
  closePdf,
  errorMessage,
  extractTextLines,
  openPdf,
  renderPageToCanvas,
} from './lib/pdf'
import { friendlyOcrStatus, recognizePage } from './lib/ocr'
import { exportPdf } from './lib/export'
import { fontFaceLabel } from './lib/fonts'

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

let lastHistoryKey = ''
let lastHistoryAt = 0
let documentToken = 0
let lastOcrUpdate = 0

interface EditorState {
  pdf: PDFDocumentProxy | null
  bytes: Uint8Array | null
  fileName: string
  fileSize: number
  numPages: number
  page: number
  zoom: number
  fitPending: boolean
  pageSize: PageSize
  tool: Tool
  patches: Patch[]
  past: Patch[][]
  future: Patch[][]
  selectedPatchId: string | null
  textLines: Record<number, TextLine[]>
  textLoading: Record<number, boolean>
  ocr: Record<number, OcrPage>
  ocrLanguage: string
  searchableExport: boolean
  busy: BusyKind
  notice: string
  error: string | null

  openFile: (file: File) => Promise<void>
  loadText: (page: number) => Promise<void>
  setPage: (page: number) => void
  setZoom: (zoom: number) => void
  fitToWidth: (availableWidth: number) => void
  markFitted: () => void
  setPageSize: (size: PageSize) => void
  setTool: (tool: Tool) => void
  addPatch: (
    patch: Omit<Patch, 'id' | 'createdAt'>,
    options?: { replaceLineId?: string },
  ) => Patch
  updatePatch: (id: string, updates: Partial<Patch>, key?: string) => void
  deletePatch: (id: string) => void
  selectPatch: (id: string | null) => void
  undo: () => void
  redo: () => void
  runOcr: (page: number) => Promise<void>
  setOcrLanguage: (language: string) => void
  setSearchableExport: (enabled: boolean) => void
  exportDocument: () => Promise<void>
  dismissError: () => void
  setNotice: (notice: string) => void
}

const emptyOcr = (): OcrPage => ({
  status: 'idle',
  progress: 0,
  message: '',
  lines: [],
  words: [],
})

function downloadPdf(data: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(data)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export const useEditor = create<EditorState>()((set, get) => {
  const commitPatches = (next: Patch[], key?: string) => {
    const state = get()
    const now = Date.now()
    const merge = Boolean(key && key === lastHistoryKey && now - lastHistoryAt < 1200)
    set({
      patches: next,
      past: merge ? state.past : [...state.past.slice(-49), state.patches],
      future: [],
    })
    lastHistoryKey = key ?? ''
    lastHistoryAt = now
  }

  return {
    pdf: null,
    bytes: null,
    fileName: '',
    fileSize: 0,
    numPages: 0,
    page: 1,
    zoom: 1.1,
    fitPending: true,
    pageSize: { width: 595, height: 842 },
    tool: 'select',
    patches: [],
    past: [],
    future: [],
    selectedPatchId: null,
    textLines: {},
    textLoading: {},
    ocr: {},
    ocrLanguage: 'eng',
    searchableExport: true,
    busy: null,
    notice: 'Private by default. Nothing is uploaded.',
    error: null,

    openFile: async (file) => {
      const token = ++documentToken
      set({ busy: 'opening', error: null, notice: `Opening ${file.name}…` })
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const pdf = await openPdf(bytes)
        if (token !== documentToken) {
          await closePdf(pdf).catch(() => undefined)
          return
        }
        const previous = get().pdf
        set({
          pdf,
          bytes,
          fileName: file.name,
          fileSize: file.size,
          numPages: pdf.numPages,
          page: 1,
          zoom: 1.1,
          fitPending: true,
          tool: 'select',
          patches: [],
          past: [],
          future: [],
          selectedPatchId: null,
          textLines: {},
          textLoading: {},
          ocr: {},
          busy: null,
          notice: `${file.name} · ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`,
        })
        lastHistoryKey = ''
        lastHistoryAt = 0
        if (previous) await closePdf(previous).catch(() => undefined)
        await get().loadText(1)
      } catch (error) {
        if (token !== documentToken) return
        set({
          busy: null,
          error: errorMessage(error),
          notice: 'Could not open that file.',
        })
      }
    },

    loadText: async (page) => {
      const state = get()
      if (!state.pdf || state.textLines[page] || state.textLoading[page]) return
      const token = documentToken
      set((current) => ({
        textLoading: { ...current.textLoading, [page]: true },
      }))
      try {
        const proxy = await state.pdf.getPage(page)
        const lines = await extractTextLines(proxy)
        if (token !== documentToken) return
        set((current) => ({
          textLines: { ...current.textLines, [page]: lines },
        }))
      } catch (error) {
        if (token === documentToken) {
          set({ notice: `Text layer unavailable: ${errorMessage(error)}` })
        }
      } finally {
        set((current) => ({
          textLoading: { ...current.textLoading, [page]: false },
        }))
      }
    },

    setPage: (page) => {
      const { numPages } = get()
      if (!numPages) return
      const next = Math.min(numPages, Math.max(1, Math.round(page)))
      set({ page: next, selectedPatchId: null })
      void get().loadText(next)
    },

    setZoom: (zoom) => {
      set({ zoom: Math.min(3, Math.max(0.3, Math.round(zoom * 100) / 100)), fitPending: false })
    },

    fitToWidth: (availableWidth) => {
      const { pageSize } = get()
      if (!availableWidth || !pageSize.width) return
      const zoom = (availableWidth - 96) / pageSize.width
      set({ zoom: Math.min(2, Math.max(0.3, Math.round(zoom * 100) / 100)), fitPending: false })
    },

    markFitted: () => set({ fitPending: false }),

    setPageSize: (size) => {
      const current = get().pageSize
      if (Math.abs(current.width - size.width) < 0.1 && Math.abs(current.height - size.height) < 0.1) {
        return
      }
      set({ pageSize: size })
    },

    setTool: (tool) => set({ tool }),

    addPatch: (patch, options) => {
      const full: Patch = {
        ...patch,
        id: makeId(),
        createdAt: Date.now(),
      }
      const base = options?.replaceLineId
        ? get().patches.filter(
            (item) => !(item.lineId === options.replaceLineId && item.wordId),
          )
        : get().patches
      commitPatches([...base, full], `add:${full.id}`)
      set({ selectedPatchId: full.id })
      return full
    },

    updatePatch: (id, updates, key) => {
      const next = get().patches.map((patch) =>
        patch.id === id ? { ...patch, ...updates } : patch,
      )
      commitPatches(next, key ?? `update:${id}`)
    },

    deletePatch: (id) => {
      commitPatches(
        get().patches.filter((patch) => patch.id !== id),
        `delete:${id}`,
      )
      if (get().selectedPatchId === id) set({ selectedPatchId: null })
    },

    selectPatch: (id) => set({ selectedPatchId: id }),

    undo: () => {
      const { past, patches, future } = get()
      if (!past.length) return
      const previous = past[past.length - 1]
      lastHistoryKey = ''
      set({
        patches: previous,
        past: past.slice(0, -1),
        future: [patches, ...future].slice(0, 50),
        selectedPatchId: null,
      })
    },

    redo: () => {
      const { future, patches, past } = get()
      if (!future.length) return
      const next = future[0]
      lastHistoryKey = ''
      set({
        patches: next,
        future: future.slice(1),
        past: [...past, patches].slice(-50),
        selectedPatchId: null,
      })
    },

    runOcr: async (page) => {
      const { pdf, busy, ocrLanguage } = get()
      if (!pdf || busy) return
      const token = documentToken
      set((current) => ({
        busy: 'ocr',
        error: null,
        notice: `Preparing OCR for page ${page}…`,
        ocr: {
          ...current.ocr,
          [page]: {
            ...emptyOcr(),
            status: 'running',
            message: 'Preparing OCR engine…',
          },
        },
      }))

      try {
        const proxy = await pdf.getPage(page)
        const nativeLines = get().textLines[page] ?? (await extractTextLines(proxy))
        if (token !== documentToken) return
        if (!get().textLines[page]) {
          set((current) => ({
            textLines: { ...current.textLines, [page]: nativeLines },
          }))
        }
        set((current) => ({
          ocr: {
            ...current.ocr,
            [page]: {
              ...(current.ocr[page] ?? emptyOcr()),
              status: 'running',
              progress: 0,
              message: 'Rendering page for OCR…',
            },
          },
        }))
        const { canvas, scale } = await renderPageToCanvas(proxy, 2)
        const parsed = await recognizePage(
          canvas,
          page,
          ocrLanguage,
          (message) => {
            const now = Date.now()
            if (now - lastOcrUpdate < 120 && message.progress < 1) return
            lastOcrUpdate = now
            if (token !== documentToken) return
            set((current) => ({
              ocr: {
                ...current.ocr,
                [page]: {
                  ...(current.ocr[page] ?? emptyOcr()),
                  status: 'running',
                  progress: message.progress,
                  message: friendlyOcrStatus(message.status),
                },
              },
            }))
          },
          scale,
        )
        canvas.width = 0
        canvas.height = 0
        if (token !== documentToken) return

        const applyTextLayer = nativeLines.length === 0
        set((current) => ({
          busy: null,
          tool: applyTextLayer ? 'text' : current.tool,
          notice: `OCR complete · ${parsed.lines.length} lines · ${parsed.confidence}% confidence · matched ${fontFaceLabel(parsed.fontFace)}`,
          textLines: applyTextLayer
            ? { ...current.textLines, [page]: parsed.lines }
            : current.textLines,
          ocr: {
            ...current.ocr,
            [page]: {
              status: 'done',
              progress: 1,
              message: 'OCR complete',
              confidence: parsed.confidence,
              text: parsed.text,
              lines: parsed.lines,
              words: parsed.words,
              fontFace: parsed.fontFace,
              boldLines: parsed.boldLines,
              boldWords: parsed.boldWords,
              italicLines: parsed.italicLines,
              underlinedLines: parsed.underlinedLines,
              applyTextLayer,
            },
          },
        }))
      } catch (error) {
        if (token !== documentToken) return
        const message = errorMessage(error)
        set((current) => ({
          busy: null,
          error: `OCR failed: ${message}`,
          notice: 'OCR failed.',
          ocr: {
            ...current.ocr,
            [page]: {
              ...(current.ocr[page] ?? emptyOcr()),
              status: 'error',
              message: 'OCR failed',
              error: message,
            },
          },
        }))
      }
    },

    setOcrLanguage: (language) => set({ ocrLanguage: language }),

    setSearchableExport: (enabled) => set({ searchableExport: enabled }),

    exportDocument: async () => {
      const { bytes, patches, ocr, searchableExport, fileName, busy } = get()
      if (!bytes || busy) return
      const secureCount = patches.filter((patch) => patch.secure).length
      set({
        busy: 'exporting',
        error: null,
        notice: secureCount
          ? `Flattening ${secureCount} secure redaction${secureCount === 1 ? '' : 's'} and rebuilding the PDF…`
          : 'Flattening edits into a new PDF…',
      })
      try {
        const out = await exportPdf(bytes, patches, ocr, { searchable: searchableExport })
        const base = fileName.replace(/\.pdf$/i, '') || 'document'
        downloadPdf(out, `${base}-edited.pdf`)
        set({
          busy: null,
          notice: `Exported ${(out.byteLength / 1024 / 1024).toFixed(2)} MB · ${patches.length} edit${patches.length === 1 ? '' : 's'}${secureCount ? ' · redactions verified' : ''}`,
        })
      } catch (error) {
        set({ busy: null, error: `Export failed: ${errorMessage(error)}`, notice: 'Export failed.' })
      }
    },

    dismissError: () => set({ error: null }),
    setNotice: (notice) => set({ notice }),
  }
})

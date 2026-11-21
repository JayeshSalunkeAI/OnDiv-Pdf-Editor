import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { useEditor } from '../store'
import { sampleColors } from '../lib/color'
import { errorMessage } from '../lib/pdf'
import { ensureFontStyles, previewFontFamily } from '../lib/fonts'
import type { FontFaceId, FontKind, Patch, TextLine } from '../types'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

type InlineState = {
  pageIndex: number
  kind: 'line' | 'patch'
  line?: TextLine
  patchId?: string
  isNew?: boolean
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFamily: FontKind
  fontFace?: FontFaceId
  color: string
  bgColor: string
  mask: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** Distance from the inline box top to the original baseline. */
  baseline?: number
}

type DragState = {
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

type Point = { x: number; y: number }

export function PageView() {
  const pdf = useEditor((s) => s.pdf)
  const page = useEditor((s) => s.page)
  const zoom = useEditor((s) => s.zoom)
  const fitPending = useEditor((s) => s.fitPending)
  const pageSize = useEditor((s) => s.pageSize)
  const tool = useEditor((s) => s.tool)
  const patches = useEditor((s) => s.patches)
  const selectedPatchId = useEditor((s) => s.selectedPatchId)
  const textLines = useEditor((s) => s.textLines)
  const textLoading = useEditor((s) => s.textLoading)
  const setPageSize = useEditor((s) => s.setPageSize)
  const setZoom = useEditor((s) => s.setZoom)
  const markFitted = useEditor((s) => s.markFitted)
  const setTool = useEditor((s) => s.setTool)
  const addPatch = useEditor((s) => s.addPatch)
  const updatePatch = useEditor((s) => s.updatePatch)
  const deletePatch = useEditor((s) => s.deletePatch)
  const selectPatch = useEditor((s) => s.selectPatch)

  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const whiteoutStartRef = useRef<Point | null>(null)
  const doneRef = useRef(false)
  const cancelRef = useRef(false)

  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [inline, setInline] = useState<InlineState | null>(null)
  const [whiteoutDraft, setWhiteoutDraft] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)

  const pageIndex = page - 1
  const lines = textLines[page] ?? []
  const isLoadingText = Boolean(textLoading[page])
  const pagePatches = patches.filter((patch) => patch.pageIndex === pageIndex)
  const masks = pagePatches.filter(
    (patch) =>
      (patch.kind === 'redact' && !patch.secure) || (patch.kind === 'text' && patch.mask),
  )
  const secureMasks = pagePatches.filter(
    (patch) => patch.kind === 'redact' && patch.secure,
  )
  const textPatches = pagePatches.filter((patch) => patch.kind === 'text')
  const patchedLineIds = new Set(
    pagePatches.map((patch) => patch.lineId).filter((value): value is string => Boolean(value)),
  )

  // Fit the first page into the viewport once per opened document.
  useEffect(() => {
    if (!pdf || !fitPending) return
    let cancelled = false
    void pdf.getPage(page).then((proxy) => {
      if (cancelled) return
      const viewport = proxy.getViewport({ scale: 1 })
      const width = scrollRef.current?.clientWidth ?? 0
      if (!width) return
      const target = clamp((width - 120) / viewport.width, 0.35, 2)
      if (!useEditor.getState().fitPending) return
      markFitted()
      setZoom(target)
    })
    return () => {
      cancelled = true
    }
  }, [pdf, page, fitPending, markFitted, setZoom])

  // Render the page bitmap and the selectable PDF.js text layer.
  useEffect(() => {
    if (!pdf) return
    const canvas = canvasRef.current
    const layer = textLayerRef.current
    if (!canvas || !layer) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    let layerInstance: TextLayer | null = null
    layer.replaceChildren()
    setRendering(true)
    setRenderError(null)

    void (async () => {
      const proxy: PDFPageProxy = await pdf.getPage(page)
      if (cancelled) return
      const base = proxy.getViewport({ scale: 1 })
      setPageSize({ width: base.width, height: base.height })
      const viewport = proxy.getViewport({ scale: zoom })
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)

      renderTask = proxy.render({
        canvas,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
        background: '#ffffff',
      })
      await renderTask.promise
      if (cancelled) return
      setRendering(false)

      const textContent = await proxy.getTextContent()
      if (cancelled) return
      layerInstance = new TextLayer({
        textContentSource: textContent,
        container: layer,
        viewport,
      })
      await layerInstance.render()
    })().catch((error: unknown) => {
      if (cancelled) return
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
      setRendering(false)
      setRenderError(errorMessage(error))
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
      layerInstance?.cancel()
      layer.replaceChildren()
    }
  }, [pdf, page, zoom, setPageSize])

  useEffect(() => {
    ensureFontStyles()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  useEffect(() => {
    // Close a stale inline editor when the page changes.
    if (!inline) return
    doneRef.current = true
    setInline(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const pixelsPerPoint = canvasRef.current
    ? canvasRef.current.width / Math.max(1, pageSize.width * zoom)
    : 1

  const pointFromEvent = (event: React.PointerEvent): Point => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clamp((event.clientX - rect.left) / zoom, 0, pageSize.width),
      y: clamp((event.clientY - rect.top) / zoom, 0, pageSize.height),
    }
  }

  const resetEditorFlags = () => {
    doneRef.current = false
    cancelRef.current = false
  }

  const openLineEditor = (line: TextLine) => {
    const canvas = canvasRef.current
    const colors =
      canvas && pixelsPerPoint > 0
        ? sampleColors(
            canvas,
            { x: line.x, y: line.y, w: line.width, h: line.height },
            pixelsPerPoint,
          )
        : { bg: '#ffffff', fg: '#111827' }
    resetEditorFlags()
    setInline({
      pageIndex,
      kind: 'line',
      line,
      text: line.text,
      x: Math.max(0, line.x - 1),
      y: Math.max(0, line.y - 1),
      w: line.width + 2,
      h: line.height + 2,
      fontSize: line.fontSize,
      fontFamily: line.fontFamily,
      fontFace: line.fontFace,
      color: colors.fg,
      bgColor: colors.bg,
      mask: true,
      bold: line.bold,
      italic: line.italic,
      underline: line.underline,
      baseline: line.baseline,
    })
  }

  const openPatchEditor = (patch: Patch, isNew = false) => {
    if (patch.kind !== 'text') return
    resetEditorFlags()
    setInline({
      pageIndex,
      kind: 'patch',
      patchId: patch.id,
      isNew,
      text: patch.text ?? '',
      x: patch.x,
      y: patch.y,
      w: patch.w,
      h: patch.h,
      fontSize: patch.fontSize ?? 12,
      fontFamily: patch.fontFamily ?? 'sans',
      fontFace: patch.fontFace,
      color: patch.color ?? '#111827',
      bgColor: patch.bgColor ?? '#ffffff',
      mask: patch.mask ?? false,
      bold: patch.bold,
      italic: patch.italic,
      underline: patch.underline,
      baseline: patch.baseline,
    })
  }

  const commitInline = () => {
    if (!inline || doneRef.current) return
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    doneRef.current = true
    const value = inline.text.trim()

    if (inline.kind === 'patch' && inline.patchId) {
      if (!value) {
        deletePatch(inline.patchId)
      } else {
        updatePatch(
          inline.patchId,
          {
            text: inline.text,
            fontSize: inline.fontSize,
            fontFamily: inline.fontFamily,
            fontFace: inline.fontFace,
            color: inline.color,
            bgColor: inline.bgColor,
            mask: inline.mask,
            bold: inline.bold,
            italic: inline.italic,
            underline: inline.underline,
            baseline: inline.baseline,
          },
          `inline:${inline.patchId}`,
        )
      }
      setInline(null)
      return
    }

    const line = inline.line
    if (!line) {
      setInline(null)
      return
    }
    if (inline.text === line.text) {
      setInline(null)
      return
    }
    if (!value) {
      addPatch({
        pageIndex: inline.pageIndex,
        kind: 'redact',
        x: inline.x,
        y: inline.y,
        w: inline.w,
        h: inline.h,
        bgColor: inline.bgColor,
        mask: true,
        lineId: line.id,
        source: line.source,
      })
    } else {
      addPatch({
        pageIndex: inline.pageIndex,
        kind: 'text',
        x: inline.x,
        y: inline.y,
        w: inline.w,
        h: inline.h,
        text: inline.text,
        fontSize: inline.fontSize,
        fontFamily: inline.fontFamily,
        fontFace: inline.fontFace,
        color: inline.color,
        bgColor: inline.bgColor,
        mask: true,
        bold: inline.bold,
        italic: inline.italic,
        underline: inline.underline,
        baseline:
          inline.baseline == null
            ? undefined
            : inline.baseline + (line.y - inline.y),
        lineId: line.id,
        source: line.source,
      })
    }
    setTool('select')
    setInline(null)
  }

  const cancelInline = () => {
    if (!inline) return
    doneRef.current = true
    cancelRef.current = true
    if (inline.isNew && inline.patchId) deletePatch(inline.patchId)
    setInline(null)
  }

  const startWhiteout = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const point = pointFromEvent(event)
    whiteoutStartRef.current = point
    setWhiteoutDraft({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer events (tests) have no active pointer to capture.
    }
  }

  const finishWhiteout = (event: React.PointerEvent) => {
    const start = whiteoutStartRef.current
    if (!start) return
    const end = pointFromEvent(event)
    whiteoutStartRef.current = null
    setWhiteoutDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const w = Math.abs(end.x - start.x)
    const h = Math.abs(end.y - start.y)
    if (w < 3 || h < 3) return
    if (tool === 'redact') {
      addPatch({
        pageIndex,
        kind: 'redact',
        x,
        y,
        w,
        h,
        bgColor: '#000000',
        mask: true,
        secure: true,
        source: 'manual',
      })
    } else {
      const canvas = canvasRef.current
      const colors =
        canvas && pixelsPerPoint > 0
          ? sampleColors(canvas, { x, y, w, h }, pixelsPerPoint)
          : { bg: '#ffffff', fg: '#111827' }
      addPatch({
        pageIndex,
        kind: 'redact',
        x,
        y,
        w,
        h,
        bgColor: colors.bg,
        mask: true,
        secure: false,
        source: 'manual',
      })
    }
    setTool('select')
  }

  const onOverlayPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    if (tool === 'add-text') {
      event.preventDefault()
      const point = pointFromEvent(event)
      const patch = addPatch({
        pageIndex,
        kind: 'text',
        x: Math.max(0, point.x - 2),
        y: Math.max(0, point.y - 8),
        w: 160,
        h: 20,
        text: '',
        fontSize: 14,
        fontFamily: 'sans',
        fontFace: 'liberation',
        color: '#111827',
        mask: false,
        source: 'manual',
      })
      setTool('select')
      openPatchEditor(patch, true)
      return
    }
    if (tool === 'whiteout' || tool === 'redact') {
      startWhiteout(event)
    }
  }

  const onOverlayPointerMove = (event: React.PointerEvent) => {
    if (!whiteoutStartRef.current) return
    const point = pointFromEvent(event)
    setWhiteoutDraft((draft) =>
      draft ? { ...draft, x1: point.x, y1: point.y } : draft,
    )
  }

  const onOverlayPointerUp = (event: React.PointerEvent) => {
    if (whiteoutStartRef.current) finishWhiteout(event)
  }

  const onPatchPointerDown = (event: React.PointerEvent, patch: Patch) => {
    if (tool !== 'select' || event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    selectPatch(patch.id)
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: patch.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: patch.x,
      originY: patch.y,
      moved: false,
    }
  }

  const onPatchPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    drag.moved = true
    const patch = useEditor.getState().patches.find((item) => item.id === drag.id)
    if (!patch) return
    updatePatch(
      drag.id,
      {
        x: clamp(drag.originX + dx / zoom, 0, Math.max(0, pageSize.width - 6)),
        y: clamp(drag.originY + dy / zoom, 0, Math.max(0, pageSize.height - 6)),
      },
      `move:${drag.id}`,
    )
  }

  const onPatchPointerUp = (event: React.PointerEvent) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const draftRect = whiteoutDraft
    ? {
        x: Math.min(whiteoutDraft.x0, whiteoutDraft.x1),
        y: Math.min(whiteoutDraft.y0, whiteoutDraft.y1),
        w: Math.abs(whiteoutDraft.x1 - whiteoutDraft.x0),
        h: Math.abs(whiteoutDraft.y1 - whiteoutDraft.y0),
      }
    : null

  const frameStyle = {
    width: pageSize.width * zoom,
    height: pageSize.height * zoom,
    '--total-scale-factor': zoom,
    '--scale-round-x': '1px',
    '--scale-round-y': '1px',
  } as React.CSSProperties

  const editorWidth = inline
    ? Math.max(
        150,
        Math.min(
          Math.max(inline.w * zoom + 30, 210),
          pageSize.width * zoom - Math.max(0, (inline.x - 2) * zoom) - 6,
        ),
      )
    : 0

  return (
    <div className="canvas-scroll" ref={scrollRef}>
      <div className="page-shell">
        <div
          className={`pdf-frame mode-${tool}`}
          style={frameStyle}
          data-page={page}
        >
          <canvas ref={canvasRef} className="pdf-canvas" />
          <div className="textLayer" ref={textLayerRef} />
          <div
            ref={overlayRef}
            className={`page-overlay tool-${tool}`}
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerCancel={() => {
              whiteoutStartRef.current = null
              setWhiteoutDraft(null)
            }}
          >
            {tool === 'text' &&
              lines.map((line) => {
                if (patchedLineIds.has(line.id)) return null
                return (
                  <div
                    key={line.id}
                    className="text-line"
                    role="button"
                    tabIndex={0}
                    title="Click to edit this line"
                    aria-label={`Edit line: ${line.text.slice(0, 80)}`}
                    style={{
                      left: line.x * zoom - 2,
                      top: line.y * zoom - 2,
                      width: Math.max(10, line.width * zoom + 4),
                      height: Math.max(10, line.height * zoom + 4),
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      event.preventDefault()
                      openLineEditor(line)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openLineEditor(line)
                      }
                    }}
                  />
                )
              })}

            {masks.map((patch) => (
              <div
                key={`mask-${patch.id}`}
                className={`patch-mask ${patch.kind === 'redact' ? 'patch-redact' : ''} ${
                  patch.secure ? 'patch-secure' : ''
                } ${selectedPatchId === patch.id ? 'selected' : ''}`}
                style={{
                  left: patch.x * zoom,
                  top: patch.y * zoom,
                  width: Math.max(2, patch.w * zoom),
                  height: Math.max(2, patch.h * zoom),
                  background: patch.bgColor ?? '#ffffff',
                }}
                onPointerDown={(event) => onPatchPointerDown(event, patch)}
                onPointerMove={onPatchPointerMove}
                onPointerUp={onPatchPointerUp}
                onPointerCancel={onPatchPointerUp}
              />
            ))}

            {textPatches.map((patch) => (
              <div
                key={patch.id}
                className={`patch-text ${selectedPatchId === patch.id ? 'selected' : ''}`}
                style={{
                  left: patch.x * zoom,
                  top: patch.y * zoom,
                  width: Math.max(12, patch.w * zoom),
                  minHeight: Math.max(8, patch.h * zoom),
                  fontSize: Math.max(1, (patch.fontSize ?? 12) * zoom),
                  fontFamily: previewFontFamily(patch.fontFamily ?? 'sans', patch.fontFace),
                  fontWeight: patch.bold ? 700 : 400,
                  fontStyle: patch.italic ? 'italic' : 'normal',
                  textDecoration: patch.underline ? 'underline' : 'none',
                  color: patch.color ?? '#111827',
                }}
                title={patch.text}
                onPointerDown={(event) => onPatchPointerDown(event, patch)}
                onPointerMove={onPatchPointerMove}
                onPointerUp={onPatchPointerUp}
                onPointerCancel={onPatchPointerUp}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  openPatchEditor(patch)
                }}
              >
                {patch.text}
              </div>
            ))}

            {secureMasks.map((patch) => (
              <div
                key={`secure-${patch.id}`}
                className={`patch-mask patch-redact patch-secure ${
                  selectedPatchId === patch.id ? 'selected' : ''
                }`}
                style={{
                  left: patch.x * zoom,
                  top: patch.y * zoom,
                  width: Math.max(2, patch.w * zoom),
                  height: Math.max(2, patch.h * zoom),
                  background: '#000000',
                }}
                title="Secure redaction — flattened on export"
                onPointerDown={(event) => onPatchPointerDown(event, patch)}
                onPointerMove={onPatchPointerMove}
                onPointerUp={onPatchPointerUp}
                onPointerCancel={onPatchPointerUp}
              />
            ))}

            {draftRect && (
              <div
                className={`whiteout-draft ${tool === 'redact' ? 'secure-draft' : ''}`}
                style={{
                  left: draftRect.x * zoom,
                  top: draftRect.y * zoom,
                  width: draftRect.w * zoom,
                  height: draftRect.h * zoom,
                }}
              />
            )}

            {inline && (
              <InlineTextEditor
                inline={inline}
                zoom={zoom}
                width={editorWidth}
                onChange={(text) => setInline((current) => (current ? { ...current, text } : current))}
                onCommit={commitInline}
                onCancel={cancelInline}
              />
            )}

            {rendering && (
              <div className="page-loading">
                <Loader2 size={22} className="spin" />
                <span>Rendering page…</span>
              </div>
            )}

            {renderError && (
              <div className="page-error">
                <AlertTriangle size={22} />
                <strong>Could not render this page</strong>
                <span>{renderError}</span>
              </div>
            )}
          </div>

          {isLoadingText && (
            <div className="page-hint">
              <Loader2 size={12} className="spin" />
              Reading text layer…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InlineTextEditor({
  inline,
  zoom,
  width,
  onChange,
  onCommit,
  onCancel,
}: {
  inline: InlineState
  zoom: number
  width: number
  onChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [inline.text, inline.fontSize, zoom])

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <div
      className="inline-editor"
      style={{
        left: Math.max(0, (inline.x - 2) * zoom),
        top: Math.max(0, (inline.y - 2) * zoom),
        width,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={inline.text}
        rows={1}
        spellCheck={false}
        placeholder="Type text…"
        style={{
          fontSize: Math.max(10, inline.fontSize * zoom),
          fontFamily: previewFontFamily(inline.fontFamily, inline.fontFace),
          color: inline.color,
          fontWeight: inline.bold ? 700 : 400,
          fontStyle: inline.italic ? 'italic' : 'normal',
          minHeight: Math.max(26, inline.h * zoom + 6),
        }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onCommit()
          }
        }}
      />
      <div className="inline-editor-hint">Enter apply · Esc cancel</div>
    </div>
  )
}

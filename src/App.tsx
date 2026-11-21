import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Landing } from './components/Landing'
import { Inspector } from './components/Inspector'
import { PageView } from './components/PageView'
import { Toolbar } from './components/Toolbar'
import { useEditor } from './store'

export default function App() {
  const pdf = useEditor((s) => s.pdf)
  const page = useEditor((s) => s.page)
  const numPages = useEditor((s) => s.numPages)
  const zoom = useEditor((s) => s.zoom)
  const patches = useEditor((s) => s.patches)
  const selectedPatchId = useEditor((s) => s.selectedPatchId)
  const busy = useEditor((s) => s.busy)
  const notice = useEditor((s) => s.notice)
  const error = useEditor((s) => s.error)
  const openFile = useEditor((s) => s.openFile)
  const setPage = useEditor((s) => s.setPage)
  const setTool = useEditor((s) => s.setTool)
  const selectPatch = useEditor((s) => s.selectPatch)
  const deletePatch = useEditor((s) => s.deletePatch)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const runOcr = useEditor((s) => s.runOcr)
  const exportDocument = useEditor((s) => s.exportDocument)
  const fitToWidth = useEditor((s) => s.fitToWidth)
  const dismissError = useEditor((s) => s.dismissError)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  const openPicker = () => fileInputRef.current?.click()

  const openSample = async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sample.pdf`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const file = new File([blob], 'northwind-sample.pdf', { type: 'application/pdf' })
      await openFile(file)
    } catch (caught) {
      useEditor.setState({
        error: `Could not load the sample PDF: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      })
    }
  }

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!isPdf) {
      useEditor.setState({ error: 'Please choose a PDF file.' })
      return
    }
    void openFile(file)
  }

  const fitPage = () => {
    const width = viewerRef.current?.clientWidth ?? 0
    fitToWidth(width)
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (typing) return

      const meta = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (meta && key === 'o') {
        event.preventDefault()
        fileInputRef.current?.click()
        return
      }
      if (meta && key === 's') {
        event.preventDefault()
        if (pdf && !busy) void exportDocument()
        return
      }
      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (meta && key === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (meta || event.altKey) return

      if (event.key === 'Escape') {
        selectPatch(null)
        setTool('select')
        return
      }
      if (!pdf) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPatchId) {
        event.preventDefault()
        deletePatch(selectedPatchId)
        return
      }
      if (event.key === 'PageUp') {
        event.preventDefault()
        setPage(page - 1)
        return
      }
      if (event.key === 'PageDown') {
        event.preventDefault()
        setPage(page + 1)
        return
      }
      if (busy) return
      if (key === 'v') setTool('select')
      else if (key === 't') setTool('text')
      else if (key === 'a') setTool('add-text')
      else if (key === 'w') setTool('whiteout')
      else if (key === 'r') setTool('redact')
      else if (key === 'o') void runOcr(page)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    pdf,
    page,
    busy,
    selectedPatchId,
    setPage,
    setTool,
    selectPatch,
    deletePatch,
    undo,
    redo,
    runOcr,
    exportDocument,
  ])

  return (
    <div
      className={`app ${pdf ? 'has-doc' : 'no-doc'}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragOver(true)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragOver(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        handleFiles(event.dataTransfer.files)
      }}
    >
      <Toolbar onOpen={openPicker} onFit={fitPage} />

      <div className="body">
        {pdf ? (
          <>
            <main className="viewer" ref={viewerRef}>
              <PageView />
              <div className="page-nav">
                <button
                  type="button"
                  className="nav-button"
                  title="Previous page (PageUp)"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  key={page}
                  className="page-input"
                  defaultValue={page}
                  inputMode="numeric"
                  aria-label="Page number"
                  onChange={(event) => {
                    event.currentTarget.value = event.currentTarget.value.replace(/[^\d]/g, '')
                  }}
                  onBlur={(event) => {
                    const next = Number(event.currentTarget.value)
                    if (Number.isFinite(next) && next > 0) {
                      const clamped = Math.min(numPages, Math.max(1, Math.round(next)))
                      event.currentTarget.value = String(clamped)
                      setPage(clamped)
                    } else {
                      event.currentTarget.value = String(page)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <span className="page-total">/ {numPages}</span>
                <button
                  type="button"
                  className="nav-button"
                  title="Next page (PageDown)"
                  disabled={page >= numPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="viewer-badge">{patches.length ? `${patches.length} edits` : 'read mode'}</div>
            </main>
            <Inspector />
          </>
        ) : (
          <Landing onOpen={openPicker} onSample={() => void openSample()} />
        )}
      </div>

      <footer className="statusbar">
        <span className="status-local">
          <ShieldCheck size={13} /> Files never leave this device
        </span>
        <span className="status-message">
          {busy && <Loader2 size={12} className="spin" />}
          {error ? 'Something needs attention.' : notice}
        </span>
        <span className="status-right">
          {pdf ? `Page ${page} · ${Math.round(zoom * 100)}%` : 'OnDiv PDF Editor'}
        </span>
      </footer>

      {error && (
        <div className="toast error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Something went wrong</strong>
            <span>{error}</span>
          </div>
          <button type="button" className="toast-close" onClick={dismissError} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <FileText size={36} />
            <strong>Drop to open</strong>
            <span>The file stays in this browser tab.</span>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}

import {
  Download,
  FileText,
  Loader2,
  Maximize2,
  MousePointer2,
  Redo2,
  ScanText,
  ShieldX,
  Square,
  TextCursorInput,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEditor } from '../store'
import type { Tool } from '../types'

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  shortcut: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`tool-button ${active ? 'active' : ''}`}
      title={`${label} (${shortcut})`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function Toolbar({ onOpen, onFit }: { onOpen: () => void; onFit: () => void }) {
  const pdf = useEditor((s) => s.pdf)
  const fileName = useEditor((s) => s.fileName)
  const numPages = useEditor((s) => s.numPages)
  const page = useEditor((s) => s.page)
  const zoom = useEditor((s) => s.zoom)
  const tool = useEditor((s) => s.tool)
  const patches = useEditor((s) => s.patches)
  const past = useEditor((s) => s.past)
  const future = useEditor((s) => s.future)
  const busy = useEditor((s) => s.busy)
  const setTool = useEditor((s) => s.setTool)
  const setZoom = useEditor((s) => s.setZoom)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const runOcr = useEditor((s) => s.runOcr)
  const exportDocument = useEditor((s) => s.exportDocument)

  const disabled = !pdf
  const working = busy === 'opening' || busy === 'exporting'

  const tools: { id: Tool; label: string; shortcut: string; icon: ReactNode }[] = [
    { id: 'select', label: 'Select', shortcut: 'V', icon: <MousePointer2 size={19} /> },
    { id: 'text', label: 'Edit text', shortcut: 'T', icon: <TextCursorInput size={19} /> },
    { id: 'add-text', label: 'Add text', shortcut: 'A', icon: <Type size={19} /> },
    { id: 'whiteout', label: 'Cover', shortcut: 'W', icon: <Square size={19} /> },
    { id: 'redact', label: 'Redact', shortcut: 'R', icon: <ShieldX size={19} /> },
  ]

  return (
    <>
      <header className={`topbar ${pdf ? 'has-document' : 'is-empty'}`}>
        <div className="brand">
          <div className="brand-mark">
            <FileText size={19} strokeWidth={2.1} />
          </div>
          <div className="brand-copy">
            <strong>OnDiv</strong>
            <span>PDF Editor</span>
          </div>
        </div>

        <div className="doc-meta">
          {fileName ? (
            <>
              <span className="doc-name" title={fileName}>
                {fileName}
              </span>
              <span className="doc-pages">
                {page} / {numPages}
              </span>
              <span className="doc-badge">{patches.length} edit{patches.length === 1 ? '' : 's'}</span>
            </>
          ) : (
            <span className="doc-empty">No document open</span>
          )}
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            title="Undo (Ctrl+Z)"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
          <span className="topbar-divider" />
          <button type="button" className="button ghost" onClick={onOpen}>
            <Upload size={15} />
            <span>Open</span>
          </button>
          <button
            type="button"
            className="button primary"
            disabled={disabled || Boolean(busy)}
            onClick={() => void exportDocument()}
            title="Download a copy with your edits"
          >
            {busy === 'exporting' ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            <span>{busy === 'exporting' ? 'Exporting…' : 'Export PDF'}</span>
          </button>
        </div>
      </header>

      {pdf && (
        <aside className="tool-rail">
          <div className="tool-group">
            {tools.map((item) => (
              <ToolButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                shortcut={item.shortcut}
                active={tool === item.id}
                disabled={working || Boolean(busy)}
                onClick={() => setTool(item.id)}
              />
            ))}
            <ToolButton
              icon={busy === 'ocr' ? <Loader2 size={19} className="spin" /> : <ScanText size={19} />}
              label="OCR page"
              shortcut="O"
              active={busy === 'ocr'}
              disabled={Boolean(busy)}
              onClick={() => void runOcr(page)}
            />
          </div>

          <div className="tool-group bottom">
            <button
              type="button"
              className="rail-icon"
              title="Zoom in"
              disabled={!pdf}
              onClick={() => setZoom(zoom + 0.1)}
            >
              <ZoomIn size={17} />
            </button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="rail-icon"
              title="Zoom out"
              disabled={!pdf}
              onClick={() => setZoom(zoom - 0.1)}
            >
              <ZoomOut size={17} />
            </button>
            <button
              type="button"
              className="rail-icon"
              title="Fit page width"
              disabled={!pdf}
              onClick={onFit}
            >
              <Maximize2 size={17} />
            </button>
          </div>
        </aside>
      )}
    </>
  )
}

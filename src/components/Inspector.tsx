import {
  AlertTriangle,
  Check,
  FileText,
  Languages,
  Layers,
  Loader2,
  MousePointer2,
  ScanText,
  ShieldX,
  Trash2,
} from 'lucide-react'
import { useEditor } from '../store'
import { FONT_FACES, fontFaceKind, fontFaceLabel } from '../lib/fonts'
import type { FontFaceId, FontKind } from '../types'

const languages = [
  ['eng', 'English'],
  ['deu', 'German'],
  ['fra', 'French'],
  ['spa', 'Spanish'],
  ['ita', 'Italian'],
  ['por', 'Portuguese'],
  ['nld', 'Dutch'],
  ['pol', 'Polish'],
  ['rus', 'Russian'],
  ['ukr', 'Ukrainian'],
  ['ara', 'Arabic'],
  ['hin', 'Hindi'],
  ['chi_sim', 'Chinese (simplified)'],
  ['chi_tra', 'Chinese (traditional)'],
  ['jpn', 'Japanese'],
  ['kor', 'Korean'],
] as const

const formatBytes = (bytes: number) => {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function Inspector() {
  const fileName = useEditor((s) => s.fileName)
  const fileSize = useEditor((s) => s.fileSize)
  const numPages = useEditor((s) => s.numPages)
  const page = useEditor((s) => s.page)
  const pageSize = useEditor((s) => s.pageSize)
  const patches = useEditor((s) => s.patches)
  const selectedPatchId = useEditor((s) => s.selectedPatchId)
  const textLines = useEditor((s) => s.textLines)
  const textLoading = useEditor((s) => s.textLoading)
  const ocr = useEditor((s) => s.ocr)
  const ocrLanguage = useEditor((s) => s.ocrLanguage)
  const searchableExport = useEditor((s) => s.searchableExport)
  const busy = useEditor((s) => s.busy)
  const setTool = useEditor((s) => s.setTool)
  const updatePatch = useEditor((s) => s.updatePatch)
  const deletePatch = useEditor((s) => s.deletePatch)
  const selectPatch = useEditor((s) => s.selectPatch)
  const runOcr = useEditor((s) => s.runOcr)
  const setOcrLanguage = useEditor((s) => s.setOcrLanguage)
  const setSearchableExport = useEditor((s) => s.setSearchableExport)

  const pageIndex = page - 1
  const pagePatches = patches.filter((patch) => patch.pageIndex === pageIndex)
  const lines = textLines[page] ?? []
  const loadingText = Boolean(textLoading[page])
  const selected = patches.find((patch) => patch.id === selectedPatchId) ?? null
  const ocrPage = ocr[page]
  const scanned = !loadingText && lines.length === 0
  const securePage = pagePatches.some(
    (patch) => patch.kind === 'redact' && patch.secure,
  )

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        <section className="panel-card">
          <div className="panel-heading">
            <span className="panel-title">
              <FileText size={14} /> Document
            </span>
          </div>
          <div className="doc-file" title={fileName}>
            {fileName}
          </div>
          <div className="kv-grid">
            <span>Pages</span>
            <strong>{numPages}</strong>
            <span>File size</span>
            <strong>{formatBytes(fileSize)}</strong>
            <span>Page size</span>
            <strong>
              {pageSize.width.toFixed(0)} × {pageSize.height.toFixed(0)} pt
            </strong>
            <span>Text layer</span>
            <strong>
              {loadingText
                ? 'reading…'
                : scanned
                  ? 'none (scanned)'
                  : `${lines.length} lines`}
            </strong>
          </div>
          {scanned && (
            <div className="inline-note warn">
              <AlertTriangle size={14} />
              This page has no text layer. Run OCR to make it editable.
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <span className="panel-title">
              <MousePointer2 size={14} /> Selection
            </span>
            {selected && (
              <span className={`tag ${selected.secure ? 'danger' : ''}`}>
                {selected.kind === 'text' ? 'text' : selected.secure ? 'redact' : 'cover'}
              </span>
            )}
          </div>

          {!selected ? (
            <div className="empty-panel">
              <p>Nothing selected.</p>
              <span>
                Pick a tool on the left, click a line to replace it, or drag over anything that
                should be covered.
              </span>
            </div>
          ) : selected.kind === 'text' ? (
            <div className="patch-form">
              <label className="field">
                <span>Replacement text</span>
                <textarea
                  rows={3}
                  value={selected.text ?? ''}
                  onChange={(event) =>
                    updatePatch(
                      selected.id,
                      { text: event.target.value },
                      `inspector-text:${selected.id}`,
                    )
                  }
                />
              </label>
              <div className="field-row">
                <label className="field small">
                  <span>Size</span>
                  <input
                    type="number"
                    min={4}
                    max={200}
                    step={0.5}
                    value={selected.fontSize ?? 12}
                    onChange={(event) =>
                      updatePatch(
                        selected.id,
                        { fontSize: clamp(Number(event.target.value) || 12, 4, 200) },
                        `size:${selected.id}`,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Typeface</span>
                  <select
                    value={
                      selected.fontFace
                        ? `face:${selected.fontFace}`
                        : `generic:${selected.fontFamily ?? 'sans'}`
                    }
                    onChange={(event) => {
                      const value = event.target.value
                      if (value.startsWith('face:')) {
                        const face = value.slice(5) as FontFaceId
                        updatePatch(selected.id, {
                          fontFace: face,
                          fontFamily: fontFaceKind(face),
                        })
                      } else {
                        updatePatch(selected.id, {
                          fontFace: undefined,
                          fontFamily: value.slice(8) as FontKind,
                        })
                      }
                    }}
                  >
                    <optgroup label="Generic PDF fonts">
                      <option value="generic:sans">Sans (Helvetica)</option>
                      <option value="generic:serif">Serif (Times)</option>
                      <option value="generic:mono">Mono (Courier)</option>
                    </optgroup>
                    <optgroup label="Matched / bundled fonts">
                      {FONT_FACES.map((face) => (
                        <option key={face.id} value={`face:${face.id}`}>
                          {face.label} — {face.license.split(' · ')[1]}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              </div>
              <div className="field-row compact">
                <label className="color-field">
                  <span>Ink</span>
                  <input
                    type="color"
                    value={selected.color ?? '#111827'}
                    onChange={(event) =>
                      updatePatch(selected.id, { color: event.target.value }, `ink:${selected.id}`)
                    }
                  />
                </label>
                <button
                  type="button"
                  className={`toggle ${selected.bold ? 'on' : ''}`}
                  title="Bold"
                  onClick={() => updatePatch(selected.id, { bold: !selected.bold })}
                >
                  B
                </button>
                <button
                  type="button"
                  className={`toggle italic ${selected.italic ? 'on' : ''}`}
                  title="Italic"
                  onClick={() => updatePatch(selected.id, { italic: !selected.italic })}
                >
                  I
                </button>
                <button
                  type="button"
                  className={`toggle underline ${selected.underline ? 'on' : ''}`}
                  title="Underline"
                  onClick={() => updatePatch(selected.id, { underline: !selected.underline })}
                >
                  U
                </button>
                {selected.mask && (
                  <label className="color-field">
                    <span>Paper</span>
                    <input
                      type="color"
                      value={selected.bgColor ?? '#ffffff'}
                      onChange={(event) =>
                        updatePatch(
                          selected.id,
                          { bgColor: event.target.value },
                          `paper:${selected.id}`,
                        )
                      }
                    />
                  </label>
                )}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.mask ?? false}
                  onChange={(event) =>
                    updatePatch(selected.id, { mask: event.target.checked })
                  }
                />
                Cover the original glyphs
              </label>
              <button
                type="button"
                className="button danger full"
                onClick={() => deletePatch(selected.id)}
              >
                <Trash2 size={14} /> Delete edit
              </button>
              <div className="patch-meta">
                {selected.source === 'ocr'
                  ? 'OCR replacement'
                  : selected.source === 'native'
                    ? 'Original text replacement'
                    : 'Added text'}{' '}
                · page {selected.pageIndex + 1}
                {selected.fontFace ? ` · ${fontFaceLabel(selected.fontFace)}` : ''}
              </div>
            </div>
          ) : selected.secure ? (
            <div className="patch-form">
              <div className="inline-note danger">
                <ShieldX size={14} />
                <span>
                  On export this whole page is flattened and rebuilt as an image. Text and
                  images underneath this box are destroyed, not covered. Native text on the
                  page is lost; searchable OCR outside the box is kept when enabled.
                </span>
              </div>
              <div className="kv-grid">
                <span>Area</span>
                <strong>
                  {selected.w.toFixed(0)} × {selected.h.toFixed(0)} pt
                </strong>
                <span>Page</span>
                <strong>{selected.pageIndex + 1}</strong>
                <span>Colour</span>
                <strong>Solid black</strong>
              </div>
              <div className="patch-meta">
                The export reopens the finished PDF and fails if any extractable text still
                intersects this box.
              </div>
              <button
                type="button"
                className="button danger full"
                onClick={() => deletePatch(selected.id)}
              >
                <Trash2 size={14} /> Delete redaction
              </button>
            </div>
          ) : (
            <div className="patch-form">
              <p className="muted-copy">
                A background-coloured cover. The underlying page content is still inside the
                PDF — this is a visual cover, not a secure redaction. Use Redact when content
                must be removed.
              </p>
              <label className="color-field">
                <span>Cover colour</span>
                <input
                  type="color"
                  value={selected.bgColor ?? '#ffffff'}
                  onChange={(event) =>
                    updatePatch(selected.id, { bgColor: event.target.value }, `cover:${selected.id}`)
                  }
                />
              </label>
              <div className="patch-meta">
                {selected.w.toFixed(0)} × {selected.h.toFixed(0)} pt · page{' '}
                {selected.pageIndex + 1}
              </div>
              <button
                type="button"
                className="button danger full"
                onClick={() => deletePatch(selected.id)}
              >
                <Trash2 size={14} /> Delete cover
              </button>
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <span className="panel-title">
              <Layers size={14} /> Page text
            </span>
            {lines.length > 0 && <span className="tag">{lines.length}</span>}
          </div>
          {loadingText ? (
            <div className="loading-row">
              <Loader2 size={14} className="spin" /> Reading text layer…
            </div>
          ) : lines.length ? (
            <>
              <div className="text-preview">
                {lines.slice(0, 7).map((line) => (
                  <div key={line.id} title={line.text}>
                    {line.text}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="button subtle full"
                onClick={() => setTool('text')}
              >
                <TextGlyph /> Edit text on page
              </button>
            </>
          ) : (
            <div className="empty-panel">
              <p>No native text on this page.</p>
              <span>It is probably a scan. OCR can build an editable text layer.</span>
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <span className="panel-title">
              <ScanText size={14} /> OCR
            </span>
            {ocrPage?.status === 'done' && (
              <span className="tag good">
                <Check size={11} /> {ocrPage.confidence}%
              </span>
            )}
          </div>
          <label className="field">
            <span>
              <Languages size={12} /> Language
            </span>
            <select
              value={ocrLanguage}
              onChange={(event) => setOcrLanguage(event.target.value)}
              disabled={busy === 'ocr'}
            >
              {languages.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button subtle full"
            disabled={Boolean(busy)}
            onClick={() => void runOcr(page)}
          >
            {ocrPage?.status === 'running' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <ScanText size={14} />
            )}
            {ocrPage?.status === 'running' ? 'Running OCR…' : `OCR page ${page}`}
          </button>
          {ocrPage?.status === 'running' && (
            <>
              <div className="progress">
                <span style={{ width: `${Math.round(ocrPage.progress * 100)}%` }} />
              </div>
              <div className="progress-copy">{ocrPage.message}</div>
            </>
          )}
          {ocrPage?.status === 'error' && (
            <div className="inline-note error">
              <AlertTriangle size={14} /> {ocrPage.error ?? 'OCR failed'}
            </div>
          )}
          {ocrPage?.status === 'done' && (
            <>
              <div className="ocr-summary">
                <strong>
                  {ocrPage.lines.length} lines
                  {ocrPage.fontFace ? ` · ${fontFaceLabel(ocrPage.fontFace)}` : ''}
                </strong>
                <span>
                  {[
                    ocrPage.boldLines ? `${ocrPage.boldLines} bold` : '',
                    ocrPage.italicLines ? `${ocrPage.italicLines} italic` : '',
                    ocrPage.underlinedLines ? `${ocrPage.underlinedLines} underlined` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'regular text'}
                </span>
                <span>
                  {ocrPage.applyTextLayer
                    ? 'will be embedded as an invisible, searchable layer'
                    : securePage
                      ? 'will be embedded on this page because Redact flattens it'
                      : 'preview only — this page already has native text'}
                </span>
              </div>
              <div className="patch-meta">
                Replacements use the matched face. If a line mixes weights or styles, select it
                and use B / I / U to correct that line.
              </div>
              {ocrPage.text && (
                <pre className="ocr-text">{ocrPage.text.slice(0, 900)}</pre>
              )}
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={searchableExport}
              onChange={(event) => setSearchableExport(event.target.checked)}
            />
            Add searchable OCR text on export
          </label>
          <div className="patch-meta">
            First OCR run downloads a language model (a few MB). The file itself never leaves
            this device.
          </div>
        </section>

        {pagePatches.length > 0 && (
          <section className="panel-card">
            <div className="panel-heading">
              <span className="panel-title">Edits on page {page}</span>
              <span className="tag">{pagePatches.length}</span>
            </div>
            <div className="edit-list">
              {pagePatches.map((patch) => {
                const secure = patch.kind === 'redact' && patch.secure
                return (
                  <button
                    key={patch.id}
                    type="button"
                    className={`edit-row ${patch.id === selectedPatchId ? 'active' : ''}`}
                    onClick={() => selectPatch(patch.id)}
                  >
                    <span
                      className={`edit-swatch ${
                        patch.kind === 'redact' ? (secure ? 'secure' : 'cover') : ''
                      }`}
                      style={{
                        background:
                          patch.kind === 'text'
                            ? (patch.color ?? '#111827')
                            : secure
                              ? '#000000'
                              : (patch.bgColor ?? '#fff'),
                      }}
                    />
                    <span className="edit-label">
                      {patch.kind === 'text'
                        ? patch.text?.trim() || 'Empty text'
                        : `${secure ? 'Redaction' : 'Cover'} ${patch.w.toFixed(0)} × ${patch.h.toFixed(0)} pt`}
                    </span>
                    <span className={`edit-kind ${secure ? 'secure' : ''}`}>
                      {patch.kind === 'text' ? 'TEXT' : secure ? 'REDACT' : 'COVER'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <section className="panel-card muted">
          <div className="panel-heading">
            <span className="panel-title">Session</span>
          </div>
          <p className="muted-copy">
            Edits live in memory. Export before closing the tab. The original PDF is never
            modified; Export writes a new file.
          </p>
        </section>
      </div>
    </aside>
  )
}

function TextGlyph() {
  return <span className="text-glyph">T</span>
}

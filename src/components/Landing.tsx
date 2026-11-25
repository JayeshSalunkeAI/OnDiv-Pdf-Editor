import {
  ArrowUpRight,
  FileDown,
  FileText,
  Loader2,
  ScanText,
  ShieldCheck,
  ShieldX,
  Upload,
} from 'lucide-react'
import { useEditor } from '../store'

const features = [
  {
    icon: ShieldCheck,
    title: 'Stays on device',
    copy: 'Your file never leaves this tab. No upload, no account, no queue.',
  },
  {
    icon: ScanText,
    title: 'Scanned pages',
    copy: 'OCR turns page images into editable words and lines, with bold detection you can correct.',
  },
  {
    icon: ShieldX,
    title: 'Permanent redaction',
    copy: 'Flatten and rebuild the page so sensitive content is truly gone.',
  },
  {
    icon: FileDown,
    title: 'Searchable export',
    copy: 'Download a clean PDF with your edits, matched fonts, and an invisible OCR layer.',
  },
]

const faqs = [
  {
    question: 'Do my PDFs get uploaded?',
    answer:
      'No. OnDiv PDF Editor processes files inside your browser tab. Your document is never uploaded to a server. The OCR engine and language data are downloaded from a CDN the first time you use OCR, but the PDF itself stays on your device.',
  },
  {
    question: 'Can I edit a scanned PDF?',
    answer:
      'Yes. OCR turns the page image into editable words and lines. Click a word to change just that word, or click the whitespace to edit the whole line. Bold detection marks likely bold words, and the B/I/U toggles let you correct it. Export with searchable OCR enabled to keep the scan’s appearance and add a selectable, searchable text layer.',
  },
  {
    question: 'Is redaction permanent?',
    answer:
      'Yes. The Redact tool flattens affected pages into images inside a freshly rebuilt PDF, removes annotations and document metadata, and verifies on export that no extractable text still overlaps a redaction box. The Cover tool is visual only.',
  },
  {
    question: 'Which browsers are supported?',
    answer:
      'OnDiv PDF Editor works in current versions of Chrome, Edge, Firefox and Safari. Performance is best in Chrome or Edge. Password-protected PDFs and rotated pages are not supported yet.',
  },
]

export function Landing({
  onOpen,
  onSample,
}: {
  onOpen: () => void
  onSample: () => void
}) {
  const busy = useEditor((s) => s.busy)
  const opening = busy === 'opening'

  return (
    <section className="landing">
      <div className="landing-grid" aria-hidden="true" />
      <div className="landing-card">
        <div className="landing-brand">
          <div className="brand-mark">
            <FileText size={19} strokeWidth={2.1} />
          </div>
          <div className="brand-copy">
            <strong>OnDiv</strong>
            <span>PDF Editor</span>
          </div>
        </div>

        <h1>
          Edit, redact and OCR PDFs
          <br />
          <span>without uploading them.</span>
        </h1>
        <p className="landing-lede">
          OnDiv PDF Editor is a private PDF workbench for real documents — including scans.
          Edit a single word or a whole line, correct bold and italic styling, permanently redact
          sensitive content, OCR the image-only pages, then export a clean, searchable PDF that
          keeps the document’s fonts. Everything happens in this tab.
        </p>

        <div className="drop-zone">
          <div className="drop-icon">
            {opening ? <Loader2 size={26} className="spin" /> : <FileText size={26} />}
          </div>
          <div className="drop-copy">
            <strong>{opening ? 'Opening your PDF…' : 'Drop a PDF here'}</strong>
            <span>or pick one from your device. Nothing is sent anywhere.</span>
          </div>
          <div className="drop-actions">
            <button type="button" className="button primary large" onClick={onOpen} disabled={opening}>
              <Upload size={16} />
              Choose PDF
            </button>
            <button type="button" className="button ghost large" onClick={onSample} disabled={opening}>
              Try a sample PDF
              <ArrowUpRight size={15} />
            </button>
          </div>
        </div>

        <div className="feature-grid">
          {features.map((feature) => (
            <div className="feature" key={feature.title}>
              <feature.icon size={17} />
              <div>
                <strong>{feature.title}</strong>
                <span>{feature.copy}</span>
              </div>
            </div>
          ))}
        </div>

        <section className="landing-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Frequently asked questions</h2>
          <div className="faq-grid">
            {faqs.map((faq) => (
              <div className="faq-item" key={faq.question}>
                <strong>{faq.question}</strong>
                <p>{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="landing-note">
          Works best in Chrome or Edge. Password-protected PDFs and pages with a rotation
          entry are not supported yet.
        </p>
      </div>
    </section>
  )
}

# Architecture — OnDiv PDF Editor

This document explains how the editor works, why it is built this way, and what it would take
to turn it into a production editor for complex and scanned PDFs. It assumes the reader knows
the PDF format at a high level: objects, pages, content streams, fonts, and the difference between
PDF coordinates (bottom-left origin) and screen coordinates (top-left origin).

## 1. Constraints that shaped the design

The product constraints were:

1. **No document upload.** The PDF must be processed in the browser tab.
2. **Complex PDFs.** Pages may contain vector art, embedded fonts, images, transparency, crop
   boxes, and rotations. The editor must not redraw the page from scratch.
3. **Scanned PDFs.** Image-only pages must become editable and searchable.
4. **No large backend.** Static hosting is enough; there is no document service to operate.
5. **Fast, non-destructive editing.** Undo/redo and export must be predictable.

The key decision follows from (2) and (3): **never rewrite the original page content**. Render the
original page faithfully, then put an editable overlay on top. The original bytes are the source
of truth; edits are a small, serializable list of patches. This works the same way for a vector
PDF, a scanned page, and a mix of both.

## 2. The data model

```ts
type Patch = {
  id: string
  pageIndex: number
  kind: 'text' | 'redact'
  x: number; y: number; w: number; h: number   // PDF points, top-left origin, 100% zoom
  text?: string
  fontSize?: number
  fontFamily?: 'sans' | 'serif' | 'mono'
  fontFace?: 'liberation' | 'carlito' | 'tinos' | 'caladea' | 'cousine'
  bold?: boolean; italic?: boolean; underline?: boolean
  color?: string        // ink
  baseline?: number     // distance from the box top to the original baseline
  bgColor?: string      // paper / cover
  mask?: boolean        // paint bgColor behind the replacement
  secure?: boolean      // destructive redaction: flatten the page on export
  lineId?: string       // native or OCR line that was replaced
  wordId?: string       // set when only one word was replaced
  source?: 'native' | 'ocr' | 'manual'
  createdAt: number
}
```

`TextLine.words` holds `TextWord` boxes with their own font size, face, weight, style, baseline,
and confidence. OCR and native extraction both populate them. A text patch with `wordId` replaces
one word; a patch with only `lineId` replaces the whole line.

Everything else is derived:

- `patches` — the document overlay, ordered by creation.
- `textLines[page]` — extraction results for click targets, including words.
- `ocr[page]` — OCR status, progress, full text, lines, words, confidence, and bold counts.
- `pdf`, `bytes` — the immutable source document and its bytes.
- `past` / `future` — immutable snapshots of `patches` for undo/redo.

The store is a single Zustand store. Async operations capture a monotonically increasing
`documentToken`; when a new file is opened, stale OCR/render/export results are discarded instead
of being applied to the new document.

## 3. End-to-end flow

```
File / sample PDF
      │
      ▼
ArrayBuffer ──────────────► bytes (kept for export)
      │
      ▼
PDF.js getDocument (worker) ──► PDFDocumentProxy
      │                              │
      │                              ├─ page.getViewport(scale) ─► canvas render
      │                              ├─ page.getTextContent() ───► TextLine[] (native)
      │                              └─ page.render(scale 2) ────► OCR canvas
      │                                                              │
      │                                                              ▼
      │                                                        Tesseract worker
      │                                                              │
      │                                                              ▼
      │                                                        OCR lines + words
      ▼
Patches (cover / replacement / added text)
      │
      ▼
pdf-lib: original bytes + masks + replacement text + invisible OCR lines
      │
      ▼
Blob → download "name-edited.pdf"
```

The UI never mutates the original PDF. The canvas is a view; the patches are the document state.

## 4. Rendering and native text extraction

`src/lib/pdf.ts`:

- Loads PDF.js with a worker (`pdf.worker.min.mjs?url`).
- Points CMaps, standard fonts, wasm, and ICC profiles at assets copied into `public/pdfjs/`.
- Calls `page.getViewport({ scale })` for layout and `page.render()` for pixels.
- Uses `TextLayer` for the selectable text overlay visible over the canvas.

For editing targets, `extractTextLines()` converts PDF.js text items into line boxes:

1. Transform each item's text matrix through the scale-1 viewport.
2. Skip items whose rotation is non-zero (`atan2` of the transformed matrix).
3. Compute font size from the transformed matrix, ascent/descent from the text style.
4. Group items with a similar baseline (within 2 pt), similar size (within 1 pt), and a horizontal
   gap between `-0.5 × fontSize` and `1.4 × fontSize`.
5. Emit a `TextLine` with `x`, `y`, `width`, `height`, `fontSize`, and a normalized font family
   (`sans` / `serif` / `mono`).

This is deliberately a heuristic. It works well for office documents, invoices, and reports.
It will merge or split unusual layouts, and it skips rotated text. A production implementation
would use the PDF.js text layer's geometry, paragraph detection, and font metadata, and would
handle vertical writing and rotation.

Each `TextLine` also carries `TextWord` boxes. Native word boxes are approximated proportionally
inside each PDF.js text item, using the item's text and font size. OCR word boxes come directly
from Tesseract. Words shorter than two characters are not classified for weight; they inherit the
line's weight instead.

### Why the visible text layer and the editable targets are separate

PDF.js's `TextLayer` is a transparent selection layer with spans positioned over the canvas. It
is excellent for selection but not a stable editing model. The editor's `TextLine` list is derived
from the same text content but grouped into boxes. When the **Edit text** tool is active, word
boxes sit above line boxes: clicking a word opens a textarea for that word, while clicking line
whitespace opens one for the whole line. The browser's own text layout is used for typing, which
keeps the interaction immediate.

## 5. Text editing: cover + replacement

When a user accepts an edit:

- If the new text is empty, add a `kind: 'redact'` patch (a cover) for the word or line.
- Otherwise add a `kind: 'text'` patch with `mask: true` at the word or line box. Word patches
  carry both `wordId` and `lineId`; line patches carry only `lineId`.
- Committing a line patch removes existing word patches for that line in the same history entry,
  so an older word replacement cannot reappear through a newer line mask.
- The inline editor exposes **B**, **I**, and **U** toggles. Detection is a starting point;
  toggling changes the patch, never the source document.
- A word replacement expands into following whitespace when it can, but preserves a natural gap
  before the next word. If it is still too long, preview and export shrink the face to fit the
  patch width while keeping the original baseline.

The patch is drawn twice: once as a background rectangle in the export, and once as HTML text in
the preview. Masks are painted before all replacement text so a replacement is never hidden by a
later cover.

### Colour sampling

`src/lib/color.ts` samples the rendered canvas under the line box (plus 2 px padding), bins the
pixels into 4-bit RGB buckets, and treats the most common bucket as the **background**. The first
bucket at least 55 RGB units away from the background (and at least 1% of its pixel count) becomes
the **ink**. This is what makes replacements blend into off-white scans and tinted paper instead
of looking like a white sticker.

### Fonts

The preview and export use five bundled metric-compatible families:

| Bundled face | Metrically compatible with |
| --- | --- |
| Liberation Sans | Arial / Helvetica |
| Carlito | Calibri |
| Tinos | Times New Roman |
| Caladea | Cambria |
| Cousine | Courier New |

`matchPageFont()` renders candidate faces and compares them with the page's glyph samples;
`fontFaceFromName()` maps PDF font names to the same families. Native lines and OCR words inherit
the matched face, and each word's weight/style selects the regular, bold, italic, or bold-italic
variant.

Export loads the TTF, registers `@pdf-lib/fontkit`, and embeds the face as a Type0 font with a
ToUnicode map. Tinos, Caladea, Cousine, and Liberation are subset to the glyphs actually used.
Carlito is embedded whole because the bundled subsetter truncates its `glyf` table, which would
leave extractable text that renders blank. The exact original font is not copied from the source
PDF; the matched family is a visual approximation. Characters outside the bundled face are
sanitized to `?`.

### Why not remove the original text?

True text removal requires editing the page content stream. PDF text is not a string in a
paragraph; it is a sequence of glyph runs (`Tj`/`TJ`) with font resources, encodings, widths,
kerning, text matrices, clipping, and sometimes Type 3 fonts. Editing one line means finding the
glyphs, removing or replacing them without breaking surrounding operators, and preserving layout.
That is a PDF layout engine, not a regex.

The overlay model is deterministic and works on both vector and scanned pages. The trade-off is
explicit: **the original text is still present in the PDF and remains copyable/searchable.** A
visual cover is not a secure redaction. The separate **Redact** tool opts into a destructive
path: the composed page is rasterized, the original page object is discarded, and a fresh PDF is
written (§7.1). See §9 and §11 for the remaining limits.

## 6. OCR pipeline for scanned pages

`src/lib/ocr.ts` and `runOcr()` in `src/store.ts`:

1. User runs OCR for the current page.
2. Render the page at **scale 2** to a fresh canvas (`renderPageToCanvas`). This is independent of
   the on-screen zoom, giving Tesseract a stable, high-resolution image.
3. `getWorker(language)` lazily creates and reuses a Tesseract.js worker (`createWorker(language,
   1, { logger })`). The worker is terminated and recreated when the language changes.
4. Recognize with `{ text: true, blocks: true }`, then convert block → paragraph → line → word
   boxes from pixels to PDF points by dividing by the render scale.
5. Analyse style. `analyzeWordStyle()` extracts a tight ink mask and computes the fraction of ink
   that sits in the stroke core, using a distance transform whose cutoff scales with cap height.
   `pageBoldCutoff()` runs Otsu's method over every measured word on the page and accepts the split
   only when the two clusters are clearly separated and the heavy cluster looks like real bold
   text; otherwise it falls back to the fixed 0.485 cutoff. `analyzeLineStyle()` handles italic,
   underline, and ink colour. Words shorter than two characters inherit the line's weight.
6. Emit `TextLine[]` with `source: 'ocr'`, confidence, style, and `TextWord[]` editing targets.
7. If the page had **no native text**, replace `textLines[page]` with the OCR lines, so the page
   becomes clickable/editable. If the page already has native text, keep the native lines and
   treat OCR as a preview; embedding a second text layer would duplicate search results.

Progress is reported from the Tesseract logger, throttled to ~8 updates/second. The busy flag
blocks starting a second OCR/export while one is running.

The first OCR run downloads the Tesseract worker, WASM core, and language model from CDN. Only
those assets are fetched; the page image is passed to the worker locally. For an air-gapped or
strict privacy deployment, self-host the worker/core/traineddata and configure Tesseract's
`workerPath`, `corePath`, and `langPath`.

## 7. Export with pdf-lib

`src/lib/export.ts` has two paths. The ordinary overlay path runs when no patch has
`secure: true`. The secure path runs as soon as one does, and rebuilds the whole document.

### 7.0 Ordinary overlay export

1. Dynamically import pdf-lib (keeps the initial bundle smaller).
2. `PDFDocument.load(originalBytes)`.
3. For every patch page, reject pages whose `/Rotate` is not 0.
4. Paint all cover rectangles first, then all replacement text with the matched embedded face.
   Word patches are fitted to their patch width; line patches keep the extracted size.
5. Add invisible OCR text for scanned pages when the user has **Add searchable OCR text**
   enabled.
6. Set producer/modification date and serialize to `Uint8Array`; the store wraps it in a Blob and
   triggers a download.

This path is deliberately unchanged: the original page content stays in the file, so covers are
visual only and redacted text would remain extractable.

### 7.1 Secure redaction export

The secure path treats the imported document as a source of pixels, not as the output:

1. Load the source, reject overlay patches on rotated pages, and group secure patches by page.
2. Create a **new** `PDFDocument`. Nothing from the source catalog is reused.
3. For each page without secure patches: copy the page into the new document, strip page-level
   `Annots`, `AA`, `Metadata`, `PieceInfo`, `StructParents`, `Tabs`, `Thumb`, and `AF`, then
   paint visual masks, replacement text, and the normal OCR layer.
4. For each page with a secure patch:
   - Copy the page into a throwaway single-page PDF and strip its annotations.
   - Paint visual masks, then replacement text, then solid black secure masks. This reproduces
     the preview's z-order, so a redaction always wins an overlap.
   - Rasterize that PDF with PDF.js at up to 300 DPI (capped at 10,000 px per side and 24 MP),
     encode JPEG at quality 0.92, and embed it on a fresh page sized to the crop box.
   - Add invisible OCR text for lines outside all masks. On a flattened page this is done even
     when OCR was previously “preview only”, because the native text no longer exists.
   - The throwaway PDF, its original text, images, annotations, and any embedded OCR are never
     referenced by the output.
5. Strip document-level `Metadata`, `PieceInfo`, `StructTreeRoot`, `MarkInfo`, `Outlines`,
   `Names`, `AcroForm`, `OpenAction`, `AA`, `JavaScript`, `Perms`, `AF`, `Collection`, and
   `PageLabels` from the new catalog. Write a fresh producer, creator, creation date, and
   modification date. The original Info dictionary is not copied.
6. Reopen the finished bytes with PDF.js and extract text line boxes from every flattened page.
   If any box intersects one of that page's redaction rectangles, throw and abort the download.
   If verification cannot run, the export fails closed.

The temporary PDF step exists so the raster image uses exactly the same mask/text geometry and
matched-font metrics as the ordinary exporter, rather than a second canvas text renderer.

Rasterizing destroys the original text and image objects on that page, but it also means that
page loses selectable native text, vector sharpness, links, form fields, and annotations. OCR can
restore searchability only outside the redacted boxes, and only for languages the OCR engine
supports.

### Coordinate conversion

PDF.js viewports use a top-left origin; PDF content uses bottom-left. For a page with crop box
`(cx, cy, cw, ch)` and a patch `(x, y, w, h)` in viewport points:

```
pdfX = cx + x
pdfY = cy + ch - y - h
```

Replacement text is drawn at the baseline:

```
baselineY = cy + ch - y - fontSize * ascent
```

The code uses `page.getCropBox()` rather than `getMediaBox()` because PDF.js renders the crop box.
For an ordinary PDF these are the same; for cropped PDFs using the media box would shift every
overlay. Rotation would require transforming each corner by the page's rotation matrix and is
currently rejected.

### The invisible OCR layer

For each OCR word that is not covered by a mask:

- Sanitize the text.
- Start from `fontSize = word.fontSize ?? line.height × 0.82`.
- Measure the natural width with the embedded standard font, then scale the size by
  `clamp(word.width / naturalWidth, 0.6, 1.6)`.
- Draw at `opacity: 0`.

Writing one string per word is important for word-level editing. A single-word replacement removes
only that word's invisible text; the rest of the line stays searchable. When a line has no word
boxes, the exporter falls back to one string per line. The font-size fit keeps invisible selection
boxes close to the visible words without distorting the page pixels. The scan image itself is
untouched.

## 8. State, history, and performance

- **Immutable patches.** Every edit creates a new array; `past` and `future` hold snapshots.
- **Coalescing.** Drags, colour pickers, and inspector typing pass a key. Consecutive changes with
  the same key within 1.2 s replace the previous history entry instead of flooding the stack.
- **Render cancellation.** `PageView` cancels the previous PDF.js render task and text layer when
  the page or zoom changes.
- **Lazy loading.** pdf-lib and Tesseract.js are dynamic imports. Only the PDF.js worker is needed
  to view a document.
- **DPR cap.** Canvas backing store is capped at 2× device pixel ratio to bound memory on 4K
  displays.
- **Page text cache.** `textLines[page]` is extracted once per page and reused.
- **No persistence.** There is intentionally no localStorage/IndexedDB copy of the PDF. This
  avoids silent storage growth and makes the privacy story simple; the cost is data loss if the
  tab closes.

For a production build, the next performance steps are: render visible pages only (virtualized
multi-page view), tile very large pages, move export into a worker, reuse a single offscreen
canvas for OCR, and stream large files with the File System Access API instead of holding two
copies in memory.

## 9. Privacy and security model

What is true:

- The PDF bytes never leave the tab. There is no upload endpoint or server-side storage.
- OCR runs in a Web Worker on a canvas rendered locally.
- Edit state is in memory; the exported file is produced with pdf-lib in the tab.

What is not true:

- **A cover is not redaction.** The original glyphs and images remain in the PDF. The text is
  still extractable. Only the **Redact** tool opts into destructive export.
- **Secure redaction is scoped to the flattened page.** The output contains only an image of
  that page: original text, embedded images, annotations, form fields, and links are gone. The
  page becomes a JPEG at up to 300 DPI, so fine vector detail is lost. OCR text is re-added only
  outside the redaction boxes. The export verifies text/box intersections and aborts if any
  extractable text remains over a redaction.
- **Secure export is not a universal sanitizer.** It strips the catalog and page keys listed in
  §7.1, but copied pages can still reference arbitrary content in their resource streams, and
  the rasterized page is not scrubbed for steganography or visual information outside the black
  boxes. It does not validate PDF/A or certify compliance with a legal redaction standard.
- **OCR is not private from the CDN.** The first run fetches the engine and language model from a
  CDN. No page image is sent, but the request reveals that the app is being used. Self-host the
  assets if that matters.
- **Malicious PDFs are still parsed by PDF.js and pdf-lib.** Keep dependencies patched. PDF.js
  runs parsing in a worker and does not execute PDF JavaScript, but parsers are attack surface.

A production threat model should still add CSP, integrity checks for CDN assets, a self-hosted
OCR bundle, pixel-level image redaction for scans, vector content removal without rasterization,
and an audit trail for who redacted what.

## 10. What "complex PDF" means here

Handled by the overlay approach:

- Mixed vector/raster pages, embedded fonts, transparency, gradients, images.
- Native text and scanned pages in the same document.
- Crop boxes (export uses the crop box).
- Very dense pages, as long as the browser can render them.
- Secure redaction on unrotated pages: the page is flattened at up to 300 DPI and rebuilt.

Not handled yet:

- Pages with a non-zero `/Rotate`.
- Encrypted documents.
- Form fields, annotations, signatures, attachments, layers (OCG), and PDF JavaScript.
- Text inside rotated/vertical writing modes.
- CJK/Arabic/Hindi text editing and export beyond the bundled faces' glyph coverage.
- Genuine content-stream editing, reflow, or paragraph-level layout.
- Multi-page OCR queues and automatic language detection.
- Redacting part of a page without rasterizing the whole page while preserving vectors.
- Scrub-and-verify of image pixels or metadata inside copied (non-redacted) pages.

## 11. The hard problems, in order

1. **True redaction.** This editor takes the defensible shortcut: rasterize the whole page,
   rebuild the document, and reopen the output to assert that no extractable text intersects a
   redaction box. The remaining work is region-level removal that keeps the rest of the page
   vector, pixel-level scrubbing of scanned images, and content-stream scrubbing on pages whose
   text is not flattened.
2. **Exact font matching and embedding.** The editor matches the page to a bundled
   metric-compatible family and embeds that face. The next step is reading the source font
   descriptor, confirming the licence, and embedding the exact original font instead of a
   lookalike, with a visible warning when matching fails.
3. **Content-stream editing.** A real "edit text" mode that removes glyph runs, updates `TJ`
   offsets, handles clipping and text matrices, and reflows. This is a multi-month engineering
   effort; a commercial SDK may be the pragmatic choice.
4. **Rotation and crop transforms.** Record page rotation and map viewport rectangles into PDF
   space for all four quadrants. Test with pages rotated 90/180/270 and non-zero crop origins.
5. **Multi-page OCR at scale.** A worker pool, page queue, cancellation, progress per page,
   language auto-detection, deskew/denoise, and a review UI for low-confidence words.
6. **Large documents.** Virtualized rendering, tile caching, streaming file access, memory
   budgets, and export in a worker.
7. **Forms and annotations.** Render widgets, edit field values, flatten appearances, and preserve
   signatures. This is a separate product surface.
8. **PDF/A and accessibility.** Tagged PDF, reading order, alt text, and validation are not
   achievable by overlaying content.

## 12. Alternatives considered

- **Server-side rendering/OCR.** Simplest for heavy scanned documents and large files, but
  violates the "no upload" constraint and adds operational cost.
- **PDFium compiled to WASM.** Excellent rendering fidelity, but it does not give you a text
  editing model either; you would still build the overlay or content-stream layer.
- **Commercial SDK (PSPDFKit/Nutrient, Apryse, Adobe).** Mature text editing, redaction, forms,
  and OCR. The right call when time-to-market and compliance matter more than licence cost.
- **pdf-lib for page operations only.** Keep it for merge/split/rotate/metadata, and keep the
  overlay editor for text. This is the pragmatic split used here.
- **Canvas-only annotation apps.** Great for signatures and highlights, but they cannot satisfy
  "edit the text in a scanned invoice" without OCR and a text layer.

## 13. How the build was verified

- `npm run build` compiles TypeScript and produces the production bundle.
- `scripts/make-sample.mjs` creates a deterministic three-page fixture: native text, an
  image-only scan, and a dense appendix.
- Headless Chrome (Puppeteer) passes exercised: demo open, word and line replacement, B/I/U
  correction, add text, cover drag, undo/redo, OCR of the scanned page, export, re-opening the
  exported PDF, and extraction of the exported text layer.
- Word patches were checked against the exported content: one text run, the original baseline, a
  fitted width that ends before the next word, and an embedded Carlito-Bold Type0 font with
  `/FontFile2` and a ToUnicode map.
- OCR bold detection was checked on a mixed-style certificate and a scanned invoice: bold headers,
  names, dates, labels, and totals were flagged per word while surrounding regular words stayed
  regular.
- The exported scan keeps its pixels and gains extractable OCR words; the exported native page
  contains word/line replacements and added text as extractable text items.
- Secure-redaction and crop-box passes redact known strings, export, reopen the output, assert
  that the strings are absent from the extracted text, assert that redacted pages have no
  original text boxes over the black area, and check that the output has no annotations or
  original XMP metadata.

Useful next tests: a corpus with rotated pages, crop offsets, encrypted files, CJK text, forms,
and a 1,000-page document; visual regression screenshots; OCR-on-flattened-page verification; and
large-page raster caps.

## 14. Build order if you are starting from scratch

1. **Viewer:** PDF.js worker + canvas + page navigation + fit-to-width.
2. **Overlay model:** `Patch` type, store, undo/redo, coordinate conversion.
3. **Native text:** extract lines and word boxes, click targets, word/line inline editor, cover +
   replacement, export with pdf-lib.
4. **Scanned text:** render to canvas, Tesseract worker, line/word parsing, style and bold
   detection, OCR targets, invisible searchable export.
5. **Polish:** colour sampling, font matching and embedding, shortcuts, drag/drop, error states,
   progress, tests.
6. **Production hardening:** rotation/crop, exact source-font extraction, region-level redaction,
   persistence, worker pool, self-hosted OCR, sanitization, and a fixture corpus.

The editor in this repository is steps 1–5 plus page-level secure redaction. The architecture
notes above are the map for step 6.

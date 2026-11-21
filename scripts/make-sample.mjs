// Generates public/sample.pdf: a 3-page document that exercises the editor.
// Page 1 is a normal vector/text page, page 2 is an image-only "scan", and
// page 3 is a dense text page.
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const W = 595.28
const H = 841.89
const ink = rgb(0.09, 0.11, 0.15)
const muted = rgb(0.38, 0.41, 0.47)
const accent = rgb(0.12, 0.35, 0.95)
const line = rgb(0.86, 0.88, 0.92)

const doc = await PDFDocument.create()
doc.setTitle('Northwind Field Report')
doc.setAuthor('PDF Editor demo')
doc.setSubject('A sample document for local-first PDF editing')

// ---------------------------------------------------------------- page one
{
  const page = doc.addPage([W, H])
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const serif = await doc.embedFont(StandardFonts.TimesRoman)

  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent })

  page.drawText('NORTHWIND LABS', {
    x: 56,
    y: H - 72,
    size: 9,
    font: bold,
    color: accent,
  })
  page.drawText('Field report / Q3', {
    x: W - 160,
    y: H - 72,
    size: 9,
    font: helv,
    color: muted,
  })

  page.drawText('Signals from the', {
    x: 56,
    y: H - 132,
    size: 32,
    font: bold,
    color: ink,
  })
  page.drawText('edge of the map', {
    x: 56,
    y: H - 170,
    size: 32,
    font: bold,
    color: accent,
  })

  page.drawText(
    'A field study of how small teams keep working when the network disappears.',
    { x: 56, y: H - 202, size: 13, font: serif, color: muted },
  )

  page.drawLine({
    start: { x: 56, y: H - 228 },
    end: { x: W - 56, y: H - 228 },
    thickness: 0.8,
    color: line,
  })

  const left =
    'The best tools are the ones you can still use when the signal drops. ' +
    'Over eleven weeks we interviewed forty-two field teams across six ' +
    'countries, from glacier research stations to coastal survey crews.'
  const right =
    'Every team had quietly built a local-first workflow. The pattern was ' +
    'consistent: keep the source file on the device, make edits instantly, ' +
    'and defer the network until it is genuinely useful.'

  page.drawText(left, {
    x: 56,
    y: H - 258,
    size: 10.5,
    font: serif,
    color: ink,
    lineHeight: 16,
    maxWidth: 228,
  })
  page.drawText(right, {
    x: 312,
    y: H - 258,
    size: 10.5,
    font: serif,
    color: ink,
    lineHeight: 16,
    maxWidth: 228,
  })

  // A small callout card.
  page.drawRectangle({
    x: 56,
    y: H - 432,
    width: 484,
    height: 86,
    color: rgb(0.95, 0.97, 1),
    borderColor: rgb(0.82, 0.88, 1),
    borderWidth: 0.8,
  })
  page.drawText('01  THE LOCAL-FIRST PRINCIPLE', {
    x: 74,
    y: H - 374,
    size: 8,
    font: bold,
    color: accent,
  })
  page.drawText('Your document should open in a browser tab, not a queue.', {
    x: 74,
    y: H - 398,
    size: 12,
    font: bold,
    color: ink,
  })
  page.drawText(
    'No upload, no waiting, no server bill. The editor is the runtime.',
    { x: 74, y: H - 416, size: 9.5, font: serif, color: muted },
  )

  // Table.
  page.drawText('Selected observations', {
    x: 56,
    y: H - 486,
    size: 15,
    font: bold,
    color: ink,
  })
  const rows = [
    ['Team', 'Sessions', 'Offline time', 'Workaround'],
    ['Glacier survey', '38', '62%', 'Local PDF packets'],
    ['Coastal mapping', '24', '41%', 'Cached tiles + notes'],
    ['Archive unit', '51', '77%', 'Scanned + OCR on device'],
    ['Field clinic', '19', '35%', 'Form templates offline'],
  ]
  rows.forEach((row, index) => {
    const y = H - 516 - index * 26
    if (index === 0) {
      page.drawRectangle({
        x: 56,
        y: y - 8,
        width: 484,
        height: 24,
        color: rgb(0.96, 0.97, 0.99),
      })
    }
    const xs = [68, 300, 382, 470]
    row.forEach((cell, column) => {
      page.drawText(cell, {
        x: xs[column],
        y,
        size: index === 0 ? 8 : 9,
        font: index === 0 ? bold : serif,
        color: index === 0 ? muted : ink,
      })
    })
    page.drawLine({
      start: { x: 56, y: y - 10 },
      end: { x: W - 56, y: y - 10 },
      thickness: 0.5,
      color: line,
    })
  })

  // Rotated stamp so the sample contains a non-trivial text matrix.
  page.drawText('REVIEWED', {
    x: 438,
    y: H - 690,
    size: 22,
    font: bold,
    color: rgb(0.72, 0.16, 0.2),
    rotate: { type: 'degrees', angle: 12 },
    opacity: 0.7,
  })

  page.drawText('Northwind Labs · Internal field series · 2026', {
    x: 56,
    y: 42,
    size: 8,
    font: helv,
    color: muted,
  })
  page.drawText('1 / 3', { x: W - 72, y: 42, size: 8, font: helv, color: muted })
}

// ---------------------------------------------------------------- page two
// Render a "scanned" invoice into a bitmap and place it as a full-page image.
{
  const scale = 2
  const canvas = createCanvas(Math.round(W * scale), Math.round(H * scale))
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)

  ctx.fillStyle = '#f7f4ec'
  ctx.fillRect(0, 0, W, H)

  // Subtle paper texture / scanner noise.
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const shade = 180 + Math.floor(Math.random() * 55)
    ctx.fillStyle = `rgba(${shade}, ${shade - 4}, ${shade - 12}, 0.16)`
    ctx.fillRect(x, y, 1, 1)
  }

  ctx.fillStyle = '#1a1d23'
  ctx.font = 'bold 28px Georgia'
  ctx.fillText('HARBOR & PINE', 58, 84)
  ctx.font = '11px Arial'
  ctx.fillStyle = '#5b5b5b'
  ctx.fillText('SUPPLY CO.  ·  18 WHARF STREET  ·  PORTLAND, ME', 58, 104)

  ctx.strokeStyle = '#c8c2b4'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(58, 122)
  ctx.lineTo(537, 122)
  ctx.stroke()

  ctx.fillStyle = '#1a1d23'
  ctx.font = 'bold 16px Arial'
  ctx.fillText('INVOICE', 58, 162)
  ctx.font = '12px Arial'
  ctx.fillText('Invoice no. HP-2048', 386, 152)
  ctx.fillText('Issued 14 August 2026', 386, 170)

  ctx.font = '12px Arial'
  ctx.fillText('Bill to', 58, 202)
  ctx.font = 'bold 13px Arial'
  ctx.fillText('Northwind Field Station', 58, 222)
  ctx.font = '12px Arial'
  ctx.fillText('Attn: Logistics desk', 58, 240)
  ctx.fillText('12 Glacier Road, Unit 4', 58, 258)
  ctx.fillText('Reykjavik, 101', 58, 276)

  const items = [
    ['Field notebooks (pack of 5)', '4', '18.00', '72.00'],
    ['Waterproof map cases', '2', '34.50', '69.00'],
    ['Thermal paper rolls', '12', '4.25', '51.00'],
    ['USB-C field drives, 1 TB', '3', '96.00', '288.00'],
    ['Shipping + handling', '', '', '24.00'],
  ]
  let y = 330
  ctx.font = 'bold 10px Arial'
  ctx.fillStyle = '#6b665c'
  ctx.fillText('DESCRIPTION', 58, y)
  ctx.fillText('QTY', 372, y)
  ctx.fillText('UNIT', 420, y)
  ctx.fillText('TOTAL', 486, y)
  y += 10
  ctx.strokeStyle = '#bdb6a6'
  ctx.beginPath()
  ctx.moveTo(58, y)
  ctx.lineTo(537, y)
  ctx.stroke()

  ctx.fillStyle = '#1a1d23'
  for (const [desc, qty, unit, total] of items) {
    y += 30
    ctx.font = '13px Georgia'
    ctx.fillText(desc, 58, y)
    ctx.font = '12px Arial'
    ctx.fillText(qty, 374, y)
    ctx.fillText(unit, 418, y)
    ctx.fillText(total, 484, y)
    ctx.strokeStyle = '#ded8ca'
    ctx.beginPath()
    ctx.moveTo(58, y + 10)
    ctx.lineTo(537, y + 10)
    ctx.stroke()
  }

  y += 50
  ctx.font = '12px Arial'
  ctx.fillStyle = '#5b5b5b'
  ctx.fillText('Subtotal', 380, y)
  ctx.fillText('Tax (7.5%)', 380, y + 22)
  ctx.font = 'bold 14px Arial'
  ctx.fillStyle = '#1a1d23'
  ctx.fillText('TOTAL DUE', 380, y + 52)
  ctx.fillText('$504.00', 486, y + 52)
  ctx.font = '12px Arial'
  ctx.fillText('$468.00', 486, y)
  ctx.fillText('$36.00', 486, y + 22)

  ctx.font = '12px Georgia'
  ctx.fillStyle = '#3f3b33'
  ctx.fillText('Payment due within 30 days. Thank you for working with us.', 58, y + 104)
  ctx.font = '11px Arial'
  ctx.fillText('Questions? billing@harborandpine.example · +1 207 555 0142', 58, y + 126)

  // Paid stamp.
  ctx.save()
  ctx.translate(400, y + 190)
  ctx.rotate(-0.22)
  ctx.strokeStyle = 'rgba(160, 40, 45, 0.75)'
  ctx.lineWidth = 3
  ctx.strokeRect(-78, -24, 156, 48)
  ctx.fillStyle = 'rgba(160, 40, 45, 0.75)'
  ctx.font = 'bold 26px Arial'
  ctx.fillText('PAID', -32, 9)
  ctx.restore()

  ctx.fillStyle = '#8b8578'
  ctx.font = '10px Arial'
  ctx.fillText('Scanned document · page 2', 58, H - 46)

  const png = canvas.toBuffer('image/png')
  const image = await doc.embedPng(png)
  const page = doc.addPage([W, H])
  page.drawImage(image, { x: 0, y: 0, width: W, height: H })
}

// ---------------------------------------------------------------- page three
{
  const page = doc.addPage([W, H])
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const serif = await doc.embedFont(StandardFonts.TimesRoman)

  page.drawText('Appendix', { x: 56, y: H - 78, size: 26, font: bold, color: ink })
  page.drawText('Method notes and a deliberately dense page', {
    x: 56,
    y: H - 100,
    size: 10,
    font: helv,
    color: muted,
  })
  page.drawLine({
    start: { x: 56, y: H - 120 },
    end: { x: W - 56, y: H - 120 },
    thickness: 0.8,
    color: line,
  })

  const paragraphs = [
    'The study used a mixed-method protocol: a structured intake interview, a week of contextual observation, and a closing audit of the team’s file handling practices. All notes were transcribed on site and checked against a second observer’s record. Where teams used paper, the paper was photographed and indexed with the same schema as digital files.',
    'Offline time was measured from the device’s own logs where available, and from observer timestamps otherwise. We excluded scheduled downtime and device charging windows. The figures in this report should be read as directional rather than statistically precise; the sample is small and self-selected, and teams that volunteered were already interested in resilient tooling.',
    'The most surprising finding was not the frequency of outages but the social cost of recovery. Teams tolerated lost connectivity; they did not tolerate lost context. A document that opened instantly, retained its edits, and kept its place in the review queue was worth more than a richer tool that required a reconnect to become useful.',
    'Local-first software is often described as a synchronization strategy. In the field it functions more like a promise: the work you have done is safe, and the tool will not ask you to prove it. That promise is mostly kept by unglamorous engineering — durable local storage, deterministic merge rules, clear conflict UI, and export formats that outlive the application.',
    'We recommend that teams treating PDFs as working documents keep three things true: the file can be opened without a network, edits can be reviewed before they are flattened, and an exported file can be verified against the original. The last point matters most for scans, where the visible page and the searchable text layer can drift apart if the editing pipeline is careless.',
  ]

  let y = H - 150
  for (const [index, text] of paragraphs.entries()) {
    page.drawText(String(index + 1).padStart(2, '0'), {
      x: 56,
      y,
      size: 8,
      font: bold,
      color: accent,
    })
    page.drawText(text, {
      x: 80,
      y,
      size: 10.2,
      font: serif,
      color: ink,
      lineHeight: 15.5,
      maxWidth: 458,
    })
    y -= 112
  }

  page.drawText('End of report', {
    x: 56,
    y: 72,
    size: 9,
    font: bold,
    color: muted,
  })
  page.drawText('3 / 3', { x: W - 72, y: 42, size: 8, font: helv, color: muted })
}

const bytes = await doc.save()
const outDir = path.join(import.meta.dirname, '..', 'public')
await mkdir(outDir, { recursive: true })
await writeFile(path.join(outDir, 'sample.pdf'), bytes)
console.log(`wrote public/sample.pdf (${(bytes.length / 1024).toFixed(0)} KB)`)

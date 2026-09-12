// Optional controlled browser check. Requires a running production preview and agent-browser.
// Run: node scripts/check-mobile-merge.mjs [http://127.0.0.1:4173/]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const directory = mkdtempSync(join(tmpdir(), 'pdf-merge-check-'))
const session = `pdf-check-${Date.now()}`
const deadline = Date.now() + 120_000
function browser(...args) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('Overall check exceeded 120 seconds; no retry performed.')
  const result = spawnSync('agent-browser', ['--session', session, '--pin-tab', ...args], {
    encoding: 'utf8', timeout: Math.min(30_000, remaining), maxBuffer: 512 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`)
  }
}

try {
  for (const name of ['A', 'B']) {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let index = 1; index <= 8; index++) {
      const page = pdf.addPage(index % 3 === 0 ? [700, 420] : [420, 594])
      page.drawText(`${name} - Page ${index}`, { x: 45, y: 320, size: 32, font })
    }
    writeFileSync(join(directory, `${name}.pdf`), await pdf.save())
  }
  browser('open', process.argv[2] ?? 'http://127.0.0.1:4173/')
  browser('set', 'viewport', '390', '844')
  browser('find', 'role', 'button', 'click', '--name', '合并', '--exact')
  browser('upload', 'input[aria-label="选择多个 PDF 文件"]', join(directory, 'A.pdf'), join(directory, 'B.pdf'))
  browser('wait', '--text', '已选 16 页')
  browser('click', 'button[aria-controls="merge-order-panel"]')
  const more = '#merge-order-panel button[aria-label="第 1 页更多操作"]'
  browser('wait', more)
  browser('click', more)
  browser('fill', 'input[aria-label="将当前第 1 页移动到第几页"]', '16')
  // Explicit confirmation avoids relying on focus and a global Enter key event.
  browser('click', 'button[aria-label="将当前页面移到第 16 页"]')
  browser('click', '#merge-order-panel button[title="按当前顺序生成一个合并后的 PDF"]')
  browser('wait', '--text', 'PDF 大小')
  const output = join(directory, 'merged_selected.pdf')
  browser('download', 'button[aria-label="下载 PDF merged_selected.pdf"]', output)

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await getDocument({ data: new Uint8Array(readFileSync(output)), useSystemFonts: true }).promise
  try {
    const expected = [...Array.from({ length: 7 }, (_, i) => `A - Page ${i + 2}`),
      ...Array.from({ length: 8 }, (_, i) => `B - Page ${i + 1}`), 'A - Page 1']
    if (document.numPages !== 16) throw new Error(`Expected 16 pages, got ${document.numPages}`)
    for (let index = 0; index < expected.length; index++) {
      const text = await (await document.getPage(index + 1)).getTextContent()
      const actual = text.items.map(item => 'str' in item ? item.str : '').join(' ').trim()
      if (actual !== expected[index]) throw new Error(`Page ${index + 1}: expected ${expected[index]}, got ${actual}`)
    }
  } finally {
    await document.destroy()
  }
  console.log(`PASS: 16 pages in expected order. Output: ${output}`)
} catch (error) {
  console.error(`CHECK INCOMPLETE (not proof of a product defect): ${error.message}`)
  process.exitCode = 1
} finally {
  console.log(`Session: ${session}. Artifacts: ${directory}. No automatic retries or dialog acceptance.`)
}

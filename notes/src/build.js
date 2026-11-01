// Builds the notes PDF from the HTML parts in this folder.
// Usage: node build.js
// Needs: playwright (Chromium) and pdftotext (poppler-utils).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const SRC = __dirname;
const OUT_DIR = path.resolve(SRC, '..');
const OUT_PDF = path.join(OUT_DIR, 'HS3410_Modern_Science_in_India_Notes.pdf');
const PARTS = [
  '00_front.html',
  '01_ch1.html',
  '02_ch2.html',
  '03_ch4.html',
  '04_ch5.html',
  '05_exam.html',
  '06_revision.html',
];

function read(f) { return fs.readFileSync(path.join(SRC, f), 'utf8'); }

function collectToc(body) {
  // Headings marked with data-toc="1" or data-toc="2"
  const re = /<(h1|h2|h3)[^>]*data-toc="(\d)"[^>]*>([\s\S]*?)<\/\1>/g;
  const items = [];
  let m;
  while ((m = re.exec(body))) {
    const text = m[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    items.push({ level: Number(m[2]), text });
  }
  return items;
}

function tocHtml(items, pages) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<ol>' + items.map((it, i) =>
    `<li class="lvl${it.level}"><span class="t">${esc(it.text)}</span><span class="n">${pages[i] || ''}</span></li>`
  ).join('') + '</ol>';
}

function assemble(tocInner) {
  const css = read('style.css');
  let body = PARTS.map(read).join('\n');
  body = body.replace('<!--TOC-->', tocInner);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>HS 3410 Modern Science in India - Simple Notes</title>
<style>${css}</style></head><body>${body}</body></html>`;
}

async function render(html, file) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: file,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:7.5pt;color:#8a90a0;padding:0 15mm;display:flex;justify-content:space-between;">
      <span>HS 3410 · Modern Science in India · Simple Notes (Arnold, Ch. 1, 2, 4, 5)</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await browser.close();
}

function pageTexts(file) {
  const txt = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  return txt.split('\f').map((p) => p.replace(/\s+/g, ' '));
}

(async () => {
  const allBody = PARTS.map(read).join('\n');
  const items = collectToc(allBody);

  // Pass 1: placeholder numbers (same width so layout does not shift)
  let html = assemble(tocHtml(items, items.map(() => '00')));
  const tmp = path.join(OUT_DIR, '.tmp_pass1.pdf');
  await render(html, tmp);

  // Find page numbers by searching heading text (skip cover + contents page)
  const pages = pageTexts(tmp);
  let start = 2;
  const nums = items.map((it) => {
    const needle = it.text.replace(/\s+/g, ' ').slice(0, 40);
    for (let i = start; i < pages.length; i++) {
      if (pages[i].includes(needle)) { start = i; return String(i + 1); }
    }
    return '';
  });
  const missing = items.filter((_, i) => !nums[i]).map((it) => it.text);
  if (missing.length) console.warn('TOC entries not found:', missing);
  fs.unlinkSync(tmp);

  // Pass 2: real numbers
  html = assemble(tocHtml(items, nums));
  if (process.env.PREVIEW_HTML) fs.writeFileSync(process.env.PREVIEW_HTML, html);
  await render(html, OUT_PDF);
  console.log('Wrote', OUT_PDF, 'pages:', pageTexts(OUT_PDF).length - 1);
})();

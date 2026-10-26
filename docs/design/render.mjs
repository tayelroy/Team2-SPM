// Renders the design sources in this folder to the PDFs kept in the team's
// Google Drive design folder (SG2-95). The diagrams are draw.io files, edited
// by hand in app.diagrams.net (or the draw.io desktop app); this script only
// turns each page into a PDF page.
//
//   node docs/design/render.mjs [outDir]
//
// Needs the repo's Playwright Chromium and network access for the draw.io
// viewer and `npx marked`. To render the diagrams offline, set DRAWIO_VIEWER to
// a local copy of viewer-static.min.js.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(tmpdir(), 'connectsphere-design');
const viewerUrl = 'https://viewer.diagrams.net/js/viewer-static.min.js';
mkdirSync(outDir, { recursive: true });

/** Every page of a draw.io file, in file order, as SVG drawn by the draw.io viewer. */
async function drawio(page, file) {
  const xml = readFileSync(join(here, file), 'utf8');
  const pages = (xml.match(/<diagram\b/g) ?? []).length;
  const svgs = [];
  for (let index = 0; index < pages; index++) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><div id="diagram"></div><script src="${viewerUrl}"></script>`);
    await page.waitForFunction(() => typeof globalThis.GraphViewer !== 'undefined');
    svgs.push(await page.evaluate(({ xml, index }) => new Promise(resolve => {
      const container = document.getElementById('diagram');
      container.setAttribute('data-mxgraph', JSON.stringify({ xml, page: index, toolbar: '', nav: false, lightbox: false }));
      globalThis.GraphViewer.createViewerForElement(container, viewer =>
        resolve(new XMLSerializer().serializeToString(viewer.graph.getSvg('#ffffff', 1, 10))));
    }), { xml, index }));
  }
  if (!svgs.length) throw new Error(`${file}: no pages`);
  return svgs;
}

const markdown = file => execFileSync('npx', ['-y', 'marked@14', '--gfm', '-i', join(here, file)], { maxBuffer: 1 << 26 }).toString();

// PDF name -> draw.io file and, where a file feeds several PDFs, its pages (0-based).
const diagrams = {
  'C4_Level1_System_Context.pdf': ['c4-model.drawio', [0]],
  'C4_Level2_Container_Diagram.pdf': ['c4-model.drawio', [1]],
  'C4_Level3_Component_Diagram.pdf': ['c4-model.drawio', [2, 3, 4, 5, 6]],
  'Class_Diagram.pdf': ['class-diagram.drawio'],
  'Data_Model.pdf': ['data-model.drawio'],
  'Sequence_Diagrams.pdf': ['sequence-diagrams.drawio'],
  'Event_Status_Model.pdf': ['event-status-model.drawio'],
};
const documents = {
  'API_Specification.pdf': markdown('api-specification.md'),
  'Architectural_Decisions_and_Notes.pdf': markdown('architectural-decisions.md'),
};

const browser = await chromium.launch();
const page = await browser.newPage();
if (process.env.DRAWIO_VIEWER) {
  await page.route(viewerUrl, route => route.fulfill({ path: process.env.DRAWIO_VIEWER, contentType: 'application/javascript' }));
}
const rendered = {};
for (const [name, [file, pages]] of Object.entries(diagrams)) {
  rendered[file] ??= await drawio(page, file);
  const svgs = pages ? pages.map(index => rendered[file][index]) : rendered[file];
  if (svgs.some(svg => !svg)) throw new Error(`${name}: ${file} has fewer pages than expected`);
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    section{page-break-after:always;height:184mm;display:flex;align-items:center;justify-content:center}
    section:last-child{page-break-after:auto} svg{max-width:100%;max-height:100%;width:auto;height:auto}
  </style>${svgs.map(svg => `<section>${svg}</section>`).join('')}`);
  // The viewer fixes width/height in pixels; let CSS scale each diagram to the page.
  await page.evaluate(() => document.querySelectorAll('section > svg').forEach(svg => {
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width'))} ${parseFloat(svg.getAttribute('height'))}`);
    svg.removeAttribute('width'); svg.removeAttribute('height'); svg.removeAttribute('style');
  }));
  await page.pdf({ path: join(outDir, name), format: 'A4', landscape: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
}
for (const [name, html] of Object.entries(documents)) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{font:10.5pt/1.45 -apple-system,Helvetica,Arial,sans-serif;color:#111}
    h1{font-size:20pt} h2{font-size:14pt;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:22px} h3{font-size:11.5pt}
    table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9pt} th,td{border:1px solid #bbb;padding:3px 6px;vertical-align:top;text-align:left}
    th{background:#f0f0f0} code{font:8.5pt Menlo,monospace;background:#f5f5f5;padding:0 2px} tr{page-break-inside:avoid}
  </style>${html}`);
  await page.pdf({ path: join(outDir, name), format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
}
await browser.close();
console.log(`Wrote ${Object.keys(diagrams).length + Object.keys(documents).length} PDFs to ${outDir}`);

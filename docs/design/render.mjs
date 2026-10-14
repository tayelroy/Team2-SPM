// Renders the design sources in this folder to the PDFs kept in the team's
// Google Drive design folder (SG2-95). Diagrams are code; the PDFs are output.
//
//   PLANTUML_JAR=… STRUCTURIZR_CLI=…/structurizr.sh node docs/design/render.mjs [outDir]
//
// Needs Java (PlantUML, Structurizr CLI), the repo's Playwright Chromium, and
// network access for `npx marked`. Graphviz is not needed: non-sequence
// diagrams use `!pragma layout smetana`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(tmpdir(), 'connectsphere-design');
const jar = process.env.PLANTUML_JAR;
const structurizr = process.env.STRUCTURIZR_CLI;
if (!jar || !structurizr) throw new Error('Set PLANTUML_JAR and STRUCTURIZR_CLI.');
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'design-render-'));

/** Every diagram in a PlantUML file, as SVG, in file order. */
function plantuml(source) {
  // Structurizr's export cannot carry `!pragma layout smetana`, so set it here.
  const svg = execFileSync('java', ['-jar', jar, '-tsvg', '-Playout=smetana', '-pipe', '-pipedelimitor', '@@SPLIT@@', '-failfast2'],
    { input: readFileSync(source), maxBuffer: 1 << 28 }).toString();
  return svg.split('@@SPLIT@@').map(part => part.trim()).filter(part => part.startsWith('<'));
}

execFileSync('bash', [structurizr, 'export', '-w', join(here, 'connectsphere.dsl'), '-f', 'plantuml/c4plantuml', '-o', work], { stdio: 'ignore' });
const c4 = Object.fromEntries(readdirSync(work).filter(f => f.endsWith('.puml'))
  .map(f => [f.replace(/^structurizr-|\.puml$/g, ''), plantuml(join(work, f))]));

const markdown = file => execFileSync('npx', ['-y', 'marked@14', '--gfm', '-i', join(here, file)], { maxBuffer: 1 << 26 }).toString();

const diagrams = {
  'C4_Level1_System_Context.pdf': c4.C1_Context,
  'C4_Level2_Container_Diagram.pdf': c4.C2_Containers,
  'C4_Level3_Component_Diagram.pdf': ['C3_API_Components', 'C3_API_Components_Events', 'C3_API_Components_Venues', 'C3_API_Components_Bookings']
    .flatMap(view => c4[view] ?? []),
  'Class_Diagram.pdf': plantuml(join(here, 'class-diagram.puml')),
  'Data_Model.pdf': plantuml(join(here, 'data-model.puml')),
  'Sequence_Diagrams.pdf': plantuml(join(here, 'sequence-diagrams.puml')),
  'Event_Status_Model.pdf': plantuml(join(here, 'event-status-model.puml')),
};
const documents = {
  'API_Specification.pdf': markdown('api-specification.md'),
  'Architectural_Decisions_and_Notes.pdf': markdown('architectural-decisions.md'),
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, svgs] of Object.entries(diagrams)) {
  if (!svgs?.length) throw new Error(`${name}: no diagrams rendered`);
  await page.setContent(`<!doctype html><style>
    section{page-break-after:always;height:184mm;display:flex;align-items:center;justify-content:center}
    section:last-child{page-break-after:auto} svg{max-width:100%;max-height:100%;width:auto;height:auto}
  </style>${svgs.map(svg => `<section>${svg.replace(/<\?xml[^>]*>/, '')}</section>`).join('')}`);
  // PlantUML fixes width/height in pixels; let CSS scale each diagram to the page.
  await page.evaluate(() => document.querySelectorAll('svg').forEach(svg => {
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

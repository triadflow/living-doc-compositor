#!/usr/bin/env node
/**
 * Migrates an old-format living doc HTML (block-based) to universal JSON format.
 * Usage: node migrate-old-living-doc.mjs <path-to-old.html> [--render]
 * Writes a .json file alongside the HTML. If --render is passed, also renders the new HTML.
 */
import fs from 'node:fs';
import path from 'node:path';

function decodeEntities(s) {
  return s.replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013')
    .replace(/&rarr;/g, '\u2192').replace(/&larr;/g, '\u2190')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

const htmlPath = process.argv[2];
const doRender = process.argv.includes('--render');

if (!htmlPath) { console.error('Usage: migrate-old-living-doc.mjs <path-to-old.html> [--render]'); process.exit(1); }

const html = fs.readFileSync(htmlPath, 'utf8');
const jsonPath = htmlPath.replace(/\.html$/, '.json');

// Extract title
const titleMatch = html.match(/<h1>([^<]+)/);
const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : path.basename(htmlPath, '.html');

// Extract subtitle
const subMatch = html.match(/<p class="subtitle"[^>]*>([^<]+)/);
const subtitle = subMatch ? decodeEntities(subMatch[1].trim()) : '';

// Extract sections and blocks
const sections = [];
let currentSection = null;
for (const line of html.split('\n')) {
  const secMatch = line.match(/class="section-label"[^>]*>([^<]+)/);
  if (secMatch) {
    currentSection = { name: decodeEntities(secMatch[1].trim()), blocks: [] };
    sections.push(currentSection);
  }
  const blockMatch = line.match(/class="block (\S+)" data-block-id="([^"]+)"/);
  if (blockMatch && currentSection) {
    currentSection.blocks.push({ status: blockMatch[1], id: blockMatch[2] });
  }
}

// Extract full block content by splitting HTML at block boundaries
const blockRegex = /(<div class="block [^"]*" data-block-id="([^"]+)">)([\s\S]*?)(?=<div class="(?:block |section-label|arrow|parallel|summary|gap)|<\/div>\s*<\/div>\s*$)/g;
let m;
const blockContent = {};
while ((m = blockRegex.exec(html)) !== null) {
  blockContent[m[2]] = m[3];
}

// Fallback: simpler extraction per block
if (Object.keys(blockContent).length === 0) {
  const simpleRegex = /data-block-id="([^"]+)">([\s\S]*?)(?=<div class="(?:block|section-label|arrow)|$)/g;
  while ((m = simpleRegex.exec(html)) !== null) {
    blockContent[m[1]] = m[2];
  }
}

const names = {};
const notes = {};
const updates = {};

for (const [id, content] of Object.entries(blockContent)) {
  // Name from h3 (strip status span)
  const h3Match = content.match(/<h3>([\s\S]*?)<\/h3>/);
  if (h3Match) {
    names[id] = decodeEntities(h3Match[1].replace(/<span[^>]*>.*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  }

  // All paragraphs as notes
  const notesList = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRegex.exec(content)) !== null) {
    const text = pm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 5) notesList.push(decodeEntities(text));
  }

  // Tickets div
  const ticketMatch = content.match(/<div class="tickets">([\s\S]*?)<\/div>/);
  if (ticketMatch) {
    const ticketText = ticketMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (ticketText.length > 3) notesList.push('Tickets: ' + decodeEntities(ticketText));
  }

  notes[id] = notesList;

  // Timestamp
  const updMatch = content.match(/data-updated="([^"]+)"/);
  if (updMatch) updates[id] = updMatch[1];

  // Also check for block-updated span
  const updSpanMatch = content.match(/<span class="block-updated"[^>]*data-updated="([^"]+)"/);
  if (updSpanMatch && !updates[id]) updates[id] = updSpanMatch[1];
}

// Build universal format
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

const universalSections = sections.map(sec => ({
  id: 'sec-' + slugify(sec.name),
  title: sec.name,
  convergenceType: 'component-status',
  data: sec.blocks.map(b => ({
    id: b.id,
    name: names[b.id] || b.id,
    status: b.status,
    updated: updates[b.id] || null,
    notes: notes[b.id] || [],
  })),
}));

const allBlocks = universalSections.flatMap(s => s.data);
const built = allBlocks.filter(b => b.status === 'built').length;
const partial = allBlocks.filter(b => b.status === 'partial').length;
const notBuilt = allBlocks.filter(b => b.status === 'not-built').length;
const gap = allBlocks.filter(b => b.status === 'gap').length;
const blocked = allBlocks.filter(b => b.status === 'blocked').length;

const domain = path.basename(htmlPath, '-overview.html');
const brand = domain.slice(0, 2).toUpperCase();

const doc = {
  title,
  subtitle,
  brand,
  updated: new Date().toISOString(),
  objective: `Track the build state of the ${domain} system`,
  successCondition: 'All components built and integrated',
  pills: [`Updated ${new Date().toISOString().slice(0, 10)}`, `${allBlocks.length} components`],
  callouts: [],
  sections: [
    {
      id: 'sec-snapshot',
      title: 'Status Snapshot',
      convergenceType: 'component-status',
      stats: [
        { label: 'Total', value: allBlocks.length },
        { label: 'Built', value: built },
        { label: 'Partial', value: partial },
        ...(notBuilt > 0 ? [{ label: 'Not Built', value: notBuilt }] : []),
        ...(gap > 0 ? [{ label: 'Gap', value: gap }] : []),
        ...(blocked > 0 ? [{ label: 'Blocked', value: blocked }] : []),
      ],
      data: [],
    },
    ...universalSections,
  ],
};

fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
console.log(`${path.basename(jsonPath)}: ${allBlocks.length} blocks, ${universalSections.length} sections`);

if (doRender) {
  const { execSync } = await import('node:child_process');
  const rendererPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'render-living-doc.mjs');
  execSync(`node "${rendererPath}" "${jsonPath}"`, { stdio: 'inherit' });
}

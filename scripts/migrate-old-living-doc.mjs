#!/usr/bin/env node
/**
 * Migrates an old-format living doc HTML (block-based) to universal JSON format.
 * Usage: node migrate-old-living-doc.mjs <path-to-old.html> [--render]
 * Writes a .json file alongside the HTML. If --render is passed, also renders the new HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const registry = JSON.parse(fs.readFileSync(path.join(scriptDir, 'living-doc-registry.json'), 'utf8'));
const statusValueSets = Object.fromEntries(
  Object.entries(registry.statusSets ?? {}).map(([key, definition]) => [key, new Set(definition.values ?? [])])
);

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&rarr;/g, '\u2192')
    .replace(/&larr;/g, '\u2190')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function htmlToText(fragment) {
  return decodeEntities(
    String(fragment ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeEntities(code).replace(/\s+/g, ' ').trim()}\``)
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function findMatchingDivEnd(html, startIndex) {
  const tokenRegex = /<div\b[^>]*>|<\/div>/gi;
  tokenRegex.lastIndex = startIndex;
  let depth = 0;
  let sawOpen = false;
  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    if (!sawOpen) {
      sawOpen = true;
      depth = 1;
      continue;
    }
    if (match[0].startsWith('<div')) depth += 1;
    else depth -= 1;
    if (depth === 0) return tokenRegex.lastIndex;
  }
  return html.length;
}

function extractDivBlocks(html, startPattern) {
  const blocks = [];
  startPattern.lastIndex = 0;
  let match;
  while ((match = startPattern.exec(html)) !== null) {
    const start = match.index;
    const end = findMatchingDivEnd(html, start);
    blocks.push({
      index: start,
      outerHtml: html.slice(start, end),
      match,
    });
    startPattern.lastIndex = end;
  }
  return blocks;
}

function getOuterInnerHtml(outerHtml) {
  const openEnd = outerHtml.indexOf('>');
  return openEnd >= 0 ? outerHtml.slice(openEnd + 1, outerHtml.lastIndexOf('</div>')) : outerHtml;
}

function isTicketLink(issueUrl, text) {
  return /github\.com/i.test(issueUrl)
    && (/\/issues\/\d+/i.test(issueUrl) || /\/pull\/\d+/i.test(issueUrl) || /\/actions\/runs\/\d+/i.test(issueUrl) || /#\d+/.test(text));
}

function extractRefs(fragment) {
  const tickets = [];
  const seen = new Set();
  const ticketAnchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = ticketAnchorRegex.exec(fragment)) !== null) {
    const issueUrl = decodeEntities(match[1].trim());
    const text = htmlToText(match[2]);
    if (!isTicketLink(issueUrl, text)) continue;
    const issueNumber = text.startsWith('#') ? text : `#${text.replace(/^#*/, '')}`;
    const key = `${issueUrl}|${issueNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tickets.push({ issueNumber, issueUrl });
  }
  const remainderHtml = fragment.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (full, href, inner) => (
    isTicketLink(decodeEntities(href.trim()), htmlToText(inner)) ? ' ' : full
  ));
  return { tickets, remainderHtml };
}

function normalizeReferenceText(text) {
  const lines = String(text ?? '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const cleaned = [];
  for (const line of lines) {
    if (/^[A-Z][A-Za-z0-9 /&()+._-]*:\s*$/.test(line)) continue;
    if (!cleaned.includes(line)) cleaned.push(line);
  }
  return cleaned.join('\n').trim();
}

function detectStatusSet(data) {
  const statuses = [...new Set((data ?? []).map((item) => item.status).filter(Boolean))];
  if (statuses.length === 0) return null;
  for (const [statusSet, values] of Object.entries(statusValueSets)) {
    if (statuses.every((status) => values.has(status))) return statusSet;
  }
  return null;
}

function inferConvergenceType({ title, data, columns }) {
  const titleText = String(title ?? '').toLowerCase();
  if (/\bproof ladder\b/.test(titleText)) return 'proof-ladder';

  switch (detectStatusSet(data)) {
    case 'page-status':
      return columns === 2 ? 'investigation-findings' : 'decision-record';
    case 'probe-status':
      return columns === 1 ? 'verification-checkpoints' : 'verification-surface';
    case 'model-integrity':
      return columns === 1 ? 'model-assertion' : 'formal-model';
    case 'content-lifecycle':
      return columns === 1 ? 'content-outline' : 'content-production';
    case 'block-status':
      if (columns === 1) return 'operating-surface';
      if (columns === 3) return 'enabler-catalog';
      return 'capability-surface';
    default:
      return 'capability-surface';
  }
}

function extractTable(calloutHtml) {
  const tableMatch = calloutHtml.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const tableHtml = tableMatch[0];
  const headerMatches = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => htmlToText(match[1]));
  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlToText(cell[1])))
    .filter((row) => row.length > 0);
  return headerMatches.length > 0 || rowMatches.length > 0
    ? { columnHeaders: headerMatches, rows: rowMatches }
    : null;
}

function parseCallout(outerHtml, tone) {
  const titleMatch = outerHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || outerHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  const items = [...outerHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => htmlToText(match[1]));
  const paragraphs = [...outerHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => htmlToText(match[1]));
  const table = extractTable(outerHtml);
  const contentItems = items.length > 0 ? items : paragraphs;
  if (contentItems.length === 0 && !table) return null;
  return {
    tone,
    title: titleMatch ? htmlToText(titleMatch[1]) : '',
    items: contentItems,
    ...(table ?? {}),
  };
}

function parseBlock(outerHtml, status, explicitId = null) {
  const h3Match = outerHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  const name = h3Match
    ? htmlToText(h3Match[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, ' '))
    : explicitId ?? 'untitled-block';
  const id = explicitId ?? slugify(name);
  const updated = normalizeTimestamp(
    outerHtml.match(/<span class="block-updated"[^>]*data-updated="([^"]+)"/i)?.[1]
      ?? outerHtml.match(/\bdata-updated="([^"]+)"/i)?.[1]
      ?? outerHtml.match(/<span class="block-updated"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
      ?? null
  );

  const notes = [];
  const descMatches = [...outerHtml.matchAll(/<p\b[^>]*class="desc"[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const match of descMatches) {
    const text = htmlToText(match[1]);
    if (text) notes.push(text);
  }

  const progressMatches = [...outerHtml.matchAll(/<div\b[^>]*class="progress"([^>]*)>([\s\S]*?)<\/div>/gi)];
  for (const match of progressMatches) {
    const text = htmlToText(match[2]);
    if (!text) continue;
    const tone = match[1].match(/data-tone="([^"]+)"/i)?.[1] ?? 'neutral';
    notes.push({ role: 'callout', tone, text });
  }

  const refMatches = [...outerHtml.matchAll(/<div\b[^>]*class="(?:refs|tickets)"[^>]*>([\s\S]*?)<\/div>/gi)];
  const ticketIds = [];
  const ticketSeen = new Set();
  for (const match of refMatches) {
    const fragment = match[1];
    const { tickets, remainderHtml } = extractRefs(fragment);
    for (const ticket of tickets) {
      const key = `${ticket.issueUrl}|${ticket.issueNumber}`;
      if (ticketSeen.has(key)) continue;
      ticketSeen.add(key);
      ticketIds.push(ticket);
    }
    const remainder = htmlToText(
      remainderHtml
        .replace(/&bull;|•/g, ' ')
    );
    const normalizedReference = normalizeReferenceText(remainder);
    if (normalizedReference) notes.push({ role: 'reference', tone: 'info', text: normalizedReference });
  }

  return {
    id,
    name,
    status,
    ...(updated ? { updated } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(ticketIds.length > 0 ? { ticketIds } : {}),
  };
}

function inferColumns(sectionHtml) {
  if (/class="(?:triple|three-column)"/i.test(sectionHtml)) return 3;
  if (/class="(?:parallel|double|two-column)"/i.test(sectionHtml)) return 2;
  return 1;
}

function convertOldHtmlToUniversal(html, htmlPath) {
  const title = decodeEntities(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ? htmlToText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)[1]) : path.basename(htmlPath, '.html'));
  const subtitle = html.match(/<p class="subtitle"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ? htmlToText(html.match(/<p class="subtitle"[^>]*>([\s\S]*?)<\/p>/i)[1]) : '';

  const sectionLabelRegex = /<div class="section-label"[^>]*>([\s\S]*?)<\/div>/gi;
  const sectionMatches = [...html.matchAll(sectionLabelRegex)];
  const summaryBlocks = extractDivBlocks(html, /<div class="summary"[^>]*>/gi);
  const gapBlocks = extractDivBlocks(html, /<div class="gaps"[^>]*>/gi);
  const sectionBoundaryIndexes = [...summaryBlocks, ...gapBlocks].map((block) => block.index).sort((a, b) => a - b);

  const sections = sectionMatches.map((match, index) => {
    const start = match.index;
    const nextSectionIndex = sectionMatches[index + 1]?.index ?? html.length;
    const nextBoundary = sectionBoundaryIndexes.find((boundary) => boundary > start && boundary < nextSectionIndex) ?? nextSectionIndex;
    const sectionHtml = html.slice(start, nextBoundary);
    const titleText = htmlToText(match[1]);
    const blockMatches = [...sectionHtml.matchAll(/<div class="block ([^"]+)"([^>]*)>/gi)];
    const data = blockMatches.map((blockMatch) => {
      const outerHtml = sectionHtml.slice(blockMatch.index, findMatchingDivEnd(sectionHtml, blockMatch.index));
      const status = blockMatch[1].split(/\s+/)[0];
      const id = blockMatch[2].match(/data-block-id="([^"]+)"/i)?.[1] ?? null;
      return parseBlock(outerHtml, status, id);
    });
    const columns = inferColumns(sectionHtml);
    return {
      id: `sec-${slugify(titleText)}`,
      title: titleText,
      convergenceType: inferConvergenceType({ title: titleText, data, columns }),
      data,
    };
  });

  const allBlocks = sections.flatMap((section) => section.data);
  const statusCounts = new Map();
  for (const item of allBlocks) statusCounts.set(item.status, (statusCounts.get(item.status) ?? 0) + 1);

  const callouts = [
    ...summaryBlocks.map((block) => parseCallout(block.outerHtml, 'info')).filter(Boolean),
    ...gapBlocks.map((block) => parseCallout(block.outerHtml, 'negative')).filter(Boolean),
  ];

  const domain = path.basename(htmlPath, '-overview.html').replace(/^old-/, '');
  const brand = domain.slice(0, 2).toUpperCase();

  return {
    title,
    subtitle,
    brand,
    updated: new Date().toISOString(),
    objective: `Track the build state of the ${domain} system`,
    successCondition: 'All components built and integrated',
    pills: [`Updated ${new Date().toISOString().slice(0, 10)}`, `${allBlocks.length} components`],
    ...(callouts.length > 0 ? { callouts } : { callouts: [] }),
    sections: [
      {
        id: 'sec-snapshot',
        title: 'Status Snapshot',
        convergenceType: 'status-snapshot',
        stats: [
          { label: 'Total', value: allBlocks.length },
          ...Array.from(statusCounts.entries()).map(([status, value]) => ({
            label: status.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
            value,
          })),
        ],
        data: [],
      },
      ...sections,
    ],
  };
}

const htmlPath = process.argv[2];
const doRender = process.argv.includes('--render');

if (!htmlPath) {
  console.error('Usage: migrate-old-living-doc.mjs <path-to-old.html> [--render]');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const jsonPath = htmlPath.replace(/\.html$/, '.json');
const doc = convertOldHtmlToUniversal(html, htmlPath);
const allBlocks = doc.sections.flatMap((section) => section.data ?? []);

fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
console.log(`${path.basename(jsonPath)}: ${allBlocks.length} blocks, ${doc.sections.length - 1} sections`);

if (doRender) {
  const rendererPath = path.join(scriptDir, 'render-living-doc.mjs');
  execSync(`node "${rendererPath}" "${jsonPath}"`, { stdio: 'inherit' });
}

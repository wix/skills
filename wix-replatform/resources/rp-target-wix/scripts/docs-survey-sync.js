#!/usr/bin/env node
'use strict';

// Spec 0020: fetch a domain's dev.wix.com docs menu(s) and sync
// domains/<domain>/docs-survey.json. The script owns the surface list (id,
// title, url, group); verdict fields are authored by hand and preserved
// across syncs. New surfaces arrive as "unreviewed", which fails validation
// until triaged; surfaces gone from the docs are marked "removed", which
// also fails validation until the entry is deleted or its facts revisited.
//
// Usage: node docs-survey-sync.js <domain> [<domain>...]
// Requires domains/<domain>/domain.json to declare docsRoots[] (paths under
// https://dev.wix.com/docs/, e.g. "api-reference/business-solutions/events").

const path = require('node:path');
const fs = require('node:fs');
const { knowledgeRoot, writeJson } = require('../lib/domain-knowledge.js');

const DOCS_BASE = 'https://dev.wix.com/docs/';
const HEADING_RE = /^(#{1,6}) \[([^\]]+)\]\((https:\/\/dev\.wix\.com\/docs\/[^)]+?)(?:\.md)?\)\s*$/;

async function fetchMenuMarkdown(root) {
  const url = `${DOCS_BASE}${root}.md`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return response.text();
}

// A menu page lists its whole ancestry too (# Api Reference, ## Business
// Solutions, ...). Only headings strictly below the fetched root are the
// domain's own; among those, the surfaces are the deepest headings — the
// ones with no child headings.
function extractSurfaces(markdown, root) {
  const headings = [];
  let rootTitle = null;
  for (const line of markdown.split('\n')) {
    const match = line.match(HEADING_RE);
    if (!match) continue;
    const docsPath = match[3].slice(DOCS_BASE.length);
    if (docsPath === root) rootTitle = match[2];
    if (!docsPath.startsWith(`${root}/`)) continue;
    headings.push({ level: match[1].length, title: match[2], docsPath });
  }

  // A flat tree (all methods as bullets, no sub-headings) is still one
  // surface — the root itself. Never let a root vanish silently.
  if (headings.length === 0) {
    return [
      {
        id: root,
        title: rootTitle || root.split('/').pop(),
        url: `${DOCS_BASE}${root}`,
        group: null,
      },
    ];
  }

  const surfaces = [];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const next = headings[i + 1];
    const hasChildren = next && next.level > heading.level;
    if (hasChildren) continue;
    const group = [];
    for (let j = i - 1, level = heading.level; j >= 0; j -= 1) {
      if (headings[j].level < level) {
        group.unshift(headings[j].title);
        level = headings[j].level;
      }
    }
    surfaces.push({
      id: heading.docsPath,
      title: heading.title,
      url: `${DOCS_BASE}${heading.docsPath}`,
      group: group.join(' › ') || null,
    });
  }
  return surfaces;
}

function mergeSurvey(existing, domain, roots, fetched) {
  const previous = new Map(((existing && existing.surfaces) || []).map((entry) => [entry.id, entry]));
  const surfaces = fetched.map((surface) => {
    const kept = previous.get(surface.id);
    previous.delete(surface.id);
    const verdictFields = kept
      ? {
          verdict: kept.verdict,
          refs: kept.refs,
          reason: kept.reason,
          tracking: kept.tracking,
          reviewedOn: kept.reviewedOn,
        }
      : { verdict: 'unreviewed' };
    for (const key of Object.keys(verdictFields)) {
      if (verdictFields[key] === undefined) delete verdictFields[key];
    }
    return { ...surface, ...verdictFields };
  });
  for (const gone of previous.values()) {
    surfaces.push({ ...gone, removed: true });
  }
  surfaces.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    domain,
    fetchedAt: new Date().toISOString().slice(0, 10),
    roots,
    surfaces,
  };
}

async function syncDomain(domainsDir, domain) {
  const domainJsonPath = path.join(domainsDir, domain, 'domain.json');
  const domainJson = JSON.parse(fs.readFileSync(domainJsonPath, 'utf8'));
  const roots = domainJson.docsRoots;
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error(`${domain}/domain.json has no docsRoots[]; declare the domain's docs menu roots first`);
  }
  const fetchedByRoot = await Promise.all(
    roots.map((root) => fetchMenuMarkdown(root).then((md) => extractSurfaces(md, root))),
  );
  const fetched = fetchedByRoot.flat();

  const surveyPath = path.join(domainsDir, domain, 'docs-survey.json');
  const existing = fs.existsSync(surveyPath) ? JSON.parse(fs.readFileSync(surveyPath, 'utf8')) : null;
  const survey = mergeSurvey(existing, domain, roots, fetched);
  writeJson(surveyPath, survey);

  const unreviewed = survey.surfaces.filter((s) => s.verdict === 'unreviewed').length;
  const removed = survey.surfaces.filter((s) => s.removed).length;
  process.stdout.write(
    `${domain}: ${survey.surfaces.length} surfaces (${unreviewed} unreviewed, ${removed} removed) -> ${path.relative(process.cwd(), surveyPath)}\n`
  );
}

async function main() {
  const domains = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (domains.length === 0) {
    process.stderr.write('Usage: docs-survey-sync.js <domain> [<domain>...]\n');
    process.exit(2);
  }
  const domainsDir = knowledgeRoot(path.resolve(__dirname, '..'));
  for (const domain of domains) await syncDomain(domainsDir, domain);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});

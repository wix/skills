#!/usr/bin/env node
/**
 * Step 4c's UX Completeness Self-Audit, as a check instead of a promise.
 *
 * The prose version passes by assertion: a run ticks "every filter reaches the
 * query" from memory while the code says otherwise. A measured page shipped with
 * the search term threaded through three call sites and never read by the filter
 * builder — every prose box ticked, search returned every row.
 *
 * Usage:  node scripts/audit-dashboard-page.cjs <page-dir> [<page-dir>...]
 *         node scripts/audit-dashboard-page.cjs src/extensions/dashboard/pages/*
 *
 * Exits non-zero if any ERROR-level finding fires.
 */
const fs = require('fs');
const path = require('path');

const FILTER_OPS = /\$in|\$eq|\$ne|\$gte|\$lte|\$gt|\$lt|\$or|\$and|\$startsWith|\$contains|\$hasSome|\.filter\(|clauses\.push/;

function readSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push({ file: full, text: fs.readFileSync(full, 'utf8') });
  }
  return out;
}

/** Bodies of functions that look like they build a query filter, signature excluded. */
function filterBuilderBodies(sources) {
  const bodies = [];
  for (const { file, text } of sources) {
    const re = /(?:function\s+\w+\s*\([\s\S]*?\)\s*(?::[^{]*)?\{|(?:const|let)\s+\w+\s*(?::[^=]*)?=\s*(?:async\s*)?\([\s\S]*?\)\s*(?::[^=]*)?=>\s*\{)/g;
    let m;
    while ((m = re.exec(text))) {
      let depth = 1, i = m.index + m[0].length;
      const start = i;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      const body = text.slice(start, i - 1);
      if (FILTER_OPS.test(body)) bodies.push({ file, body });
    }
  }
  return bodies;
}

function audit(dir) {
  const sources = readSources(dir);
  if (!sources.length) return [{ level: 'ERROR', msg: `no .ts/.tsx files under ${dir}` }];
  const all = sources.map((s) => s.text).join('\n');
  const findings = [];
  const bodies = filterBuilderBodies(sources);
  const inAnyBuilder = (needle) => bodies.some((b) => new RegExp(`\\b${needle}\\b`).test(b.body));

  // --- the drill-in and the error state are not judgment calls
  if (!/<SidePanel|navigateToEntityPage|<EntityPage/.test(all))
    findings.push({ level: 'ERROR', msg: 'no row drill-in: expected SidePanel, EntityPage, or navigateToEntityPage' });
  if (!/errorState=/.test(all))
    findings.push({ level: 'ERROR', msg: 'Table has no errorState — a failed query renders identically to a slow one' });

  // --- every declared filter must reach the FILTER, not merely fetchData
  const decl = all.match(/filters:\s*\{([^}]*)\}/);
  if (decl) {
    for (const key of [...decl[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1])) {
      if (!inAnyBuilder(key))
        findings.push({ level: 'ERROR', msg: `filter "${key}" is declared but never read inside a filter builder — the UI renders and narrows nothing` });
    }
  }

  // --- the search box is ON by default; threading it is not wiring it
  if (/<CollectionSearch|search=\{/.test(all)) {
    if (!/query\.search/.test(all))
      findings.push({ level: 'ERROR', msg: 'search box rendered but query.search is never read' });
    else if (!inAnyBuilder('search'))
      findings.push({ level: 'ERROR', msg: 'query.search is passed around but never read inside a filter builder — search returns every row' });
  }

  // --- totals under cursor paging
  if (/paginationMode:\s*['"]cursor['"]/.test(all)) {
    if (!/fetchTotal/.test(all))
      findings.push({ level: 'WARN', msg: "cursor mode without fetchTotal — collection.total stays at the loaded count, which reads as a total" });
    if (/pagingMetadata[^\n]*\.total/.test(all))
      findings.push({ level: 'ERROR', msg: 'reads pagingMetadata.total under cursor paging — that field is only populated for offset paging, so it is undefined; use the API\'s count method' });
  }

  // --- a headline built from loaded rows is a different number than the prompt implies
  if (/<SummaryBar/.test(all) && !/collection\.total/.test(all))
    findings.push({ level: 'WARN', msg: 'SummaryBar present but no metric reads collection.total — label metrics derived from keyedItems as "loaded", or use the total' });

  // --- casting the SDK response away disables every field check
  if (/as\s+Record<string,\s*unknown>/.test(all))
    findings.push({ level: 'WARN', msg: 'SDK response cast to Record<string, unknown> — import the entity type the package exports so field names are checked' });

  return findings;
}

const dirs = process.argv.slice(2).filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
if (!dirs.length) { console.error('usage: audit-dashboard-page.cjs <page-dir> [...]'); process.exit(2); }

let errors = 0;
for (const dir of dirs) {
  const findings = audit(dir);
  const errs = findings.filter((f) => f.level === 'ERROR');
  errors += errs.length;
  console.log(`\n${errs.length ? '✗' : '✓'} ${dir}`);
  if (!findings.length) console.log('   all checks pass');
  for (const f of findings) console.log(`   ${f.level === 'ERROR' ? '✗' : '⚠'} ${f.level}: ${f.msg}`);
}
console.log(`\n${errors} error-level finding(s).`);
process.exit(errors ? 1 : 0);

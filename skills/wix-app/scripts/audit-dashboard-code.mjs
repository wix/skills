#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: node audit-dashboard-code.mjs <generated-file-or-directory> [...]');
  process.exit(2);
}

const supportedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

function sourceFiles(inputPath) {
  const absolute = path.resolve(inputPath);
  if (!fs.existsSync(absolute)) throw new Error(`Path does not exist: ${inputPath}`);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return supportedExtensions.has(path.extname(absolute)) ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    sourceFiles(path.join(absolute, entry.name)),
  );
}

function lineAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

const findings = [];

function addFinding(filePath, content, index, rule, message) {
  findings.push({ filePath, line: lineAt(content, Math.max(index, 0)), rule, message });
}

function report(filePath, content, rule, pattern, message) {
  const match = pattern.exec(content);
  if (!match) return;
  findings.push({ filePath, line: lineAt(content, match.index), rule, message });
}

let files;
try {
  files = [...new Set(inputs.flatMap(sourceFiles))];
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const contents = new Map(files.map((filePath) => [filePath, fs.readFileSync(filePath, 'utf8')]));
const projectHasSidePanel = [...contents.values()].some((content) => /<SidePanel\b/.test(content));

for (const filePath of files) {
  const content = contents.get(filePath);
  const hasSidePanel = /<SidePanel\b/.test(content);

  if (hasSidePanel) {
    report(filePath, content, 'TP-09', /(?:100vh|100dvh)/, 'SidePanel code uses browser viewport height inside a Dashboard Page.');
    report(filePath, content, 'TP-09', /<SidePanel\b[^>]*(?:width|height)=\{?['"]?\d+/, 'SidePanel has hard-coded geometry instead of documented defaults/host sizing.');
    report(filePath, content, 'TP-09', /position:\s*['"]relative['"][\s\S]{0,180}overflow:\s*['"]hidden['"][\s\S]{0,500}<SidePanel/, 'SidePanel is mounted under a relative overflow-hidden page wrapper.');

    for (const match of content.matchAll(/<SidePanel\.Header\b([^>]*)>([\s\S]*?)<\/SidePanel\.Header>/g)) {
      if (!/\btitle=/.test(match[1]) && /<(?:Box|div|Text)\b/.test(match[2])) {
        addFinding(
          filePath,
          content,
          match.index,
          'TP-10',
          'Standard record Header omits the documented title API and rebuilds identity with custom children.',
        );
      }
    }

    if (/<Button\b/.test(content) && !/<SidePanel\.Footer\b/.test(content)) {
      findings.push({
        filePath,
        line: lineAt(content, content.indexOf('<SidePanel')),
        rule: 'TP-10',
        message: 'SidePanel contains actions but has no SidePanel.Footer.',
      });
    }
  }

  report(filePath, content, 'CT-02', /titleBarVisible=\{false\}/, 'Management table explicitly hides its labeled header row.');
  report(
    filePath,
    content,
    'CT-06',
    /<TableToolbar\.Label[^>]*>[\s\S]{0,180}\{[^}]+\}[^{<\n]+\{[^}]+\}[\s\S]{0,60}<\/TableToolbar\.Label>/,
    'Toolbar count is composed from separately spaced JSX fragments; precompute one string.',
  );

  if (/<Table\b/.test(content)) {
    const percentageWidths = [...content.matchAll(/\bwidth:\s*['"](\d+(?:\.\d+)?)%['"]/g)];
    const totalWidth = percentageWidths.reduce((sum, match) => sum + Number(match[1]), 0);
    if (percentageWidths.length > 1 && totalWidth > 100.5) {
      addFinding(
        filePath,
        content,
        percentageWidths[0].index,
        'CT-03',
        `Table percentage column widths total ${totalWidth}%; reserve a non-overlapping final action column within 100%.`,
      );
    }

    if (/<EmptyState\b/.test(content) && !/<Button\b/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('<EmptyState'),
        'CT-09',
        'Table EmptyState has no visible recovery action such as create, clear filters, retry, or request access.',
      );
    }
  }

  const statisticsCount = (content.match(/<StatisticsWidget\b/g) || []).length;
  const cardCount = (content.match(/<Card\b/g) || []).length;
  if (statisticsCount > 1 && cardCount > 1 && !/<Layout\b/.test(content)) {
    addFinding(
      filePath,
      content,
      content.indexOf('<StatisticsWidget'),
      'AN-03',
      'Multiple analytics cards are not composed with the documented WDS Layout/Cell grid.',
    );
  }
}

if (projectHasSidePanel) {
  for (const [filePath, content] of contents) {
    const mountsPanel = /<(?:SidePanel|[A-Z][A-Za-z0-9]*SidePanel)\b/.test(content);
    if (!mountsPanel) continue;

    const relativeIndex = content.search(/position:\s*['"]relative['"]/);
    const overflowIndex = content.search(/overflow:\s*['"]hidden['"]/);
    const fullHeightIndex = content.search(/height:\s*['"]100%['"]/);
    if (relativeIndex >= 0 && overflowIndex >= 0 && fullHeightIndex >= 0) {
      addFinding(
        filePath,
        content,
        Math.min(relativeIndex, overflowIndex, fullHeightIndex),
        'TP-09',
        'Panel mount uses a relative, overflow-hidden, 100%-height page wrapper; this ties panel bounds to page content.',
      );
    }

    const absoluteIndex = content.search(/position:\s*['"]absolute['"]/);
    if (absoluteIndex >= 0 && fullHeightIndex >= 0) {
      addFinding(
        filePath,
        content,
        Math.min(absoluteIndex, fullHeightIndex),
        'TP-09',
        'Panel mount uses absolute positioning with height 100%; use the documented stable dashboard host instead.',
      );
    }

    report(
      filePath,
      content,
      'TP-09',
      /(?:100vh|100dvh)/,
      'Panel mount uses browser viewport height inside an embedded Dashboard Page.',
    );
  }
}

if (findings.length) {
  console.error('Dashboard code audit failed:');
  for (const finding of findings) {
    console.error(`- ${finding.rule} ${finding.filePath}:${finding.line} ${finding.message}`);
  }
  process.exit(1);
}

console.log(`Dashboard code audit passed: ${files.length} source file(s) checked.`);

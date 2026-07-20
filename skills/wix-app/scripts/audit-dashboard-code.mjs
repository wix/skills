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

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8');
  const hasSidePanel = /<SidePanel\b/.test(content);

  if (hasSidePanel) {
    report(filePath, content, 'TP-09', /(?:100vh|100dvh)/, 'SidePanel code uses browser viewport height inside a Dashboard Page.');
    report(filePath, content, 'TP-09', /<SidePanel\b[^>]*(?:width|height)=\{?['"]?\d+/, 'SidePanel has hard-coded geometry instead of documented defaults/host sizing.');
    report(filePath, content, 'TP-09', /position:\s*['"]relative['"][\s\S]{0,180}overflow:\s*['"]hidden['"][\s\S]{0,500}<SidePanel/, 'SidePanel is mounted under a relative overflow-hidden page wrapper.');
    report(filePath, content, 'TP-10', /<SidePanel\.Header[^>]*>[\s\S]{0,220}<(?:Box|div)\b/, 'SidePanel Header is rebuilt with custom layout children.');

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
}

if (findings.length) {
  console.error('Dashboard code audit failed:');
  for (const finding of findings) {
    console.error(`- ${finding.rule} ${finding.filePath}:${finding.line} ${finding.message}`);
  }
  process.exit(1);
}

console.log(`Dashboard code audit passed: ${files.length} source file(s) checked.`);

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

function componentNames(filePath, content) {
  const names = new Set();
  const baseName = path.basename(filePath, path.extname(filePath));
  if (/^[A-Z][A-Za-z0-9]*$/.test(baseName)) names.add(baseName);

  for (const match of content.matchAll(
    /(?:export\s+default\s+)?(?:function|class|const)\s+([A-Z][A-Za-z0-9]*)\b/g,
  )) {
    names.add(match[1]);
  }
  for (const match of content.matchAll(/export\s+default\s+([A-Z][A-Za-z0-9]*)\s*;?/g)) {
    names.add(match[1]);
  }
  return names;
}

const declaredComponents = new Map(
  [...contents].map(([filePath, content]) => [filePath, componentNames(filePath, content)]),
);
const sidePanelComponents = new Set(['SidePanel']);
const sidePanelHostName = 'DashboardSidePanelHost';

// Follow local component wrappers so a page mounting <SessionDetail /> is audited
// even when the actual <SidePanel> lives in a different file.
let discoveredWrapper = true;
while (discoveredWrapper) {
  discoveredWrapper = false;
  for (const [filePath, content] of contents) {
    const mountsKnownPanel = [...sidePanelComponents].some((name) =>
      new RegExp(`<${name}\\b`).test(content),
    );
    if (!mountsKnownPanel) continue;
    for (const name of declaredComponents.get(filePath)) {
      if (!sidePanelComponents.has(name)) {
        sidePanelComponents.add(name);
        discoveredWrapper = true;
      }
    }
  }
}

function mountsSidePanel(content) {
  return [...sidePanelComponents].some((name) => new RegExp(`<${name}\\b`).test(content));
}

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
      if (/\btitle=/.test(match[1]) && /<Badge\b/.test(match[2])) {
        addFinding(
          filePath,
          content,
          match.index,
          'TP-10',
          'Standard record Header mixes the title API with a custom status badge; put status first in SidePanel.Content or follow the exact custom-header example.',
        );
      }
    }

    const contentRegions = (content.match(/<SidePanel\.Content\b/g) || []).length;
    if (contentRegions > 1 && /<SidePanel\.Divider\b/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('<SidePanel.Divider'),
        'TP-11',
        'Routine record details are split into multiple SidePanel.Content regions with thick SidePanel.Divider bands; use one Content region and standard thin WDS Divider only where needed.',
      );
    }

    if (!/<SidePanel\.Footer\b/.test(content)) {
      findings.push({
        filePath,
        line: lineAt(content, content.indexOf('<SidePanel')),
        rule: 'TP-11',
        message: 'Contextual SidePanel has no SidePanel.Footer; include a right-aligned Close button even when the detail is read-only.',
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
    if (/<Table\.EmptyState\b/.test(content) && !/<Table\.Content\b/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('<Table.EmptyState'),
        'CT-11',
        'Table defines empty-state handling but has no Table.Content branch for populated rows.',
      );
    }

    if (/\bonRowClick=/.test(content) && !/<TableActionCell\b/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('onRowClick='),
        'CT-10',
        'Interactive table rows rely on row click without a visible final-column TableActionCell.',
      );
    }

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

    if (/<TableActionCell\b/.test(content) && /\bwidth:\s*['"]0(?:%|px)?['"]/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('<TableActionCell'),
        'CT-05',
        'A labeled TableActionCell is assigned a zero-width column; reserve non-zero space for its visible action label.',
      );
    }

    if (projectHasSidePanel && /\bonRowClick=/.test(content) && !/\bisRowActive=/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('onRowClick='),
        'TP-01',
        'A row opens contextual detail but Table has no isRowActive predicate for the selected record.',
      );
    }

    if (projectHasSidePanel && /\bisRowActive=/.test(content) && !/\bonRowClick=/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('isRowActive='),
        'TP-01',
        'A selected row opens contextual detail but Table has no onRowClick handler matching its final action.',
      );
    }

    if (projectHasSidePanel && /<TableActionCell\b[\s\S]{0,420}visibility:\s*['"]always['"]/.test(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('<TableActionCell'),
        'TP-03',
        'A contextual row action is permanently visible; use documented hover/focus visibility unless the workflow explicitly requires an always-visible control.',
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

  for (const match of content.matchAll(
    /\{([^{}]{0,360}\b[A-Za-z_$][\w$]*\.length\s*===\s*0[^{}]{0,360})&&\s*\(\s*(<EmptyState\b[\s\S]{0,1600}?<\/EmptyState>)\s*\)\s*\}/g,
  )) {
    const [, condition, emptyState] = match;
    const sourceEmpty = !/\.length\s*>\s*0/.test(condition);
    if (!sourceEmpty) continue;
    if (/clear\s+(?:all\s+)?filters/i.test(emptyState) || !/<Button\b/.test(emptyState)) {
      addFinding(
        filePath,
        content,
        match.index,
        'TP-05',
        'Source-empty state must contain its own primary setup/create CTA, not a Clear filters recovery action.',
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

  const usesChartJs = /from\s+['"]react-chartjs-2['"]/.test(content) || /<(?:Bar|Line|Pie|Doughnut|Radar)\b/.test(content);
  if (usesChartJs && /maintainAspectRatio\s*:\s*true/.test(content) && /<Box\b[^>]*\bheight=/.test(content)) {
    addFinding(
      filePath,
      content,
      content.indexOf('maintainAspectRatio'),
      'AN-11',
      'Chart.js uses maintainAspectRatio: true inside a fixed-height dashboard chart region; it can overflow into the next surface.',
    );
  }
}

if (projectHasSidePanel) {
  const projectSource = [...contents.values()].join('\n');
  const hostPattern = new RegExp(
    `(?:function|const)\\s+${sidePanelHostName}\\b[\\s\\S]{0,1800}position:\\s*['"]fixed['"][\\s\\S]{0,360}top:\\s*0[\\s\\S]{0,360}right:\\s*0[\\s\\S]{0,360}bottom:\\s*0[\\s\\S]{0,360}display:\\s*['"]flex['"][\\s\\S]{0,360}alignItems:\\s*['"]stretch['"][\\s\\S]{0,520}>\\s*\\{children\\}\\s*<\\/div>`,
  );
  const hasApprovedHost = hostPattern.test(projectSource);

  for (const [filePath, content] of contents) {
    const mountsPanel = mountsSidePanel(content);
    if (!mountsPanel) continue;

    const mountsWrapper = [...sidePanelComponents]
      .filter((name) => name !== 'SidePanel')
      .some((name) => new RegExp(`<${name}\\b`).test(content));
    if (mountsWrapper && !new RegExp(`<${sidePanelHostName}\\b`).test(content)) {
      addFinding(
        filePath,
        content,
        content.search(/<(?:[A-Z][A-Za-z0-9]*Panel)\\b/),
        'TP-08',
        'Floating SidePanel wrapper is mounted without DashboardSidePanelHost, so it can enter normal page flow instead of the dashboard overlay layer.',
      );
    }

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

    const fixedSiblingIndex = content.search(/(?:width:\s*['"]\d+(?:px)?['"]|flexShrink:\s*0)/);
    if (fixedSiblingIndex >= 0 && /display:\s*['"]flex['"]/.test(content)) {
      addFinding(
        filePath,
        content,
        fixedSiblingIndex,
        'TP-07',
        'Floating SidePanel is mounted as a fixed-width flex sibling/push column instead of the documented dashboard-level overlay.',
      );
    }

    const wrapperShadowIndex = content.search(/boxShadow\s*:/);
    if (wrapperShadowIndex >= 0) {
      addFinding(
        filePath,
        content,
        wrapperShadowIndex,
        'TP-12',
        'A wrapper adds its own SidePanel shadow; let skin="floating" own panel geometry and shadow.',
      );
    }

    const wrapperOverflowIndex = content.search(/overflow:\s*['"](?:auto|hidden)['"]/);
    const wrapperGeometryIndex = content.search(/(?:width:\s*['"]\d+(?:px)?['"]|height:\s*['"]100%['"])/);
    if (wrapperOverflowIndex >= 0 && wrapperGeometryIndex >= 0) {
      addFinding(
        filePath,
        content,
        Math.min(wrapperOverflowIndex, wrapperGeometryIndex),
        'TP-12',
        'A SidePanel wrapper owns overflow and fixed/full geometry, which can clip the floating skin and its shadow.',
      );
    }
  }

  if (!hasApprovedHost) {
    const firstPanelFile = files.find((filePath) => mountsSidePanel(contents.get(filePath)));
    addFinding(
      firstPanelFile,
      contents.get(firstPanelFile),
      contents.get(firstPanelFile).indexOf('<SidePanel'),
      'TP-08',
      'Project uses a floating SidePanel but does not define the required stretching fixed DashboardSidePanelHost with a direct SidePanel child.',
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

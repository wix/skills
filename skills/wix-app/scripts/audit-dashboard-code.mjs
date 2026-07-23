#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: node audit-dashboard-code.mjs <generated-file-or-directory> [...]');
  process.exit(2);
}

const supportedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const routeRecordName = '.dashboard-route.json';

function sourceFiles(inputPath) {
  const absolute = path.resolve(inputPath);
  if (!fs.existsSync(absolute)) throw new Error(`Path does not exist: ${inputPath}`);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return supportedExtensions.has(path.extname(absolute)) ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    sourceFiles(path.join(absolute, entry.name)),
  );
}

function namedFiles(inputPath, fileName) {
  const absolute = path.resolve(inputPath);
  if (!fs.existsSync(absolute)) throw new Error(`Path does not exist: ${inputPath}`);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return path.basename(absolute) === fileName ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    namedFiles(path.join(absolute, entry.name), fileName),
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
let routeRecordPaths;
let patternsPaths;
try {
  files = [...new Set(inputs.flatMap(sourceFiles))];
  routeRecordPaths = [...new Set(inputs.flatMap((input) => namedFiles(input, routeRecordName)))];
  patternsPaths = [...new Set(inputs.flatMap((input) => namedFiles(input, 'patterns.json')))];
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const contents = new Map(files.map((filePath) => [filePath, fs.readFileSync(filePath, 'utf8')]));
const projectSource = [...contents.values()].join('\n');
const projectHasSidePanel = [...contents.values()].some((content) => /<SidePanel\b/.test(content));
const routeRecords = [];
const patternDocuments = [];

function walkJson(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJson(entry, visit));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => walkJson(entry, visit));
  }
}

for (const patternsPath of patternsPaths) {
  try {
    patternDocuments.push({
      path: patternsPath,
      value: JSON.parse(fs.readFileSync(patternsPath, 'utf8')),
    });
  } catch (error) {
    findings.push({
      filePath: patternsPath,
      line: 1,
      rule: 'AP-06',
      message: `patterns.json is not valid JSON: ${error.message}`,
    });
  }
}

const customRowActionIds = new Set();
let hasEntityPagePattern = false;
for (const document of patternDocuments) {
  walkJson(document.value, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (value.type === 'entityPage') hasEntityPagePattern = true;
    if (
      value.onRowClick?.type === 'custom'
      && typeof value.onRowClick.id === 'string'
      && value.onRowClick.id.trim()
    ) {
      customRowActionIds.add(value.onRowClick.id.trim());
    }
  });
}

if (files.length && routeRecordPaths.length !== 1) {
  const firstFile = files[0];
  addFinding(
    firstFile,
    contents.get(firstFile),
    0,
    'RT-01',
    routeRecordPaths.length
      ? `Dashboard source must contain exactly one ${routeRecordName}; found ${routeRecordPaths.length}.`
      : `Dashboard source is missing the required ${routeRecordName}.`,
  );
}

for (const recordPath of routeRecordPaths) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    routeRecords.push({ path: recordPath, record });
  } catch (error) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'RT-01',
      message: `Route record is not valid JSON: ${error.message}`,
    });
    continue;
  }

  const routes = new Set([
    'auto-patterns',
    'auto-patterns-change',
    'custom-table',
    'custom-table-panel',
    'analytics',
    'modal',
  ]);
  if (!routes.has(record.route)) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'RT-01',
      message: `Route record has unsupported route "${record.route ?? ''}".`,
    });
  }

  if (!Number.isInteger(record.sourceCount) || record.sourceCount < 0) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'RT-02',
      message: 'sourceCount must be a non-negative integer counting physical collections or systems.',
    });
  }
  if (!Array.isArray(record.sources) || record.sources.length !== record.sourceCount) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'RT-02',
      message: 'sources must list each physical source exactly once and match sourceCount.',
    });
  }

  const isAutoPatterns = ['auto-patterns', 'auto-patterns-change'].includes(record.route);
  if (isAutoPatterns) {
    if (!patternsPaths.length || !/@wix\/auto-patterns/.test(projectSource)) {
      findings.push({
        filePath: recordPath,
        line: 1,
        rule: 'RT-03',
        message: 'Auto Patterns route must produce patterns.json and source that uses @wix/auto-patterns.',
      });
    }
  }

  const isCustomCollectionSurface = ['custom-table', 'custom-table-panel'].includes(record.route);
  if (isCustomCollectionSurface && record.sourceCount === 1) {
    const requiredEvidence = [
      'firstUnsupportedCapability',
      'checkedReference',
      'whyDataAdaptationCannotSolve',
    ];
    const missingEvidence = requiredEvidence.filter(
      (key) => typeof record[key] !== 'string' || !record[key].trim(),
    );
    if (record.fallbackCategory !== 'unsupported-presentation' || missingEvidence.length) {
      findings.push({
        filePath: recordPath,
        line: 1,
        rule: 'RT-04',
        message: `One-source custom table requires fallbackCategory "unsupported-presentation" and evidence fields: ${requiredEvidence.join(', ')}.`,
      });
    }

    const fallbackText = [
      record.firstUnsupportedCapability,
      record.whyDataAdaptationCannotSolve,
    ].filter(Boolean).join(' ');
    if (/\b(?:filter(?:ing)?|predicate|or logic|date comparison|derived (?:field|state|status)|elapsed time)\b/i.test(fallbackText)) {
      findings.push({
        filePath: recordPath,
        line: 1,
        rule: 'RT-05',
        message: 'Query/filter complexity is data shaping, not an unsupported presentation capability; keep the one-collection surface in Auto Patterns.',
      });
    }
  }

  if (record.fallbackCategory === 'multi-source' && record.sourceCount < 2) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'RT-02',
      message: 'multi-source requires at least two physical collections or systems.',
    });
  }

  if (record.route === 'analytics' && record.sourceCount === 1) {
    const collectionOwner = record.regionOwners?.collection;
    const usesAutoPatternsCollection =
      patternsPaths.length > 0 && /@wix\/auto-patterns/.test(projectSource);
    const usesCustomWdsTable = /<Table\b/.test(projectSource) && !usesAutoPatternsCollection;

    if (collectionOwner === 'auto-patterns' && !usesAutoPatternsCollection) {
      findings.push({
        filePath: recordPath,
        line: 1,
        rule: 'RT-06',
        message: 'regionOwners assigns the collection region to Auto Patterns, but patterns.json or @wix/auto-patterns source is missing.',
      });
    }

    if (usesCustomWdsTable) {
      const requiredTableEvidence = [
        'tableUnsupportedCapability',
        'tableCheckedReference',
        'whyAutoPatternsTableCannotBeUsed',
      ];
      const missingTableEvidence = requiredTableEvidence.filter(
        (key) => typeof record[key] !== 'string' || !record[key].trim(),
      );
      if (collectionOwner !== 'custom-wds-table' || missingTableEvidence.length) {
        findings.push({
          filePath: recordPath,
          line: 1,
          rule: 'RT-06',
          message: `A one-source analytics page may use a custom WDS table only when regionOwners.collection is "custom-wds-table" and table-specific evidence is recorded: ${requiredTableEvidence.join(', ')}. Chart or metric fallback evidence does not transfer table ownership.`,
        });
      }
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const actionId of customRowActionIds) {
  const escapedId = escapeRegExp(actionId);
  const resolverStart = new RegExp(`(?:const|let|var|function)\\s+${escapedId}\\b`).exec(projectSource);
  if (!resolverStart) {
    findings.push({
      filePath: patternDocuments[0]?.path ?? routeRecordPaths[0],
      line: 1,
      rule: 'AP-07',
      message: `Custom onRowClick "${actionId}" has no matching resolver implementation.`,
    });
    continue;
  }

  const resolverSlice = projectSource.slice(resolverStart.index, resolverStart.index + 2400);
  const noOpHandler =
    /onClick\s*:\s*\(\s*\)\s*=>\s*\{\s*(?:(?:void\s+[^;]+|return\s+undefined)\s*;?\s*)*\}/.test(
      resolverSlice,
    )
    || /onClick\s*:\s*\(\s*\)\s*=>\s*(?:undefined|null)\b/.test(resolverSlice);
  if (noOpHandler) {
    const sourceEntry = [...contents].find(([, content]) =>
      new RegExp(`(?:const|let|var|function)\\s+${escapedId}\\b`).test(content),
    );
    findings.push({
      filePath: sourceEntry?.[0] ?? files[0],
      line: sourceEntry ? lineAt(sourceEntry[1], sourceEntry[1].search(new RegExp(`\\b${escapedId}\\b`))) : 1,
      rule: 'AP-07',
      message: `Custom onRowClick "${actionId}" resolves to a no-op; it must open the declared detail surface or perform its stated action.`,
    });
  }
}

for (const { path: recordPath, record } of routeRecords) {
  const detailIntent = /\b(?:detail|view|inspect|edit|resolve)\b/i.test(String(record.secondary ?? ''));
  if (!detailIntent && record.detailSurface == null) continue;

  const allowedSurfaces = new Set(['side-panel', 'modal', 'entity-page']);
  const surface = record.detailSurface;
  const reason = record.detailSurfaceReason;
  if (!allowedSurfaces.has(surface) || typeof reason !== 'string' || !reason.trim()) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'AP-08',
      message: 'Record detail requires detailSurface (side-panel, modal, or entity-page) and a non-empty detailSurfaceReason.',
    });
    continue;
  }

  const surfaceExists =
    (surface === 'side-panel' && /<SidePanel\b/.test(projectSource))
    || (surface === 'modal' && /(?:<Modal\b|\bopenModal\s*\()/.test(projectSource))
    || (surface === 'entity-page' && hasEntityPagePattern);
  if (!surfaceExists) {
    findings.push({
      filePath: recordPath,
      line: 1,
      rule: 'AP-08',
      message: `Route declares detailSurface "${surface}", but the generated project does not contain that surface.`,
    });
  }
}

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

function selectionCallbackUsesSelectedRows(content) {
  const callbackNames = [
    ...content.matchAll(/\bonSelectionChanged\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g),
  ].map((match) => match[1]);

  return callbackNames.some((name) => {
    const declaration = new RegExp(
      `(?:function\\s+${name}\\s*\\([^)]*\\)|(?:const|let|var)\\s+${name}\\s*=\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>)[\\s\\S]{0,1200}?selectedRows`,
    );
    return declaration.test(content);
  }) || /\bonSelectionChanged\s*=\s*\{\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[\s\S]{0,1200}?selectedRows/.test(content);
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

    for (const match of content.matchAll(
      /<SidePanel\.Footer\b[^>]*>([\s\S]*?)<\/SidePanel\.Footer>/g,
    )) {
      if (/<button\b/.test(match[1])) {
        addFinding(
          filePath,
          content,
          match.index,
          'TP-14',
          'SidePanel.Footer uses a native HTML button; use the documented WDS Button component for Close and other footer actions.',
        );
      }
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
    if (
      /\bonRowClick\s*=\s*\{\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\}/.test(
        content,
      )
    ) {
      addFinding(
        filePath,
        content,
        content.indexOf('onRowClick'),
        'CT-12',
        'Interactive table declares an empty onRowClick handler; open the selected surface or remove the interaction.',
      );
    }

    if (/\bshowSelection(?:=|\b)/.test(content) && /\bonSelectionChanged=/.test(content) && selectionCallbackUsesSelectedRows(content)) {
      addFinding(
        filePath,
        content,
        content.indexOf('onSelectionChanged'),
        'CT-08',
        'Controlled WDS Table selection receives an ID array in onSelectionChanged; do not read selectedRows from that callback.',
      );
    }

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
  const statisticsInCard = /<Card\b[^>]*>[\s\S]{0,2400}?<StatisticsWidget\b[\s\S]{0,2400}?<\/Card>/.exec(content);
  if (statisticsInCard) {
    addFinding(
      filePath,
      content,
      statisticsInCard.index,
      'AN-13',
      'StatisticsWidget already owns its contained metric surface; remove the redundant Card wrapper unless the installed WDS example explicitly requires it.',
    );
  }

  if (
    statisticsCount > 1
    && /<(?:Box|Flex)\b/.test(content)
    && !(/<Layout\b/.test(content) && /<Cell\b/.test(content))
  ) {
    addFinding(
      filePath,
      content,
      content.indexOf('<StatisticsWidget'),
      'AN-13',
      'Multiple StatisticsWidget instances are manually arranged with generic layout primitives; use the documented widget composition and WDS Layout/Cell placement.',
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

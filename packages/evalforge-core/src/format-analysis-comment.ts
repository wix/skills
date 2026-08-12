import type { RunAnalysis, RunAnalysisCategory, RunAnalysisFinding, RunAnalysisSeverity } from './evalforge';

export const ANALYSIS_COMMENT_MARKER = '<!-- evalforge-skill-analysis-action -->';

/**
 * Budget for the rendered body. GitHub rejects a comment over 65536 characters with a 422, and
 * `makeCommenter` degrades that to the job summary — so an unbudgeted body does not fail the job,
 * it silently loses the PR comment. The margin absorbs the fixed scaffolding.
 */
export const MAX_COMMENT_BODY_LENGTH = 60_000;

/** One 100k narrative must not be able to crowd out every finding. */
const MAX_SUMMARY_LENGTH = 12_000;

const TEASER_LENGTH = 300;

/** Room for the omission notice, so trimming findings can never itself overflow the budget. */
const OMISSION_NOTICE_RESERVE = 160;

const HEADING = 'EvalForge: AI Investigation';

const CATEGORY_LABELS: Record<RunAnalysisCategory, string> = {
  FAILURE_PATTERN: 'Failure pattern',
  COST_WASTE: 'Cost waste',
  FLAKINESS: 'Flakiness',
  INEFFICIENCY: 'Inefficiency',
  POSITIVE: 'Strength',
  WRONG_TOOL_CALL: 'Wrong tool call',
  TOOL_OUTPUT_ERROR: 'Tool output error',
  DOCS_ERROR: 'Docs error',
  SKILL_MISGUIDANCE: 'Skill misguidance',
  UNKNOWN: 'Uncategorised',
};

const SEVERITY_LABELS: Record<RunAnalysisSeverity, string> = {
  HIGH: '🔴 High',
  MEDIUM: '🟠 Medium',
  LOW: '🟡 Low',
  UNKNOWN: '',
};

const SEVERITY_RANK: Record<RunAnalysisSeverity, number> = {
  HIGH: 0, MEDIUM: 1, LOW: 2, UNKNOWN: 3,
};

function render(body: string[]): string {
  return [ANALYSIS_COMMENT_MARKER, `## 🔍 ${HEADING}`, '', ...body].join('\n');
}

function runLine(runId: string, runUrl: string): string {
  return `<sub>Generated for <a href="${runUrl}">eval run ${runId}</a></sub>`;
}

/** Positives last: a reader opening this comment is here for what broke. */
function sortFindings(findings: RunAnalysisFinding[]): RunAnalysisFinding[] {
  return [...findings].sort((left, right) => {
    const positive = Number(left.category === 'POSITIVE') - Number(right.category === 'POSITIVE');
    return positive !== 0 ? positive : SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  });
}

function tally(findings: RunAnalysisFinding[]): string {
  const problems = findings.filter(candidate => candidate.category !== 'POSITIVE');
  const counts: Array<readonly [string, number]> = [
    ['high', problems.filter(candidate => candidate.severity === 'HIGH').length],
    ['medium', problems.filter(candidate => candidate.severity === 'MEDIUM').length],
    ['low', problems.filter(candidate => candidate.severity === 'LOW').length],
    ['positive', findings.length - problems.length],
  ];
  const parts = counts.filter(([, count]) => count > 0).map(([label, count]) => `${count} ${label}`);
  const noun = findings.length === 1 ? 'finding' : 'findings';
  return `**${findings.length} ${noun}**${parts.length > 0 ? ` — ${parts.join(', ')}.` : '.'}`;
}

/** Cuts at a word boundary so a truncated string never ends mid-word. */
function truncateWords(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function teaser(summary: string): string[] {
  const firstParagraph = summary.trim().split('\n\n')[0]?.trim() ?? '';
  return firstParagraph === '' ? [] : ['', truncateWords(firstParagraph, TEASER_LENGTH)];
}

function findingBlock(finding: RunAnalysisFinding): string[] {
  const severity = SEVERITY_LABELS[finding.severity];
  const category = CATEGORY_LABELS[finding.category];
  const lines = [
    '',
    `### ${severity === '' ? category : `${severity} · ${category}`}`,
    '',
    finding.description,
  ];
  if (finding.affectedScenarios.length > 0) {
    lines.push('', `**Scenarios:** ${finding.affectedScenarios.map(name => `\`${name}\``).join(', ')}`);
  }
  if (finding.recommendation !== undefined && finding.recommendation !== '') {
    lines.push('', `**Recommendation:** ${finding.recommendation}`);
  }
  return lines;
}

/**
 * Drops whole findings from the tail until the body fits. The sort puts the most serious first, so
 * what survives truncation is the material worth reading; the tally and run link sit outside the
 * fold and are never dropped, which is what keeps a truncated comment actionable.
 */
function foldedDetail(summary: string, findings: RunAnalysisFinding[], fixedLength: number): string[] {
  const cappedSummary = truncateWords(summary.trim(), MAX_SUMMARY_LENGTH);
  const header = ['', '<details>', '<summary>Full investigation</summary>', ''];
  const footer = ['', '</details>'];
  const lengthOf = (lines: string[]) => lines.join('\n').length;

  let budget = MAX_COMMENT_BODY_LENGTH
    - fixedLength
    - lengthOf([...header, cappedSummary, ...footer])
    - OMISSION_NOTICE_RESERVE;

  const kept: string[] = [];
  let dropped = 0;
  for (const candidate of findings) {
    const block = findingBlock(candidate);
    const cost = lengthOf(block) + 1;
    if (cost > budget) { dropped += 1; continue; }
    budget -= cost;
    kept.push(...block);
  }

  const notice = dropped === 0 ? [] : [
    '',
    `_${dropped} further finding${dropped === 1 ? '' : 's'} omitted — `
    + 'see the full analysis in EvalForge._',
  ];

  return [...header, cappedSummary, ...kept, ...notice, ...footer];
}

export function formatAnalysisComment(input: {
  analysis: RunAnalysis;
  runId: string;
  runUrl: string;
}): string {
  const { analysis, runId, runUrl } = input;
  const findings = sortFindings(analysis.findings);
  const footer = ['', runLine(runId, runUrl)];

  if (findings.length === 0) {
    return render([
      'No findings — the investigation surfaced nothing to act on.',
      ...teaser(analysis.summary),
      ...footer,
    ]);
  }

  const above = [tally(findings), ...teaser(analysis.summary)];
  const fixedLength = render([...above, ...footer]).length;
  return render([...above, ...foldedDetail(analysis.summary, findings, fixedLength), ...footer]);
}

export function formatAnalysisUnavailable(input: {
  reason: string;
  runId: string;
  runUrl: string;
}): string {
  return render([
    `The AI investigation could not be generated: ${input.reason}.`,
    '',
    'This does not affect the gate verdict.',
    '',
    runLine(input.runId, input.runUrl),
  ]);
}

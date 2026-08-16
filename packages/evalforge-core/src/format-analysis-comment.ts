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

/**
 * Safety net for the note that explains why no analysis arrived. Its reasons are short mapped
 * sentences, so this bounds only a caller that passes something unbounded through.
 */
const MAX_REASON_LENGTH = 500;

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

/** `2026-08-12T14:03:22.512Z` → `2026-08-12 14:03 UTC`. Absent for a value the wire mangled. */
function formatGeneratedAt(generatedAt: string): string | undefined {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function runLine(runId: string, runUrl: string, generatedAt?: string): string {
  const stamp = generatedAt === undefined ? undefined : formatGeneratedAt(generatedAt);
  const suffix = stamp === undefined ? '' : ` · ${stamp}`;
  return `<sub>Generated for <a href="${runUrl}">eval run ${runId}</a>${suffix}</sub>`;
}

/**
 * GitHub honours a `</details>` from inside the fold, unfolding every finding after it. Matched
 * loosely because `</DETAILS>` and `</details >` close it just as well as the canonical spelling.
 */
function neutraliseFoldEnd(text: string): string {
  return text.replaceAll(/<\/\s*details\s*>/gi, '&lt;/details&gt;');
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

/** The above-fold extract: the summary's first paragraph, cut to the teaser budget. */
function teaserText(summary: string): string {
  const firstParagraph = summary.trim().split('\n\n')[0]?.trim() ?? '';
  return firstParagraph === '' ? '' : neutraliseFoldEnd(truncateWords(firstParagraph, TEASER_LENGTH));
}

function teaserLines(teaser: string): string[] {
  return teaser === '' ? [] : ['', teaser];
}

function findingBlock(finding: RunAnalysisFinding): string[] {
  // A positive finding sits outside the severity counts in the tally, so labelling it "🔴 High"
  // here would have the heading and the body disagree about the same finding.
  const severity = finding.category === 'POSITIVE' ? '' : SEVERITY_LABELS[finding.severity];
  const category = CATEGORY_LABELS[finding.category];
  const lines = [
    '',
    `### ${severity === '' ? category : `${severity} · ${category}`}`,
    '',
    neutraliseFoldEnd(finding.description),
  ];
  if (finding.affectedScenarios.length > 0) {
    lines.push('', `**Scenarios:** ${finding.affectedScenarios.map(name => `\`${name}\``).join(', ')}`);
  }
  if (finding.recommendation !== undefined && finding.recommendation !== '') {
    lines.push('', `**Recommendation:** ${neutraliseFoldEnd(finding.recommendation)}`);
  }
  return lines;
}

/**
 * Drops whole findings from the tail until the body fits. The sort puts the most serious first, so
 * what survives truncation is the material worth reading; the tally and run link sit outside the
 * fold and are never dropped, which is what keeps a truncated comment actionable.
 */
function foldedDetail(
  summary: string,
  findings: RunAnalysisFinding[],
  fixedLength: number,
  teaser: string,
): string[] {
  const cappedSummary = neutraliseFoldEnd(truncateWords(summary.trim(), MAX_SUMMARY_LENGTH));
  // A single short paragraph is shown whole by the teaser, so repeating it here reads as a
  // rendering bug. Compared as rendered strings rather than by re-deriving the two budgets, so the
  // rule cannot drift if either changes. A truncated teaser still overlaps the full text below,
  // which is intended — an excerpt, then the narrative.
  const summaryLines = cappedSummary === teaser ? [] : ['', cappedSummary];
  // The blank line after `</summary>` is required, or GitHub renders the enclosed markdown
  // literally. It comes from `summaryLines`, the first finding block, the notice or the footer —
  // every one of them opens with one.
  const header = ['', '<details>', '<summary>Full investigation</summary>'];
  const footer = ['', '</details>'];
  const lengthOf = (lines: string[]) => lines.join('\n').length;

  let budget = MAX_COMMENT_BODY_LENGTH
    - fixedLength
    - lengthOf([...header, ...summaryLines, ...footer])
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
    `_${dropped} finding${dropped === 1 ? '' : 's'} omitted — `
    + 'see the full analysis in EvalForge._',
  ];

  return [...header, ...summaryLines, ...kept, ...notice, ...footer];
}

export function formatAnalysisComment(input: {
  analysis: RunAnalysis;
  runId: string;
  runUrl: string;
}): string {
  const { analysis, runId, runUrl } = input;
  const findings = sortFindings(analysis.findings);
  const footer = ['', runLine(runId, runUrl, analysis.generatedAt)];
  const teaser = teaserText(analysis.summary);

  if (findings.length === 0) {
    return render([
      'No findings — the investigation surfaced nothing to act on.',
      ...teaserLines(teaser),
      ...footer,
    ]);
  }

  const above = [tally(findings), ...teaserLines(teaser)];
  const fixedLength = render([...above, ...footer]).length;
  return render([
    ...above,
    ...foldedDetail(analysis.summary, findings, fixedLength, teaser),
    ...footer,
  ]);
}

export function formatAnalysisUnavailable(input: {
  reason: string;
  runId: string;
  runUrl: string;
}): string {
  return render([
    `The AI investigation could not be generated: ${truncateWords(input.reason, MAX_REASON_LENGTH)}.`,
    '',
    'This does not affect the gate verdict.',
    '',
    runLine(input.runId, input.runUrl),
  ]);
}

/**
 * Retracts an investigation of a run a later push has superseded. Posted by the gate when the run
 * comes back clean, so a green verdict is never left sitting above a stale list of findings.
 */
export function formatAnalysisSuperseded(input: { runId: string; runUrl: string }): string {
  return render([
    'The earlier investigation no longer applies — the latest run had no failing assertions.',
    '',
    runLine(input.runId, input.runUrl),
  ]);
}

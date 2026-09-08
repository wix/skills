export const REVIEW_COMMENT_MARKER = '<!-- evalforge-skill-review-action -->';

/** Neither marker may contain the other: the upsert finds a comment by `includes`. */
export const REVIEW_PENDING_MARKER = '<!-- evalforge-skill-review-pending -->';

const HEADING = '## 🤖 Skill Review';

const JOB_STATUS = {
  completed: '✅ Review job completed',
  partial: '⚠️ Review job partly completed',
  failed: '❌ Review job failed',
  skipped: '⏭ Review job skipped',
} as const;

function jobLine(status: keyof typeof JOB_STATUS, detail: string | undefined): string {
  const line = detail === undefined ? JOB_STATUS[status] : `${JOB_STATUS[status]} — ${detail}`;
  return status === 'completed' ? `<sub>${line}</sub>` : line;
}

/** Worst-first, and load-bearing: `severityRank` sorts on it and only `blocking` fails the check. */
export const REVIEW_SEVERITIES = ['blocking', 'fix-before-merge'] as const;

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

const SEVERITY_ICON: Record<ReviewSeverity, string> = {
  blocking: '🔴',
  'fix-before-merge': '🟡',
};

export type ReviewFinding = {
  file: string;
  line?: number;
  section?: string;
  severity: ReviewSeverity;
  quote: string;
  consequence: string;
  /** The wording that should replace the quote. */
  suggestion?: string;
};

export type ReviewSummary = {
  headSha: string;
  filesReviewed: number;
  /** Findings that failed validation — counted rather than silently dropped. */
  discarded: number;
};

/** GitHub rejects a body over 65536 characters, and a review that long is a runaway anyway. */
const MAX_RENDERED_FINDINGS = 40;

function render(
  marker: string, status: keyof typeof JOB_STATUS, detail: string | undefined, body: string[],
): string {
  return [marker, HEADING, '', jobLine(status, detail), '', ...body].join('\n');
}

/** A quoted line can carry the eval gate's marker, and the upsert finds a comment by `includes`. */
function safe(text: string): string {
  return text.replace(/<!--/g, '&lt;!--');
}

function count(quantity: number, noun: string): string {
  return `${quantity} ${noun}${quantity === 1 ? '' : 's'}`;
}

function severityRank(severity: ReviewSeverity): number {
  return REVIEW_SEVERITIES.indexOf(severity);
}

function retryNote(): string[] {
  return ['', '_Comment `/re-eval` to review the current commit again._'];
}

/** Anything but a `path#anchor` renders verbatim: a URL guessed from it would be a confident 404. */
function sectionRef(section: string): string {
  const match = /^([\w./-]+\.md)#([\w-]+)$/.exec(section.trim());
  return match ? `[${match[2]}](../blob/main/${match[1]}#${match[2]})` : `\`${section}\``;
}

function location(finding: ReviewFinding, headSha: string): string {
  const href = `../blob/${headSha}/${finding.file}`;
  return finding.line
    ? `[line ${finding.line}](${href}#L${finding.line})`
    : `[file](${href})`;
}

function findingLines(finding: ReviewFinding, headSha: string): string[] {
  const cite = finding.section ? ` · ${sectionRef(safe(finding.section))}` : '';
  const lines = [`- ${SEVERITY_ICON[finding.severity]} **${finding.severity}** — ${location(finding, headSha)}${cite}`];
  const quote = safe(String(finding.quote ?? '')).replace(/\n/g, ' ');
  if (quote !== '') lines.push(`  > ${quote}`);
  lines.push('', `  ${safe(String(finding.consequence ?? ''))}`);
  if (finding.suggestion) {
    lines.push('', `  **Instead:** ${safe(finding.suggestion).replace(/\n/g, ' ')}`);
  }
  return lines;
}

function groupByFile(findings: ReviewFinding[], headSha: string): string[] {
  const byFile = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const bucket = byFile.get(finding.file);
    if (bucket) bucket.push(finding);
    else byFile.set(finding.file, [finding]);
  }

  const lines: string[] = [];
  for (const [file, group] of byFile) {
    lines.push('', `### \`${file}\``, '');
    const sorted = group.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    sorted.forEach((finding, index) => {
      if (index > 0) lines.push('');
      lines.push(...findingLines(finding, headSha));
    });
  }
  return lines;
}

function headline(findings: ReviewFinding[]): string {
  const tally = REVIEW_SEVERITIES
    .map(severity => ({ severity, n: findings.filter(f => f.severity === severity).length }))
    .filter(entry => entry.n > 0)
    .map(entry => `${entry.n} ${entry.severity}`);
  return tally.join(', ');
}

/** Without the SHA, a comment left by an earlier push reads as a verdict on the current commit. */
function verdictLine(verdict: string, summary: ReviewSummary): string {
  return `**${verdict}** · \`${summary.headSha.slice(0, 7)}\` · ${count(summary.filesReviewed, 'file')}`;
}

function completion(summary: ReviewSummary): [keyof typeof JOB_STATUS, string | undefined] {
  return summary.discarded === 0
    ? ['completed', undefined]
    : ['partial', `${count(summary.discarded, 'finding')} could not be read`];
}

export function formatReviewFindings(findings: ReviewFinding[], summary: ReviewSummary): string {
  const shown = findings.slice(0, MAX_RENDERED_FINDINGS);
  const overflow = findings.length - shown.length;

  const body = [
    verdictLine(headline(findings), summary),
    ...groupByFile(shown, summary.headSha),
  ];

  if (overflow > 0) {
    body.push('', `_${count(overflow, 'further finding')} not shown._`);
  }

  return render(REVIEW_COMMENT_MARKER, ...completion(summary), [
    ...body,
    ...retryNote(),
  ]);
}

export function formatReviewClean(summary: ReviewSummary): string {
  return render(REVIEW_COMMENT_MARKER, ...completion(summary), [
    verdictLine('No findings', summary),
    '',
    'Nothing to raise against the reviewed sections of the contribution guide.',
    ...retryNote(),
  ]);
}

export function formatReviewSkipped(reason: string): string {
  return render(REVIEW_COMMENT_MARKER, 'skipped', reason, [
    'The check is green because the reviewer did not run, not because the change passed.',
  ]);
}

export function formatReviewPending(headSha: string): string {
  return [
    REVIEW_PENDING_MARKER,
    `⏳ **Awaiting skill review** — commit \`${headSha.slice(0, 7)}\``,
    '',
    'The review runs automatically when a PR is opened, and on request after that.',
    '',
    'Comment `/re-eval` to review this commit.',
  ].join('\n');
}

export function formatReviewServiceError(reason: string): string {
  return render(REVIEW_PENDING_MARKER, 'failed', reason, [
    'This commit has not been reviewed.',
    '',
    'Comment `/re-eval` to try again.',
  ]);
}

export const REVIEW_COMMENT_MARKER = '<!-- evalforge-skill-review-action -->';

/** No marker may contain another: comments are matched by `includes`. */
export const REVIEW_PENDING_MARKER = '<!-- evalforge-skill-review-pending -->';

export const REVIEW_ACK_MARKER = '<!-- evalforge-skill-review-ack -->';

/** On each finding posted as a review comment, so the next run can find and retire it. */
export const REVIEW_THREAD_MARKER = '<!-- evalforge-skill-review-thread -->';

const HEADING = '## 🤖 Skill Review';

const JOB_STATUS = {
  completed: '✅ Review job completed',
  partial: '⚠️ Review job partly completed',
  failed: '❌ Review job failed',
  skipped: '⏭ Review job skipped',
} as const;

function jobLine(
  status: keyof typeof JOB_STATUS, detail: string | undefined, summary?: ReviewSummary,
): string {
  const parts = [detail === undefined ? JOB_STATUS[status] : `${JOB_STATUS[status]} — ${detail}`];
  if (summary) parts.push(verdictLine(summary));
  if (summary?.triggeredBy) parts.push(`triggered by @${summary.triggeredBy}`);
  const line = parts.join(' · ');
  return status === 'completed' ? `<sub>${line}</sub>` : line;
}

/** Worst-first, and load-bearing: the cap on posted findings keeps the first ones. */
export const REVIEW_SEVERITIES = ['blocking', 'advisory'] as const;

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

const SEVERITY_ICON: Record<ReviewSeverity, string> = {
  blocking: '🔴',
  advisory: '🟡',
};

export type ReviewFinding = {
  file: string;
  line?: number;
  section?: string;
  severity: ReviewSeverity;
  quote: string;
  consequence: string;
  /** The change that resolves the finding. */
  suggestion?: string;
};

export type ReviewSummary = {
  headSha: string;
  filesReviewed: number;
  /** Findings that failed validation — counted rather than silently dropped. */
  discarded: number;
  score: number;
  verdict: string;
  triggeredBy?: string;
};

function render(
  marker: string, status: keyof typeof JOB_STATUS, detail: string | undefined, body: string[],
  summary?: ReviewSummary,
): string {
  const heading = summary === undefined ? HEADING : `${HEADING} · ${scoreLabel(summary.score)}`;
  return [marker, heading, '', jobLine(status, detail, summary), '', ...body].join('\n');
}

function scoreLabel(score: number): string {
  return `Score: ${score}/10`;
}

function count(quantity: number, noun: string): string {
  return `${quantity} ${noun}${quantity === 1 ? '' : 's'}`;
}

function retryNote(): string[] {
  return ['', '_Comment `/review` to review the current commit again._'];
}

/**
 * Anything but a `path#anchor` renders verbatim: a URL guessed from it would be a confident 404.
 * `repoUrl` is absolute: a review comment also renders under Files changed, where a relative link
 * resolves one level too deep.
 */
function sectionRef(section: string, repoUrl: string): string {
  const match = /^([\w./-]+\.md)#([\w-]+)$/.exec(section.trim());
  return match ? `[${match[2]}](${repoUrl}/blob/main/${match[1]}#${match[2]})` : `\`${section}\``;
}

function headline(findings: ReviewFinding[]): string {
  const tally = REVIEW_SEVERITIES
    .map(severity => ({ severity, n: findings.filter(f => f.severity === severity).length }))
    .filter(entry => entry.n > 0)
    .map(entry => `${SEVERITY_ICON[entry.severity]} ${entry.n} ${entry.severity}`);
  return tally.join(', ');
}

/** Without the SHA, a comment left by an earlier push reads as a verdict on the current commit. */
function verdictLine(summary: ReviewSummary): string {
  return `\`${summary.headSha.slice(0, 7)}\` · ${count(summary.filesReviewed, 'file')}`;
}

function completion(summary: ReviewSummary): [keyof typeof JOB_STATUS, string | undefined] {
  return summary.discarded === 0
    ? ['completed', undefined]
    : ['partial', `${count(summary.discarded, 'finding')} could not be read`];
}

/**
 * `unplaced` are findings GitHub had no line or file for. They only add a note: this comment is
 * posted before the findings and edited after.
 */
export function formatReviewFindings(
  findings: ReviewFinding[], summary: ReviewSummary, unplaced: ReviewFinding[], repoUrl: string, notPosted = 0,
): string {
  const body = [
    summary.verdict.replace(/\n/g, ' '),
    '',
    `**${headline(findings)}** — posted as review comments on the changed lines.`,
  ];
  if (notPosted > 0) body.push('', `_${count(notPosted, 'further finding')} not posted: only the worst ${findings.length} are._`);
  if (unplaced.length > 0) {
    const note = [`**Not on the changed files** — this PR has no line or file to attach ${unplaced.length === 1 ? 'this finding' : 'these findings'} to.`];
    for (const finding of unplaced) {
      note.push(
        '',
        `**\`${finding.file}\`**`,
        ...findingBody(finding, summary.headSha, repoUrl, false),
        '',
        `<sub>${findingTag(finding, repoUrl)}</sub>`,
      );
    }
    // Per line, not per entry: a consequence that spans lines would otherwise end the note early.
    const lines = note.flatMap(entry => entry.split('\n'));
    body.push('', '> [!NOTE]', ...lines.map(line => (line === '' ? '>' : `> ${line}`)));
  }
  return render(REVIEW_COMMENT_MARKER, ...completion(summary), [...body, ...retryNote()], summary);
}

/** Off its line, nothing beside the comment shows what it is about, so it names the line and quotes it. */
function findingBody(finding: ReviewFinding, headSha: string, repoUrl: string, onLine: boolean): string[] {
  const lines: string[] = [];
  if (!onLine) {
    if (finding.line) lines.push(`[line ${finding.line}](${repoUrl}/blob/${headSha}/${finding.file}#L${finding.line})`);
    const quote = String(finding.quote ?? '').replace(/\n/g, ' ');
    if (quote !== '') lines.push(`> ${quote}`);
    if (lines.length > 0) lines.push('');
  }
  lines.push(String(finding.consequence ?? ''));
  if (finding.suggestion) lines.push('', `**Instead:** ${finding.suggestion.replace(/\n/g, ' ')}`);
  return lines;
}

function findingTag(finding: ReviewFinding, repoUrl: string): string {
  const cite = finding.section ? ` · ${sectionRef(finding.section, repoUrl)}` : '';
  return `${SEVERITY_ICON[finding.severity]} **${finding.severity}**${cite}`;
}

export function formatFindingComment(finding: ReviewFinding, headSha: string, repoUrl: string, onLine: boolean): string {
  return [
    REVIEW_THREAD_MARKER,
    ...findingBody(finding, headSha, repoUrl, onLine),
    '',
    `<sub>${findingTag(finding, repoUrl)} · \`${headSha.slice(0, 7)}\`</sub>`,
  ].join('\n');
}

export function formatReviewClean(summary: ReviewSummary): string {
  return render(REVIEW_COMMENT_MARKER, ...completion(summary), [
    summary.verdict.replace(/\n/g, ' '),
    '',
    '**No findings** — nothing to raise against the reviewed sections of the contribution guide.',
    ...retryNote(),
  ], summary);
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
    'Comment `/review` to review this commit.',
  ].join('\n');
}

export function formatReviewServiceError(reason: string): string {
  return render(REVIEW_PENDING_MARKER, 'failed', reason, [
    'This commit has not been reviewed.',
    '',
    'Comment `/review` to try again.',
  ]);
}

import type { LoadError } from './evals';
import type { Uncovered } from './coverage';
import type { DocsEntryProblem } from './docs-entry-check';
import type { EvalRunStatus, SyncError } from '@wix/evalforge-core';
import { evalRunUrl } from '@wix/evalforge-core';
import type { CompareGroupComplete, ScenarioComparison } from './eval-pipeline';
import { formatTokenCount, type TokenBudgetViolation } from './token-budget';
import type { SweepVerdict } from './sweep-verdict';

export const COMMENT_MARKER = '<!-- evalforge-yaml-gate-action -->';
const HEADING = 'EvalForge YAML Gate';

/** Its own marker: the sweep comment sits beside the gate's, never in place of it.
 * No marker may contain another: comments are matched by `includes`. */
export const PR_SWEEP_MARKER = '<!-- evalforge-pr-sweep-result -->';
/** The "not swept yet" reminder, edited in place on every push and deleted once a sweep reports. */
export const PR_SWEEP_PENDING_MARKER = '<!-- evalforge-pr-sweep-pending -->';
/** The `/sweep` acknowledgement the re-eval workflow posts; deleted once the sweep reports. */
export const PR_SWEEP_ACK_MARKER = '<!-- evalforge-pr-sweep-ack -->';
const PR_SWEEP_HEADING = 'EvalForge PR Sweep';

export function formatPrSweepPending(headSha: string): string {
  return [
    PR_SWEEP_PENDING_MARKER,
    `## ⏳ ${PR_SWEEP_HEADING}: Not Swept — commit \`${headSha.slice(0, 7)}\``,
    '',
    '**What this is.** The eval gate above runs only the scenarios that cover the docs you changed. A *sweep* goes wider: it re-runs every EvalForge scenario that shares a tag with your changes — including scenarios for other areas and ones that exist only in EvalForge — against this PR\'s version of the docs. It catches a change to one recipe breaking another one that the gate never looks at.',
    '',
    '**When to run it.** Worth doing once your change is close to final, or whenever you touch a recipe that other areas link to. It takes a few minutes for a handful of scenarios, longer if retries are needed.',
    '',
    '**How.** Comment `/sweep` on this PR (it must be the first word of the comment). The result replaces this comment: which tags matched, how many scenarios ran, and any confirmed failures with the assertion that failed. A new push brings this reminder back for the new commit.',
  ].join('\n');
}

function render(icon: string, label: string, body: string[]): string {
  return [COMMENT_MARKER, `## ${icon} ${HEADING}: ${label}`, '', ...body].join('\n');
}

function renderSweep(icon: string, label: string, body: string[]): string {
  return [PR_SWEEP_MARKER, `## ${icon} ${PR_SWEEP_HEADING}: ${label}`, '', ...body].join('\n');
}

function sweepScopeLines(v: { tags: string[]; sampled: number; total: number; runUrl: string }, versionLabel: string): string[] {
  const sampled = v.sampled < v.total
    ? ` — sampled: a tag matching more than ${v.sampled} scenarios runs a fixed subset`
    : '';
  return [
    `**Tags:** ${v.tags.map(t => `\`${t}\``).join(', ')}`,
    `**Scenarios:** ${v.sampled} / ${v.total} matched${sampled}`,
    `**MCP version:** \`${versionLabel}\``,
    `**Run:** ${v.runUrl}`,
  ];
}

function recoveredLines(recovered: Array<{ scenarioName: string }>): string[] {
  if (recovered.length === 0) return [];
  return ['', '**Recovered on retry (flaky):**', ...recovered.map(v => `- \`${v.scenarioName}\``)];
}

/**
 * The PR-comment rendering of a sweep verdict. The merge sweep reports the same verdict to Slack;
 * this is the on-demand PR sweep's report, so it names the PR's MCP version and stays a warning
 * until the sweep is made blocking.
 */
export function formatPrSweep(verdict: SweepVerdict, opts: { blocking: boolean; versionLabel: string }): string {
  switch (verdict.kind) {
    case 'nothing-to-run':
      return renderSweep('ℹ️', 'Nothing to Run', [verdict.reason]);
    case 'infra-error':
      return renderSweep(opts.blocking ? '❌' : '⚠️', 'Could Not Run', [
        verdict.message,
        ...(verdict.runUrl ? ['', `**Run:** ${verdict.runUrl}`] : []),
      ]);
    case 'passed':
      return renderSweep('✅', 'Passed', [
        'Every tag-matched scenario passed against this PR\'s docs.',
        '',
        ...sweepScopeLines(verdict, opts.versionLabel),
        ...recoveredLines(verdict.recovered ?? []),
      ]);
    case 'failed': {
      const { icon, label } = failIcon(opts.blocking);
      const lines = [
        `${verdict.confirmed.length} scenario(s) confirmed failed against this PR's docs.`,
        '',
        ...sweepScopeLines(verdict, opts.versionLabel),
        '',
        '**Confirmed failures:**',
        ...verdict.confirmed.map(v => `- \`${v.scenarioName}\` (${v.reasons.join(', ')})`),
        ...recoveredLines(verdict.recovered),
      ];
      if (verdict.skipNote) lines.push('', `> ⚠️ ${verdict.skipNote}`);
      return renderSweep(icon, label, lines);
    }
  }
}

function failIcon(blocking: boolean): { icon: string; label: string } {
  return blocking ? { icon: '❌', label: 'Failed' } : { icon: '⚠️', label: 'Warning' };
}

export function formatLoadErrors(errors: LoadError[]): string {
  return render('❌', 'Invalid YAML', errors.map(e => `- \`${e.path}\`: ${e.message}`));
}

export function formatOrphanedMds(files: string[]): string {
  return render('❌', 'Doc Not Registered', [
    'These changed `.md` files are not listed in any `yaml/wix-manage/<area>/documentation.yaml`. The gate cannot compute a canonical doc URL for them. Add an entry to the appropriate `documentation.yaml`, or move the file out of `skills/wix-manage/references/`.',
    '',
    ...files.map(f => `- \`${f}\``),
  ]);
}

export function formatUncovered(uncovered: Uncovered[]): string {
  return render('❌', 'Missing Coverage', [
    'These changed docs have no covering YAML scenario for their **area** (scenarios for other areas do not count):',
    '',
    ...uncovered.map(u =>
      `- \`${u.file}\` — expected URL: \`${u.canonicalUrl}\` — add a scenario under \`yaml/wix-manage-evals/${u.area}/\``,
    ),
  ]);
}

export function formatForeignDraftConflicts(errs: SyncError[], _pull: { owner: string; repo: string }): string {
  const lines = errs.map(e => {
    const prRefs = e.foreignTags.map(t => {
      const m = t.match(/^draft:([^#]+)#(\d+)$/);
      return m ? `https://github.com/${m[1]}/pull/${m[2]}` : t;
    });
    return `- \`${e.name}\` is held by another open PR: ${prRefs.join(', ')}`;
  });
  return render('❌', 'Scenario Locked by Another PR', [
    'These scenarios are draft-tagged for other PRs. Wait for those PRs to merge/close, or coordinate with their authors:',
    '',
    ...lines,
  ]);
}

export function formatTooManyNewSkills(count: number, limit: number, files: string[]): string {
  return render('❌', 'Too Many New Skills', [
    `This PR creates **${count} new Wix Manage skill .md files**, exceeding the limit of **${limit} per PR**.`,
    '',
    'New skill files added:',
    ...files.map(f => `- \`${f}\``),
    '',
    'Please either:',
    '- Split across multiple PRs',
    '- Update existing skills instead of creating new ones',
  ]);
}

export function formatDocsEntryProblems(problems: DocsEntryProblem[]): string {
  const lines = problems.map((p) => {
    const ref = `\`${p.yamlPath}\` → "${p.title}": \`${p.docsEntry}\``;
    switch (p.kind) {
      case 'portal-not-found':
        return `- ${ref} — does not match any docs portal. Check the URL for typos.`;
      case 'node-not-found':
        return `- ${ref} — this page does not exist in the docs menu. If you just created the category, wait a minute and re-run this check.`;
      case 'not-a-category':
        return `- ${ref} — points at ${p.nodeType === 'SECTION' ? 'a section' : 'an API page'}, not a category.${p.suggestion ? ` You could use the category that groups it (\`${p.suggestion}\`), or pick/create a different one.` : ' Point it at an existing category, or create one in the docs menu.'}`;
    }
  });
  return render('❌', 'Invalid docsEntry', [
    '`docsEntry` must be the URL of a **category** in the docs menu — pointing at an individual API page silently fails after merge and the skill never appears. Copy the URL with the "Copy Docs Entry" button (it only appears on categories).',
    '',
    ...lines,
  ]);
}

export function formatServiceError(message: string, blocking: boolean): string {
  const { icon } = failIcon(blocking);
  return render(icon, blocking ? 'Error' : 'Warning', [message]);
}

function runLink(runId: string, runUrl: string): string {
  return `Run: [${runId}](${runUrl})`;
}

export function formatEvalPassed(m: EvalRunStatus['aggregateMetrics'], runId: string, runUrl: string): string {
  return render('✅', 'Passed', [`Pass rate: ${m.passRate}%`, runLink(runId, runUrl)]);
}

export function formatEvalFailed(m: EvalRunStatus['aggregateMetrics'], runId: string, runUrl: string, blocking: boolean): string {
  const { icon, label } = failIcon(blocking);
  return render(icon, label, [
    `Pass rate: ${m.passRate}%`,
    `${m.failed} failed, ${m.errors} errored, ${m.passed}/${m.totalAssertions} passed`,
    runLink(runId, runUrl),
  ]);
}

export function formatEvalTimeout(runId: string, runUrl: string, blocking: boolean): string {
  return render(blocking ? '⏱' : '⚠️', 'Timed Out', [runLink(runId, runUrl)]);
}

export function formatNoChanges(): string {
  return render('✅', 'No Gated Changes', ['Nothing under `evals/` or sibling `.md` changed.']);
}

function assertionLine(a: { status: string; name: string; score?: number; verdict?: string; message?: string }): string {
  const icon = a.status === 'passed' ? '✅' : '❌';
  const score = a.score !== undefined ? ` (${a.score}/10)` : '';
  const detail = a.verdict ? `: ${a.verdict}` : a.message ? `: ${a.message}` : '';
  return `- ${icon} ${a.name}${score}${detail}`;
}

function bothRunsFailedLlmJudge(s: ScenarioComparison): boolean {
  return s.with.assertions.some(a => a.type === 'llm_judge' && a.status !== 'passed')
    && s.without.assertions.some(a => a.type === 'llm_judge' && a.status !== 'passed');
}

export function noWinnerReason(s: ScenarioComparison): string | undefined {
  return bothRunsFailedLlmJudge(s) ? 'both runs failed the LLM judge' : undefined;
}

export function comparisonHasNoWinner(result: CompareGroupComplete['result']): boolean {
  return (result.scenarios ?? []).some(s => noWinnerReason(s));
}

function winnerLabel(s: ScenarioComparison): string {
  if (noWinnerReason(s)) {
    return '-';
  }

  if (!s.pairwiseJudgement) {
    return '—';
  }

  const winnerIcon = s.pairwiseJudgement.winner === 'tie' ? '≈' : s.pairwiseJudgement.winner === 'with' ? '⬆️' : '⬇️';
  return `${winnerIcon} ${s.pairwiseJudgement.winner} (${s.pairwiseJudgement.confidence})`;
}

export function formatComparisonResult(result: CompareGroupComplete, projectId?: string): string {
  const { verdict, tag, scenarios, judgeCoverage } = result.result;
  const hasNoWinner = comparisonHasNoWinner(result.result);
  // Partial judging never gets a green tick: `not-required` is what the pipeline
  // returns when a judge yields nothing, so a throttled pass looks identical to
  // a genuine "no difference" unless coverage is taken into account.
  const isFullyJudged = !judgeCoverage || judgeCoverage.judged === judgeCoverage.total;
  const verdictIcon = verdict === 'not-required' && !hasNoWinner && isFullyJudged ? '✅' : '⚠️';
  const lines: string[] = [
    COMMENT_MARKER,
    `## ${verdictIcon} ${HEADING}: Eval Comparison`,
    '',
    `**Verdict:** \`${verdict}\` | **Tag:** \`${tag}\``,
    '',
  ];

  if (!isFullyJudged && judgeCoverage) {
    lines.push(
      `> ⚠️ **Only ${judgeCoverage.judged}/${judgeCoverage.total} scenarios were judged.** The verdict above rests on the`,
      '> remaining scenarios\' assertion results alone, so treat it as provisional rather than',
      '> as evidence the skill makes no difference. Re-run to get full coverage.',
      '',
    );
  }

  lines.push(
    '| Scenario | Required | Winner | Cost (PR / prod) | Tokens (PR / prod) | Time (PR / prod) | Runs (PR / prod) |',
    '|---|---|---|---|---|---|---|',
  );

  for (const s of (scenarios ?? [])) {
    const costWith = s.with.totalCostUsd.toFixed(3);
    const costWithout = s.without.totalCostUsd.toFixed(3);
    const tokWith = `${(s.with.totalTokens / 1000).toFixed(1)}K`;
    const tokWithout = `${(s.without.totalTokens / 1000).toFixed(1)}K`;
    const timeWith = `${(s.with.durationMs / 1000).toFixed(1)}s`;
    const timeWithout = `${(s.without.durationMs / 1000).toFixed(1)}s`;
    const runWith = projectId && s.with.runId ? `[PR](${evalRunUrl(projectId, s.with.runId, s.with.name)})` : '—';
    const runWithout = projectId && s.without.runId ? `[prod](${evalRunUrl(projectId, s.without.runId, s.without.name)})` : '—';
    lines.push(`| ${s.scenarioName} | ${s.required ? '✅' : '❌'} | ${winnerLabel(s)} | $${costWith} / $${costWithout} | ${tokWith} / ${tokWithout} | ${timeWith} / ${timeWithout} | ${runWith} / ${runWithout} |`);
  }

  for (const s of (scenarios ?? [])) {
    const reason = noWinnerReason(s);
    lines.push('', `<details><summary>${s.scenarioName}</summary>`, '', s.reason, '');
    if (projectId && s.with.runId) lines.push(`[View run (PR)](${evalRunUrl(projectId, s.with.runId, s.with.name)})`, '');
    if (projectId && s.without.runId) lines.push(`[View run (prod)](${evalRunUrl(projectId, s.without.runId, s.without.name)})`, '');
    if (reason) {
      lines.push(`**No winner:** ${reason}.`, '');
    }
    lines.push('**Assertions (PR):**', ...s.with.assertions.map(assertionLine), '');
    lines.push('**Assertions (prod):**', ...s.without.assertions.map(assertionLine), '');
    if (s.pairwiseJudgement?.reasoning) {
      lines.push(`**Compare result:** ${s.pairwiseJudgement.reasoning}`, '');
    }
    if (s.pairwiseJudgement?.dimensions) {
      lines.push('**Dimensions:**', ...Object.entries(s.pairwiseJudgement.dimensions).map(([k, v]) => `- ${k}: **${v.winner}**`), '');
    }
    lines.push('</details>');
  }

  return lines.join('\n');
}

export function formatComparisonTimeout(comparisonGroupId: string, blocking: boolean): string {
  return render(blocking ? '⏱' : '⚠️', 'Comparison Timed Out', [`comparisonGroupId: ${comparisonGroupId}`]);
}

export function formatTokenBudgetExceeded(violations: TokenBudgetViolation[], projectId?: string): string {
  const lines = [
    'These scenarios exceeded their configured top-level `maxTokens` budget on the PR run:',
    '',
    '| Scenario | Max tokens | PR tokens | Prod tokens | PR run |',
    '|---|---:|---:|---:|---|',
  ];

  for (const v of violations) {
    const run = projectId && v.prRunId
      ? `[${v.prRunId}](${evalRunUrl(projectId, v.prRunId, v.prRunName)})`
      : '—';
    lines.push(`| ${v.scenarioName} | ${formatTokenCount(v.maxTokens)} | ${formatTokenCount(v.prTokens)} | ${formatTokenCount(v.prodTokens)} | ${run} |`);
  }

  return render('❌', 'Token Budget Exceeded', lines);
}

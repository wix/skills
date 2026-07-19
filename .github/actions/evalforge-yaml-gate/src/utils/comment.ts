import type { LoadError } from './evals';
import type { Uncovered } from './coverage';
import type { SyncError } from './sync';
import type { EvalRunStatus } from './evalforge';
import { evalRunUrl } from './evalforge';
import type { CompareGroupComplete, ScenarioComparison } from './eval-pipeline';
import { formatTokenCount, type TokenBudgetViolation } from './token-budget';

export const COMMENT_MARKER = '<!-- evalforge-yaml-gate-action -->';
const HEADING = 'EvalForge YAML Gate';

function render(icon: string, label: string, body: string[]): string {
  return [COMMENT_MARKER, `## ${icon} ${HEADING}: ${label}`, '', ...body].join('\n');
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

export function formatComparisonResult(result: CompareGroupComplete, projectId?: string): string {
  const { verdict, tag, scenarios } = result.result;
  const verdictIcon = verdict === 'not-required' ? '✅' : '⚠️';
  const lines: string[] = [
    COMMENT_MARKER,
    `## ${verdictIcon} ${HEADING}: Eval Comparison`,
    '',
    `**Verdict:** \`${verdict}\` | **Tag:** \`${tag}\``,
    '',
    '| Scenario | Required | Winner | Cost (PR / prod) | Tokens (PR / prod) | Time (PR / prod) | Runs (PR / prod) |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const s of (scenarios ?? [])) {
    const j = s.pairwiseJudgement;
    const winnerLabel = !j ? '—' : j.winner === 'tie' ? '≈ tie' : j.winner === 'with' ? '⬆️ PR' : '⬇️ prod';
    const winnerCell = j ? `${winnerLabel} (${j.confidence})` : winnerLabel;
    const costWith = s.with.totalCostUsd.toFixed(3);
    const costWithout = s.without.totalCostUsd.toFixed(3);
    const tokWith = `${(s.with.totalTokens / 1000).toFixed(1)}K`;
    const tokWithout = `${(s.without.totalTokens / 1000).toFixed(1)}K`;
    const timeWith = `${(s.with.durationMs / 1000).toFixed(1)}s`;
    const timeWithout = `${(s.without.durationMs / 1000).toFixed(1)}s`;
    const runWith = projectId && s.with.runId ? `[PR](${evalRunUrl(projectId, s.with.runId, s.with.name)})` : '—';
    const runWithout = projectId && s.without.runId ? `[prod](${evalRunUrl(projectId, s.without.runId, s.without.name)})` : '—';
    lines.push(`| ${s.scenarioName} | ${s.required ? '✅' : '—'} | ${winnerCell} | $${costWith} / $${costWithout} | ${tokWith} / ${tokWithout} | ${timeWith} / ${timeWithout} | ${runWith} / ${runWithout} |`);
  }

  for (const s of (scenarios ?? [])) {
    lines.push('', `<details><summary>${s.scenarioName}</summary>`, '', s.reason, '');
    if (projectId && s.with.runId) lines.push(`[View run (PR)](${evalRunUrl(projectId, s.with.runId, s.with.name)})`, '');
    if (projectId && s.without.runId) lines.push(`[View run (prod)](${evalRunUrl(projectId, s.without.runId, s.without.name)})`, '');
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

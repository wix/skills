import type { LoadError } from './evals';
import type { Uncovered } from './coverage';
import type { SyncError } from './sync';
import type { EvalRunStatus } from './evalforge';

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

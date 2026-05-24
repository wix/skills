import type { EvalRunStatus } from './evalforge';
import type { CoverageError } from './coverage';
import type { ManifestError } from './manifest';

export const COMMENT_MARKER = '<!-- evalforge-gate-action -->';

const HEADING = 'EvalForge Coverage Gate';

function render(icon: string, label: string, body: string[]): string {
  return [COMMENT_MARKER, `## ${icon} ${HEADING}: ${label}`, '', ...body].join('\n');
}

function failIcon(blocking: boolean): { icon: string; label: string } {
  return blocking ? { icon: '❌', label: 'Failed' } : { icon: '⚠️', label: 'Warning' };
}

export function formatManifestErrors(errors: ManifestError[]): string {
  return render('❌', 'Invalid Manifest', errors.map(e => `- \`${e.manifestPath}\`: ${e.message}`));
}

export function formatUncovered(errors: CoverageError[]): string {
  return render('❌', 'Missing Coverage', [
    'These changed files have no covering scenario in their `.evalforge.yml` manifest:',
    '',
    ...errors.map(e => `- \`${e.file}\`: ${e.message}`),
    '',
    'Add a scenario in EvalForge (tag it with `pending:<repo>#<pr>` if it covers an unmerged PR), then reference its ID in the manifest.',
  ]);
}

export function formatServiceError(message: string, blocking: boolean): string {
  const { icon } = failIcon(blocking);
  return render(icon, blocking ? 'Error' : 'Warning', [message]);
}

export function formatEvalPassed(metrics: EvalRunStatus['aggregateMetrics'], runId: string): string {
  return render('✅', 'Passed', [`Pass rate: ${metrics.passRate}%`, `Run ID: ${runId}`]);
}

export function formatEvalFailed(metrics: EvalRunStatus['aggregateMetrics'], runId: string, blocking: boolean): string {
  const { icon, label } = failIcon(blocking);
  return render(icon, label, [
    `Pass rate: ${metrics.passRate}%`,
    `${metrics.failed} failed, ${metrics.errors} errored, ${metrics.passed}/${metrics.totalAssertions} passed`,
    `Run ID: ${runId}`,
  ]);
}

export function formatEvalTimeout(runId: string, blocking: boolean): string {
  return render(blocking ? '⏱' : '⚠️', 'Timed Out', [`Run ID: ${runId}`]);
}

export function formatNoScenarios(): string {
  return render('✅', 'No Gated Changes', [
    'No changed files fall under a `.evalforge.yml` manifest — nothing to evaluate.',
  ]);
}

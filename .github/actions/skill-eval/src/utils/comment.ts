import type { ValidationError } from './yaml';
import type { EvalRunStatus } from './evalforge';

export const COMMENT_MARKER = '<!-- skill-eval-action -->';

export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = errors.map(e => `- **${e.entryTitle}**: ${e.message}`).join('\n');
  return [COMMENT_MARKER, '## ❌ Skill Validation: Failed', '', lines].join('\n');
}

export function formatServiceError(message: string, blocking = true): string {
  const icon = blocking ? '❌' : '⚠️';
  const heading = blocking ? 'Skill Evaluation: Error' : 'Skill Evaluation: Warning';
  return `${COMMENT_MARKER}\n## ${icon} ${heading}\n\n${message}`;
}

export function formatFailedJobMessage(errors: ValidationError[]): string {
  const lines = errors.map(e => `  - ${e.entryTitle}: ${e.message}`).join('\n');
  return `Skill validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${lines}`;
}

export function formatEvalPassed(metrics: EvalRunStatus['aggregateMetrics'], runId: string): string {
  return [
    COMMENT_MARKER,
    `## ✅ Skill Evaluation: Passed`,
    '',
    `Pass rate: ${metrics.passRate}%`,
    `Run ID: ${runId}`,
  ].join('\n');
}

export function formatEvalFailed(metrics: EvalRunStatus['aggregateMetrics'], runId: string, blocking: boolean): string {
  const icon = blocking ? '❌' : '⚠️';
  const label = blocking ? 'Skill Evaluation: Failed' : 'Skill Evaluation: Warning';
  return [
    COMMENT_MARKER,
    `## ${icon} ${label}`,
    '',
    `Pass rate: ${metrics.passRate}%`,
    `Run ID: ${runId}`,
  ].join('\n');
}

export function formatEvalTimeout(runId: string, blocking: boolean): string {
  const icon = blocking ? '⏱' : '⚠️';
  return [
    COMMENT_MARKER,
    `## ${icon} Skill Evaluation: Timed Out`,
    '',
    `Run ID: ${runId}`,
  ].join('\n');
}

export function formatNoScenarios(tags: string[], blocking: boolean): string {
  const icon = blocking ? '❌' : '⚠️';
  return [
    COMMENT_MARKER,
    `## ${icon} Skill Evaluation: No Matching Scenarios`,
    '',
    `No scenarios matched tags: ${tags.map(t => `\`${t}\``).join(', ')}`,
  ].join('\n');
}

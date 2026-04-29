import type { ValidationError } from './yaml';
import type { EvalRunStatus } from './evalforge';

export const COMMENT_MARKER = '<!-- skill-eval-action -->';

export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = errors.map(e => `- **${e.entryTitle}**: ${e.message}`).join('\n');
  return [COMMENT_MARKER, '## ❌ Skill validation failed', '', lines].join('\n');
}

export function formatValidationPassed(): string {
  return `${COMMENT_MARKER}\n## ✅ Skill validation passed`;
}

export function formatServiceError(message: string): string {
  return `${COMMENT_MARKER}\n## ❌ Skill validation failed\n\n${message}`;
}

export function formatFailedJobMessage(errors: ValidationError[]): string {
  const lines = errors.map(e => `  - ${e.entryTitle}: ${e.message}`).join('\n');
  return `Skill validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${lines}`;
}

export function formatEvalPassed(metrics: EvalRunStatus['aggregateMetrics'], runId: string): string {
  return [
    COMMENT_MARKER,
    `## ✅ Eval passed — ${metrics.passed}/${metrics.totalAssertions} scenarios passed`,
    `📊 Pass rate: ${metrics.passRate}%`,
    `🔑 Run ID: ${runId}`,
  ].join('\n');
}

export function formatEvalFailed(metrics: EvalRunStatus['aggregateMetrics'], runId: string): string {
  return [
    COMMENT_MARKER,
    `## ❌ Eval failed — ${metrics.failed}/${metrics.totalAssertions} scenarios failed`,
    `📊 Pass rate: ${metrics.passRate}%`,
    `🔑 Run ID: ${runId}`,
  ].join('\n');
}

export function formatEvalTimeout(runId: string): string {
  return [
    COMMENT_MARKER,
    '## ⏱ Eval timed out after 30 minutes — check EvalForge for status',
    `🔑 Run ID: ${runId}`,
  ].join('\n');
}

export function formatNoScenarios(tags: string[]): string {
  return [
    COMMENT_MARKER,
    `## ❌ No eval scenarios found matching tags: ${tags.map(t => `\`${t}\``).join(', ')}`,
  ].join('\n');
}

import type { ValidationError } from './yaml';
import type { EvalRunStatus } from './evalforge';

export const COMMENT_MARKER = '<!-- skill-eval-action -->';

export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = errors.map(e => `- **${e.entryTitle}**: ${e.message}`).join('\n');
  return [COMMENT_MARKER, '## ❌ Skill validation failed', '', lines].join('\n');
}


export function formatServiceError(message: string): string {
  return `${COMMENT_MARKER}\n## ❌ Skill eval failed\n\n${message}`;
}

export function formatFailedJobMessage(errors: ValidationError[]): string {
  const lines = errors.map(e => `  - ${e.entryTitle}: ${e.message}`).join('\n');
  return `Skill validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${lines}`;
}

export function formatEvalPassed(metrics: EvalRunStatus['aggregateMetrics'], runId: string): string {
  return [
    COMMENT_MARKER,
    `## ✅ Eval passed — ${metrics.passed}/${metrics.totalAssertions} assertions passed`,
    `📊 Pass rate: ${metrics.passRate}%`,
    `🔑 Run ID: ${runId}`,
  ].join('\n');
}

export function formatEvalFailed(metrics: EvalRunStatus['aggregateMetrics'], runId: string): string {
  const parts = [];
  if (metrics.failed > 0) parts.push(`${metrics.failed} failed`);
  if (metrics.errors > 0) parts.push(`${metrics.errors} errors`);
  const summary = parts.length > 0 ? parts.join(', ') : 'unknown failure';
  return [
    COMMENT_MARKER,
    `## ❌ Eval failed — ${summary} out of ${metrics.totalAssertions} assertions`,
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

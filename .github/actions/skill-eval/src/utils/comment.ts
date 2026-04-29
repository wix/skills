import type { ValidationError } from './yaml';

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

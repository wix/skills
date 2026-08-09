import { isLlmJudge, isToolCall } from '@wix/evalforge-core';
import type { LoadedScenario } from './evals';

export type LintViolation = { name: string; path: string; rule: string; message: string };

/** Floor for numeric llm_judge minScore — below this a judge passes near-arbitrary output. */
export const MIN_SCORE_FLOOR = 6;

const QUESTION_PROMPT_RE = /^\s*(how\s+(do|can|would|should)\s+i\b|what\s+is\b|where\s+(do|can)\s+i\b)/i;

export function lintScenario(loaded: LoadedScenario): LintViolation[] {
  const { scenario: s, path } = loaded;
  const violations: LintViolation[] = [];
  const add = (rule: string, message: string) => violations.push({ name: s.name, path, rule, message });

  if (s.assertions.length < 3) {
    add('three-assertions', `has ${s.assertions.length} assertion(s); needs at least 3 (doc tool-call, correctness judge, quality judge)`);
  }

  const hasCoverage = s.assertions.some(a => isToolCall(a) && typeof a.params?.articleUrl === 'string');
  if (!hasCoverage) {
    add('coverage-assertion', 'missing a tool-call assertion with params.articleUrl on the skill doc URL');
  }

  const judges = s.assertions.filter(isLlmJudge);
  if (judges.length < 2) {
    add('two-llm-judges', `has ${judges.length} llm_judge assertion(s); needs at least 2 (correctness + quality)`);
  }
  for (const judge of judges) {
    if (judge.scoringMode !== 'boolean' && (judge.minScore === undefined || judge.minScore < MIN_SCORE_FLOOR)) {
      add('min-score-floor', `llm_judge minScore is ${judge.minScore ?? 'unset'}; numeric judges need minScore >= ${MIN_SCORE_FLOOR}`);
    }
    if (!/\bfail\b/i.test(judge.prompt)) {
      add('judge-fail-criteria', 'llm_judge prompt has no explicit fail criteria (must state what fails, not only what passes)');
    }
  }

  if (QUESTION_PROMPT_RE.test(s.triggerPrompt)) {
    add('task-shaped-prompt', 'triggerPrompt is question-shaped ("how do I…") — give the agent a task with concrete values instead');
  }

  if (s.maxTokens === undefined) {
    add('max-tokens', 'top-level maxTokens is unset — every scenario needs a token budget');
  }

  return violations;
}

export function lintChangedScenarios(
  scenarios: Map<string, LoadedScenario>,
  changedEvalPaths: Set<string>,
): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const loaded of scenarios.values()) {
    if (changedEvalPaths.has(loaded.path)) violations.push(...lintScenario(loaded));
  }
  return violations.sort((a, b) => a.name.localeCompare(b.name) || a.rule.localeCompare(b.rule));
}

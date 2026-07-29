import type { LoadError } from './load-scenarios';
import type { GuardViolation, GuardWarning } from './guard-scenarios';
import type { SyncError } from './plan-pr-scenario-sync';
import type { ScenarioSelection } from './select-scenarios';
import type { RunVerdict } from './evaluate-run-result';
import { parseDraftTag, type EvalRunStatus } from './evalforge';

export const GATE_COMMENT_MARKER = '<!-- evalforge-skill-gate-action -->';
const HEADING = 'EvalForge Skill Gate';

function render(icon: string, label: string, body: string[]): string {
  return [GATE_COMMENT_MARKER, `## ${icon} ${HEADING}: ${label}`, '', ...body].join('\n');
}

function failIcon(blocking: boolean): { icon: string; label: string } {
  return blocking ? { icon: '❌', label: 'Failed' } : { icon: '⚠️', label: 'Warning' };
}

function count(quantity: number, noun: string): string {
  return `${quantity} ${noun}${quantity === 1 ? '' : 's'}`;
}

/** The API sends a fraction of a percent (26/30 arrives as 86.667); nobody needs the decimals. */
function percent(passRate: number): number {
  return Math.round(passRate);
}

/** Shared by every outcome that has a run to point at. */
function runLine(runId: string, runUrl: string): string {
  return `**Run:** [${runId}](${runUrl})`;
}

/**
 * The three outcomes where nothing was verified and retrying is the answer. A push re-triggers the
 * gate today; CODEAI-895 adds a `/re-eval` comment so it does not need a commit.
 */
function retryNote(): string[] {
  return ['', '_Push any commit to run the gate again._'];
}

function soakNote(blocking: boolean): string[] {
  return blocking
    ? []
    : ['', '_The gate is in its soak period (`blocking: false`), so this check still passes._'];
}

function unmappedSection(unmapped: string[]): string[] {
  if (unmapped.length === 0) return [];
  return [
    '',
    '**Unmapped paths** — these changed under the skill directory but no rule covers them, so they triggered nothing. Add them to `ignore-globs` if that is correct:',
    ...unmapped.map(path => `- \`${path}\``),
  ];
}

function warningSection(warnings: GuardWarning[]): string[] {
  if (warnings.length === 0) return [];
  return [
    '',
    '**Existing scenarios below the quality bar** (not blocking — you did not write these, but they are worth fixing):',
    ...warnings.map(warning =>
      `- \`${warning.path}\` (\`${warning.name}\`, tagged ${warning.tags.map(tag => `\`${tag}\``).join(', ')}) — ${warning.reasons.join('; ')}`,
    ),
  ];
}

export function formatYamlErrors(errors: LoadError[], blocking: boolean): string {
  const { icon } = failIcon(blocking);
  return render(icon, 'Invalid Scenario YAML', [
    'These scenario files did not parse against the schema:',
    '',
    ...errors.map(error => `- \`${error.path}\`: ${error.message}`),
    ...soakNote(blocking),
  ]);
}

/**
 * The gate did not evaluate this PR. Said out loud because otherwise a green check is
 * indistinguishable from one that actually ran the scenarios.
 */
export function formatGateSkipped(reason: string): string {
  return render('⏭', 'Skipped', [
    `This PR was **not evaluated**: ${reason}`,
    '',
    'The check is green because the gate did not run, not because the scenarios passed.',
  ]);
}

export function formatNoGatedChanges(unmapped: string[]): string {
  return render('✅', 'No Gated Changes', [
    'Nothing in this PR maps to an eval tag, so no run was needed.',
    ...unmappedSection(unmapped),
  ]);
}

function violationLine(violation: GuardViolation, scenarioDir: string): string {
  switch (violation.kind) {
    case 'UNCOVERED_TAG': {
      const where = scenarioDir === '' ? 'the scenario directory' : `\`${scenarioDir}/\``;
      return `- **\`${violation.tag}\`** has no eval scenario at all. Add one under ${where} tagged \`${violation.tag}\`, or add that tag to a scenario that already exercises the area.`;
    }
    case 'WEAK_TAG':
      return `- **\`${violation.tag}\`** is carried only by scenarios below the quality bar (${violation.scenarios.map(name => `\`${name}\``).join(', ')}). Strengthen one of them, or add a scenario that meets the bar.`;
    case 'WEAK_TOUCHED_SCENARIO':
      return `- \`${violation.path}\` (\`${violation.name}\`) — ${violation.reasons.join('; ')}. This PR added or edited it, so it must meet the bar.`;
  }
}

export function formatGuardFailure(input: {
  violations: GuardViolation[];
  warnings: GuardWarning[];
  blocking: boolean;
  /** Named in the fix instructions, so an author is not left guessing where scenarios live. */
  scenarioDir: string;
}): string {
  const { icon, label } = failIcon(input.blocking);
  // Only when something here is actually about quality. On a bare uncovered tag there is no
  // scenario to be below the bar, and leading with it reads as though one was too weak.
  const aboutQuality = input.violations.some(violation => violation.kind !== 'UNCOVERED_TAG')
    || input.warnings.length > 0;
  return render(icon, `Coverage ${label}`, [
    ...(aboutQuality
      ? ['The quality bar is **at least 3 assertions including one `llm_judge`** — a scenario below it would run, pass, and verify nothing.', '']
      : []),
    ...input.violations.map(violation => violationLine(violation, input.scenarioDir)),
    '',
    '_No eval run was started — a coverage failure is caught before any run cost._',
    ...warningSection(input.warnings),
    ...soakNote(input.blocking),
  ]);
}

export function formatForeignDraftConflicts(errors: SyncError[], blocking: boolean): string {
  const { icon } = failIcon(blocking);
  return render(icon, 'Scenario Locked by Another PR', [
    'These scenarios are draft-tagged for other open PRs. Wait for those to merge or close, or coordinate with their authors:',
    '',
    ...errors.map(error => {
      const links = error.foreignTags.map(tag => {
        const draft = parseDraftTag(tag);
        return draft ? `https://github.com/${draft.repo}/pull/${draft.prNumber}` : tag;
      });
      return `- \`${error.name}\` is held by: ${links.join(', ')}`;
    }),
    ...soakNote(blocking),
  ]);
}

export function formatGateResult(input: {
  metrics: EvalRunStatus['aggregateMetrics'];
  verdict: RunVerdict;
  runId: string;
  runUrl: string;
  selection: ScenarioSelection;
  maxScenarios: number;
  warnings: GuardWarning[];
  unmapped: string[];
  broadImpact: boolean;
  blocking: boolean;
}): string {
  const { metrics, verdict, selection } = input;
  const { icon, label } = verdict.passed ? { icon: '✅', label: 'Passed' } : failIcon(input.blocking);

  const body: string[] = [
    `**Pass rate:** ${percent(metrics.passRate)}% — ${metrics.passed}/${metrics.totalAssertions} assertions passed`
    + (metrics.failed > 0 ? `, ${metrics.failed} failed` : '')
    + (metrics.errors > 0 ? `, ${metrics.errors} errored` : ''),
    runLine(input.runId, input.runUrl),
  ];

  if (!verdict.passed) {
    body.push('', `**Why this ${input.blocking ? 'blocks' : 'would block'}:** ${verdict.reasons.join('; ')}`);
  }

  body.push(
    '',
    input.broadImpact
      ? `**Scope:** a cross-cutting file changed, so the whole suite was in play — ${count(selection.selected.length, 'scenario')} ran.`
      : `**Scope:** ${count(selection.selected.length, 'scenario')} ran.`,
    '',
    ...selection.selected.map(name => `- \`${name}\``),
  );

  if (selection.dropped.length > 0) {
    body.push(
      '',
      `**Capped at \`max-scenarios: ${input.maxScenarios}\`** — these were not run:`,
      ...selection.dropped.map(name => `- \`${name}\``),
    );
  }

  if (selection.missingIds.length > 0) {
    body.push(
      '',
      '**Not run — no EvalForge scenario found for these names.** They are in the repo YAML but not in EvalForge, which points at a sync gap:',
      ...selection.missingIds.map(name => `- \`${name}\``),
    );
  }

  body.push(...warningSection(input.warnings), ...unmappedSection(input.unmapped));
  if (!verdict.passed) body.push(...soakNote(input.blocking));

  return render(icon, label, body);
}

export function formatGateTimeout(runId: string, runUrl: string, blocking: boolean): string {
  return render(blocking ? '⏱' : '⚠️', 'Timed Out', [
    'The eval run did not finish within the poll window. It may still be running in EvalForge.',
    '',
    runLine(runId, runUrl),
    ...retryNote(),
    ...soakNote(blocking),
  ]);
}

/**
 * Polling broke after the run started. Distinct from a service error, which has no run to name:
 * here the run exists and may well have finished, so the link is the whole point of the comment.
 */
export function formatGatePollFailure(input: {
  runId: string;
  runUrl: string;
  detail: string;
  blocking: boolean;
}): string {
  const { icon } = failIcon(input.blocking);
  return render(icon, 'Run Status Unavailable', [
    `The run started, but the gate could not read its status: ${input.detail}`,
    '',
    'Open it to see whether it finished — the gate could not verify the result either way, so treat this as unverified rather than passing.',
    '',
    runLine(input.runId, input.runUrl),
    ...retryNote(),
    ...soakNote(input.blocking),
  ]);
}

/**
 * `label` defaults to a service failure, the common case. The zero-selection guard passes its own:
 * nothing broke there, the gate simply had nothing to run, and that deserves saying in the heading.
 */
export function formatGateServiceError(message: string, blocking: boolean, label = 'Service Error'): string {
  const { icon } = failIcon(blocking);
  return render(icon, label, [message, ...retryNote(), ...soakNote(blocking)]);
}

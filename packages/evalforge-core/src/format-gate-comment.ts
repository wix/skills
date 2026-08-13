import type { LoadError } from './load-scenarios';
import type { GuardViolation, GuardWarning } from './guard-scenarios';
import type { SyncError } from './plan-pr-scenario-sync';
import type { ScenarioSelection } from './select-scenarios';
import type { RunVerdict } from './evaluate-run-result';
import { parseDraftTag, type EvalRunStatus } from './evalforge';
import type { ChangeImpact, ImpactClass, ScenarioImpact } from './classify-change-impact';

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
 * Only rendered above the default of 1: at 1, "ran once per arm" is the assumption a reader
 * already makes, and saying so on every comment would be noise. Above 1, it is exactly the
 * context that makes `newly-broken` interpretable — a reader cannot otherwise tell whether they
 * are looking at one execution or five, or that a single flaky iteration is enough to block.
 */
function runsPerScenarioNote(runsPerScenario: number | undefined): string[] {
  if (runsPerScenario === undefined || runsPerScenario <= 1) return [];
  return [
    '',
    `**Runs per scenario:** ${runsPerScenario} — each scenario ran ${runsPerScenario} times per arm, `
    + 'and any failing iteration counts as a failure.',
  ];
}

/**
 * The three outcomes where nothing was verified and retrying is the answer. These are live-system
 * flakes rather than PR problems, so `/re-eval` is listed first: it re-runs the gate without
 * asking for a commit the PR does not need.
 */
function retryNote(): string[] {
  return ['', '_Comment `/re-eval` to run the gate again, or push a new commit._'];
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

/**
 * Two `Record<ImpactClass, string>` maps rather than a switch: a new `ImpactClass` then fails to
 * compile here until it is given both an icon and a meaning, instead of silently rendering nothing.
 */
const IMPACT_ICON: Record<ImpactClass, string> = {
  fixed: '✅',
  'newly-broken': '❌',
  'still-passing': '➖',
  'still-failing': '⚠️',
  unattributed: '❔',
};

const IMPACT_MEANING: Record<ImpactClass, string> = {
  fixed: 'Failed against `main`, passes on this PR — this change fixed it.',
  'newly-broken': 'Passed against `main`, fails on this PR — caused by this change.',
  'still-passing': 'Passed on both `main` and this PR — unaffected by this change.',
  'still-failing': 'Fails on both `main` and this PR — pre-existing, not caused by this change.',
  unattributed: 'No comparable result from `main` to classify against.',
};

/** Assertion names come from the API and scenario names from repo YAML — neither is safe to render into a table cell unescaped. */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function failingAssertionsNote(failingAssertionNames: string[] | undefined): string {
  if (failingAssertionNames === undefined || failingAssertionNames.length === 0) return '';
  return ` Failing: ${failingAssertionNames.map(name => `\`${escapeTableCell(name)}\``).join(', ')}.`;
}

/**
 * Whether every scenario in an unavailable-attribution result came back with no `prPassed` at
 * all — i.e. the PR arm itself scored nothing, rather than the base arm being the gap. Built from
 * `ChangeImpact.scenarios`, which is already on hand at the call site, so this needs no new field.
 */
function prArmMeasuredNothing(scenarios: ScenarioImpact[]): boolean {
  return scenarios.every(scenario => scenario.prPassed === undefined);
}

/**
 * The section that reports the fixed/newly-broken/still-failing delta against `main`. Absent
 * `impact` means an old caller that has no comparison to offer — the section is skipped so its
 * output stays byte-identical to before this field existed. Once a caller does pass `impact`, a
 * failed base arm (`attributionAvailable: false`) still gets an explicit "unavailable" line rather
 * than silence, so it reads as "no comparison was attempted" rather than "nothing happened".
 */
function impactSection(impact: ChangeImpact | undefined): string[] {
  if (impact === undefined) return [];

  if (!impact.attributionAvailable) {
    // Whichever side produced nothing is named directly rather than defaulting to "the base run":
    // `attributionAvailable` is also false when the PR arm itself scored nothing, and blaming the
    // base run on a blocking comment sends the contributor to investigate the wrong side.
    const reason = prArmMeasuredNothing(impact.scenarios)
      ? 'this run produced no comparable results'
      : 'the base run produced no comparable results';
    return [
      '',
      `**Impact vs \`main\`:** unavailable — ${reason}, so scenarios could not be classified as fixed, newly broken, or pre-existing.`,
    ];
  }

  const summary = `**Impact vs \`main\`:** ${count(impact.fixed, 'scenario')} fixed, `
    + `${count(impact.newlyBroken, 'scenario')} newly broken, ${count(impact.stillPassing, 'scenario')} still passing, `
    + `${count(impact.stillFailing, 'scenario')} still failing, ${count(impact.unattributed, 'scenario')} unattributed`
    + ` — net effect ${impact.netEffect > 0 ? '+' : ''}${impact.netEffect}`;

  const allStillPassing = impact.scenarios.length > 0 && impact.stillPassing === impact.scenarios.length;
  if (allStillPassing) {
    return [
      '',
      summary,
      '',
      'Every scenario passed on both this PR and `main` — this change moved nothing measurable. '
      + 'That is the expected result for a PR that only touches scenario YAML: both arms then '
      + 'evaluate identical skill content, so the all-green summary above is not a suspicious no-op.',
    ];
  }

  return [
    '',
    summary,
    '',
    '| Scenario | Impact | Meaning |',
    '|---|---|---|',
    ...impact.scenarios.map(scenario => {
      const icon = IMPACT_ICON[scenario.impact];
      const meaning = IMPACT_MEANING[scenario.impact];
      return `| ${icon} \`${escapeTableCell(scenario.scenarioName)}\` | \`${scenario.impact}\` | ${meaning}${failingAssertionsNote(scenario.failingAssertionNames)} |`;
    }),
  ];
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
  impact?: ChangeImpact;
  runsPerScenario?: number;
}): string {
  const { metrics, verdict, selection } = input;
  const { icon, label } = verdict.passed ? { icon: '✅', label: 'Passed' } : failIcon(input.blocking);

  const body: string[] = [
    `**Pass rate:** ${percent(metrics.passRate)}% — ${metrics.passed}/${metrics.totalAssertions} assertions passed`
    + (metrics.failed > 0 ? `, ${metrics.failed} failed` : '')
    + (metrics.errors > 0 ? `, ${metrics.errors} errored` : ''),
    runLine(input.runId, input.runUrl),
    ...runsPerScenarioNote(input.runsPerScenario),
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

  body.push(...warningSection(input.warnings), ...unmappedSection(input.unmapped), ...impactSection(input.impact));
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

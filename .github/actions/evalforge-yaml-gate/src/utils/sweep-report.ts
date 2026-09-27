import type { Commenter } from '@wix/evalforge-core';
import { formatPrSweep } from './comment';
import type { MergedBy } from './merged-by';
import type { SweepVerdict } from './sweep-verdict';

/** The slice of `@actions/core` reporting needs — declared structurally so tests need no runner. */
export type ReportIo = {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  warning(message: string): void;
  info(message: string): void;
};

function writeCounts(verdict: Extract<SweepVerdict, { kind: 'failed' | 'passed' }>, io: ReportIo): void {
  if (verdict.kind === 'passed') {
    io.info('Sweep: all sampled scenarios passed');
    io.setOutput('confirmed-failed-count', '0');
    io.setOutput('recovered-count', String(verdict.recovered?.length ?? 0));
    return;
  }
  io.setOutput('confirm-skip-reason', verdict.skipNote);
  io.setOutput('confirmed-failed-count', String(verdict.confirmed.length));
  io.setOutput('recovered-count', String(verdict.recovered.length));
  io.setOutput(
    'confirmed-failed-scenarios',
    verdict.confirmed.map(v => `${v.scenarioName} (${v.reasons.join(', ')})`).join('\n'),
  );
  if (verdict.skipNote) io.warning(`Sweep: ${verdict.skipNote}`);
}

function confirmedFailureMessage(verdict: Extract<SweepVerdict, { kind: 'failed' }>, where: string): string {
  return `${verdict.confirmed.length} scenario(s) confirmed failed in ${where} (${verdict.confirmed.map(v => v.scenarioName).join(', ')})`;
}

/**
 * The merge sweep's report: step outputs for the workflow's Slack steps, and a red job on any
 * confirmed failure or infra error. The merging author is resolved only when there is a failure
 * to attribute — it is a GitHub API call the passing case has no use for.
 */
export async function reportMergeVerdict(
  verdict: SweepVerdict,
  io: ReportIo,
  resolveMergedBy: () => Promise<MergedBy>,
): Promise<void> {
  switch (verdict.kind) {
    case 'nothing-to-run':
      io.info(`Merge-tag sweep: ${verdict.reason} — nothing to run`);
      return;
    case 'infra-error':
      if (verdict.runUrl) io.setOutput('run-url', verdict.runUrl);
      io.setOutput('infra-error', verdict.message);
      io.setFailed(verdict.message);
      return;
    case 'passed':
      io.setOutput('run-url', verdict.runUrl);
      writeCounts(verdict, io);
      return;
    case 'failed': {
      io.setOutput('run-url', verdict.runUrl);
      writeCounts(verdict, io);
      const mergedBy = await resolveMergedBy();
      io.setOutput('merged-by-name', mergedBy.name);
      io.setOutput('merged-by-url', mergedBy.url);
      io.setFailed(confirmedFailureMessage(verdict, 'merge-tag sweep'));
    }
  }
}

/**
 * The PR sweep's report: one upserted PR comment, and the job goes red only once the sweep is
 * blocking. The count outputs are still written so a workflow can key steps off them, as the
 * merge sweep's does.
 */
export async function reportPrVerdict(
  verdict: SweepVerdict,
  io: ReportIo,
  comment: Commenter,
  opts: { blocking: boolean; versionLabel: string },
): Promise<void> {
  await comment(formatPrSweep(verdict, opts));
  switch (verdict.kind) {
    case 'nothing-to-run':
      io.info(`PR sweep: ${verdict.reason} — nothing to run`);
      return;
    case 'infra-error':
      if (verdict.runUrl) io.setOutput('run-url', verdict.runUrl);
      io.setOutput('infra-error', verdict.message);
      if (opts.blocking) io.setFailed(verdict.message);
      else io.warning(verdict.message);
      return;
    case 'passed':
      io.setOutput('run-url', verdict.runUrl);
      writeCounts(verdict, io);
      return;
    case 'failed': {
      io.setOutput('run-url', verdict.runUrl);
      writeCounts(verdict, io);
      const message = confirmedFailureMessage(verdict, 'PR sweep');
      if (opts.blocking) io.setFailed(message);
      else io.warning(message);
    }
  }
}

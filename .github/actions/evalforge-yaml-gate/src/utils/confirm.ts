/** One scenario's pass/fail outcome for one eval attempt. */
export type AttemptOutcome = { scenarioId: string; scenarioName: string; failed: boolean; reasons: string[] };

export type ConfirmVerdict = {
  scenarioId: string;
  scenarioName: string;
  attempts: number;
  failures: number;
  confirmed: boolean;
  reasons: string[];
};

export type ConfirmResult = { verdicts: ConfirmVerdict[]; retriesRun: number; retriesSkipped: boolean };

export const MAX_CONFIRM_RETRIES = 2;

/** Above this many initial failures, retries are skipped: broad failure is signal, not noise. */
export const MAX_RETRY_SCENARIOS = 10;

export async function confirmOnFail(
  initial: AttemptOutcome[],
  rerun: (scenarioIds: string[]) => Promise<AttemptOutcome[]>,
): Promise<ConfirmResult> {
  const failed = initial.filter(o => o.failed);
  if (failed.length === 0) return { verdicts: [], retriesRun: 0, retriesSkipped: false };

  const state = new Map(failed.map(o => [o.scenarioId, {
    scenarioId: o.scenarioId,
    scenarioName: o.scenarioName,
    attempts: 1,
    failures: 1,
    reasons: new Set(o.reasons),
  }]));

  if (failed.length > MAX_RETRY_SCENARIOS) {
    return {
      verdicts: finalize(state, () => true),
      retriesRun: 0,
      retriesSkipped: true,
    };
  }

  let pending = [...state.keys()];
  let retriesRun = 0;

  for (let retry = 0; retry < MAX_CONFIRM_RETRIES && pending.length > 0; retry++) {
    const results = new Map((await rerun(pending)).map(o => [o.scenarioId, o]));
    retriesRun++;
    const stillTied: string[] = [];
    for (const id of pending) {
      const s = state.get(id)!;
      const outcome = results.get(id);
      const failedAttempt = outcome ? outcome.failed : true;
      s.attempts++;
      if (failedAttempt) {
        s.failures++;
        for (const r of outcome?.reasons ?? ['missing-result']) s.reasons.add(r);
      }
      // Majority of 3: 2 failures confirms; a pass after 3 attempts recovers.
      if (s.failures < 2 && s.attempts <= MAX_CONFIRM_RETRIES) stillTied.push(id);
    }
    pending = stillTied;
  }

  return {
    verdicts: finalize(state, s => s.failures >= 2),
    retriesRun,
    retriesSkipped: false,
  };
}

function finalize(
  state: Map<string, { scenarioId: string; scenarioName: string; attempts: number; failures: number; reasons: Set<string> }>,
  isConfirmed: (s: { failures: number }) => boolean,
): ConfirmVerdict[] {
  return [...state.values()]
    .map(s => ({
      scenarioId: s.scenarioId,
      scenarioName: s.scenarioName,
      attempts: s.attempts,
      failures: s.failures,
      confirmed: isConfirmed(s),
      reasons: [...s.reasons],
    }))
    .sort((a, b) => a.scenarioName.localeCompare(b.scenarioName));
}

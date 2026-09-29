import type { ConfirmVerdict } from './confirm';

/** What one sweep found, independent of where it is reported (Slack for a merge, a PR comment for a PR). */
export type SweepVerdict =
  | { kind: 'nothing-to-run'; reason: string }
  /** The sweep itself could not run or did not complete — distinct from a scenario failing. */
  | { kind: 'infra-error'; message: string; runUrl?: string }
  /** `recovered` names scenarios that failed once and passed on retry — flaky, not regressed. */
  | { kind: 'passed'; tags: string[]; sampled: number; total: number; runUrl: string; recovered?: ConfirmVerdict[] }
  | {
    kind: 'failed';
    tags: string[];
    sampled: number;
    total: number;
    runUrl: string;
    confirmed: ConfirmVerdict[];
    recovered: ConfirmVerdict[];
    /** Set when retries were skipped: every verdict then rests on a single attempt. */
    skipNote: string;
  };

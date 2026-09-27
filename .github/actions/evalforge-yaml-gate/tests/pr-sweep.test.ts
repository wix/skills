import { describe, it, expect } from 'vitest';
import { shouldSweep } from '../src/utils/pr-sweep';
import {
  formatPrSweepPending, PR_SWEEP_MARKER, PR_SWEEP_PENDING_MARKER, PR_SWEEP_ACK_MARKER, COMMENT_MARKER,
} from '../src/utils/comment';
import { REVIEW_PENDING_MARKER, REVIEW_ACK_MARKER, REVIEW_COMMENT_MARKER } from '../src/utils/review-comment';

describe('shouldSweep', () => {
  // A push must not spend: the run exists so the required check is reported on the head, and
  // `/sweep` re-runs it. A re-run replays the same payload, so only the attempt number can tell
  // "someone asked" from "a commit was pushed".
  it('does not sweep on the first attempt, whatever the event', () => {
    expect(shouldSweep({ GITHUB_RUN_ATTEMPT: '1' })).toBe(false);
    expect(shouldSweep({})).toBe(false);
  });

  it('sweeps on a re-run', () => {
    expect(shouldSweep({ GITHUB_RUN_ATTEMPT: '2' })).toBe(true);
    expect(shouldSweep({ GITHUB_RUN_ATTEMPT: '3' })).toBe(true);
  });

  it('treats a malformed attempt as the first', () => {
    expect(shouldSweep({ GITHUB_RUN_ATTEMPT: 'abc' })).toBe(false);
  });
});

describe('formatPrSweepPending', () => {
  it('names the unswept commit and the command that sweeps it', () => {
    const body = formatPrSweepPending('abc1234def5678');
    expect(body).toContain(PR_SWEEP_PENDING_MARKER);
    expect(body).toContain('abc1234');
    expect(body).toContain('/sweep');
  });

  it('does not carry the result marker, so it never replaces a previous verdict', () => {
    expect(formatPrSweepPending('abc1234def5678')).not.toContain(PR_SWEEP_MARKER);
  });
});

describe('the sweep markers', () => {
  // Comments are matched by `includes`, so no marker may contain another — across the gate, the
  // review and the sweep, which all comment on the same PR.
  it('are distinct from one another and from the gate and review markers', () => {
    const markers = [
      PR_SWEEP_MARKER, PR_SWEEP_PENDING_MARKER, PR_SWEEP_ACK_MARKER,
      COMMENT_MARKER, REVIEW_PENDING_MARKER, REVIEW_ACK_MARKER, REVIEW_COMMENT_MARKER,
    ];
    for (const a of markers) {
      for (const b of markers) {
        if (a !== b) expect(a.includes(b)).toBe(false);
      }
    }
  });
});

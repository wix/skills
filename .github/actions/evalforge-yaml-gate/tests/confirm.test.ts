import { describe, expect, it, vi } from 'vitest';
import { confirmOnFail, MAX_RETRY_SCENARIOS, type AttemptOutcome } from '../src/utils/confirm';

const fail = (id: string, reasons = ['llm-judge']): AttemptOutcome =>
  ({ scenarioId: id, scenarioName: `name-${id}`, failed: true, reasons });
const pass = (id: string): AttemptOutcome =>
  ({ scenarioId: id, scenarioName: `name-${id}`, failed: false, reasons: [] });

describe('confirmOnFail', () => {
  it('makes no reruns when nothing failed initially', async () => {
    const rerun = vi.fn();
    const out = await confirmOnFail([pass('a'), pass('b')], rerun);
    expect(rerun).not.toHaveBeenCalled();
    expect(out.verdicts).toEqual([]);
    expect(out.retriesRun).toBe(0);
  });

  it('confirms a scenario that fails the first retry, without a third run', async () => {
    const rerun = vi.fn().mockResolvedValueOnce([fail('a')]);
    const out = await confirmOnFail([fail('a'), pass('b')], rerun);
    expect(rerun).toHaveBeenCalledTimes(1);
    expect(rerun).toHaveBeenCalledWith(['a']);
    expect(out.verdicts).toEqual([
      { scenarioId: 'a', scenarioName: 'name-a', attempts: 2, failures: 2, confirmed: true, reasons: ['llm-judge'] },
    ]);
  });

  it('recovers a scenario that passes both retries', async () => {
    const rerun = vi.fn()
      .mockResolvedValueOnce([pass('a')])
      .mockResolvedValueOnce([pass('a')]);
    const out = await confirmOnFail([fail('a')], rerun);
    expect(rerun).toHaveBeenCalledTimes(2);
    expect(out.verdicts[0]).toMatchObject({ scenarioId: 'a', attempts: 3, failures: 1, confirmed: false });
  });

  it('confirms a scenario that passes retry 1 but fails the tiebreak', async () => {
    const rerun = vi.fn()
      .mockResolvedValueOnce([pass('a')])
      .mockResolvedValueOnce([fail('a', ['token-budget'])]);
    const out = await confirmOnFail([fail('a')], rerun);
    expect(out.verdicts[0]).toMatchObject({ attempts: 3, failures: 2, confirmed: true });
    expect(out.verdicts[0].reasons.sort()).toEqual(['llm-judge', 'token-budget']);
  });

  it('retries only the still-tied ids on the tiebreak', async () => {
    const rerun = vi.fn()
      .mockResolvedValueOnce([fail('a'), pass('b')])   // a confirmed at 2/2, b tied 1-1
      .mockResolvedValueOnce([pass('b')]);
    const out = await confirmOnFail([fail('a'), fail('b')], rerun);
    expect(rerun).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(rerun).toHaveBeenNthCalledWith(2, ['b']);
    const byId = Object.fromEntries(out.verdicts.map(v => [v.scenarioId, v]));
    expect(byId['a'].confirmed).toBe(true);
    expect(byId['b'].confirmed).toBe(false);
  });

  it('skips retries above the scenario cap and confirms everything', async () => {
    const rerun = vi.fn();
    const many = Array.from({ length: MAX_RETRY_SCENARIOS + 1 }, (_, i) => fail(`s${i}`));
    const out = await confirmOnFail(many, rerun);
    expect(rerun).not.toHaveBeenCalled();
    expect(out.skipReason).toBe('broad-failure');
    expect(out.verdicts.every(v => v.confirmed && v.attempts === 1)).toBe(true);
  });

  it('treats an id missing from a rerun result as a failed attempt', async () => {
    const rerun = vi.fn().mockResolvedValueOnce([]);
    const out = await confirmOnFail([fail('a')], rerun);
    expect(out.verdicts[0].confirmed).toBe(true);
    expect(out.verdicts[0].reasons).toContain('missing-result');
  });
});

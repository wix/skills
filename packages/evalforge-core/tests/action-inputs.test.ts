import { describe, it, expect, vi } from 'vitest';
import { ensureHttps, safeGetSecret, getPrNumber } from '../src/action-inputs';

const io = () => ({ getInput: vi.fn(), setSecret: vi.fn(), warning: vi.fn() });

describe('getPrNumber', () => {
  it('reads a pull_request payload', () => {
    expect(getPrNumber({ pull_request: { number: 42 } })).toBe(42);
  });

  it('reads an issue_comment payload on a PR', () => {
    expect(getPrNumber({
      issue: { number: 42, pull_request: { url: 'https://api.github.com/repos/wix/skills/pulls/42' } },
    })).toBe(42);
  });

  // `issue_comment` fires for plain issues too. Treating one as a PR would send the dispatcher
  // looking for a gate run on an issue number.
  it('rejects an issue_comment on a non-PR issue', () => {
    expect(() => getPrNumber({ issue: { number: 42 } })).toThrow(/pull request/i);
  });

  it('rejects a payload that is neither', () => {
    expect(() => getPrNumber({})).toThrow(/pull_request/);
  });

  it('rejects a pull_request payload with no number', () => {
    expect(() => getPrNumber({ pull_request: {} })).toThrow(/pull_request/);
  });
});

describe('ensureHttps', () => {
  it('passes an https URL through untouched', () => {
    const actions = io();
    expect(ensureHttps(actions, 'https://www.wixapis.com/evalforge')).toBe('https://www.wixapis.com/evalforge');
    expect(actions.warning).not.toHaveBeenCalled();
  });

  it('upgrades http and warns', () => {
    const actions = io();
    expect(ensureHttps(actions, 'http://internal/evalforge')).toBe('https://internal/evalforge');
    expect(actions.warning).toHaveBeenCalled();
  });
});

describe('safeGetSecret', () => {
  it('registers the value for log masking', () => {
    const actions = io();
    actions.getInput.mockReturnValue('s3cret');

    expect(safeGetSecret(actions, 'app-secret')).toBe('s3cret');
    expect(actions.setSecret).toHaveBeenCalledWith('s3cret');
  });
});

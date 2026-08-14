import { describe, it, expect, vi } from 'vitest';
import { ensureHttps, safeGetSecret, getPrNumber } from '../src/action-inputs';

const io = () => ({ getInput: vi.fn(), setSecret: vi.fn(), warning: vi.fn() });

describe('getPrNumber', () => {
  it('reads a pull_request payload', () => {
    expect(getPrNumber({ pull_request: { number: 42 } })).toBe(42);
  });

  it('rejects a payload with no pull_request', () => {
    expect(() => getPrNumber({})).toThrow(/pull_request/);
  });

  it('rejects a pull_request payload with no number', () => {
    expect(() => getPrNumber({ pull_request: {} })).toThrow(/missing number/);
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

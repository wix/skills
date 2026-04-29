import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({ getInput: vi.fn(), setSecret: vi.fn() }));
vi.mock('@actions/github', () => ({
  context: {
    payload: {
      pull_request: {
        number: 42,
        base: { sha: 'base-sha-123' },
      },
    },
    repo: { owner: 'wix', repo: 'skills' },
  },
}));

import * as core from '@actions/core';
import { getConfig } from '../src/utils/config';

const ALL_INPUTS: Record<string, string> = {
  'github-token': 'ghs_token',
  'evalforge-url': 'https://ef.example.com/api',
  'evalforge-project-id': 'proj-1',
  'evalforge-agent-id': 'agent-1',
  'evalforge-app-id': 'app-1',
  'evalforge-app-secret': 'secret-1',
};

beforeEach(() => {
  vi.mocked(core.getInput).mockImplementation((name: string) => ALL_INPUTS[name] ?? '');
});

describe('getConfig', () => {
  it('returns config with all fields populated', () => {
    const config = getConfig();
    expect(config.githubToken).toBe('ghs_token');
    expect(config.evalforgeUrl).toBe('https://ef.example.com/api');
    expect(config.projectId).toBe('proj-1');
    expect(config.agentId).toBe('agent-1');
    expect(config.appId).toBe('app-1');
    expect(config.appSecret).toBe('secret-1');
    expect(config.prNumber).toBe(42);
    expect(config.baseSha).toBe('base-sha-123');
    expect(config.owner).toBe('wix');
    expect(config.repo).toBe('skills');
  });

  it('masks all secret inputs', () => {
    getConfig();
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('ghs_token');
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('app-1');
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('secret-1');
  });

  it('throws when a required input is missing', () => {
    vi.mocked(core.getInput).mockImplementation((name, opts) => {
      if (name === 'evalforge-url') {
        if (opts?.required) throw new Error('Input required and not supplied: evalforge-url');
        return '';
      }
      return ALL_INPUTS[name] ?? '';
    });
    expect(() => getConfig()).toThrow('evalforge-url');
  });
});

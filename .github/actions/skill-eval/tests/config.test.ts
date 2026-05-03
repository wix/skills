import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({ getInput: vi.fn(), setSecret: vi.fn(), warning: vi.fn() }));
vi.mock('@actions/github', () => ({
  context: {
    payload: {
      pull_request: {
        number: 42,
        base: { sha: 'base-sha-123' },
        head: { sha: 'head-sha-456' },
      },
    },
    repo: { owner: 'wix', repo: 'skills' },
  },
}));

import * as core from '@actions/core';
import { getEvalConfig, getCleanupConfig } from '../src/utils/config';

const ALL_INPUTS: Record<string, string> = {
  'github-token': 'ghs_token',
  'evalforge-url': 'https://ef.example.com/api',
  'evalforge-project-id': 'proj-1',
  'evalforge-agent-id': 'agent-1',
  'evalforge-mcp-id': 'mcp-1',
  'evalforge-app-id': 'app-1',
  'evalforge-app-secret': 'secret-1',
  'blocking': 'true',
};

beforeEach(() => {
  vi.mocked(core.getInput).mockImplementation((name: string) => ALL_INPUTS[name] ?? '');
});

describe('getEvalConfig', () => {
  it('returns config with all fields populated', () => {
    const config = getEvalConfig();
    expect(config.githubToken).toBe('ghs_token');
    expect(config.evalforgeUrl).toBe('https://ef.example.com/api');
    expect(config.projectId).toBe('proj-1');
    expect(config.agentId).toBe('agent-1');
    expect(config.mcpId).toBe('mcp-1');
    expect(config.appId).toBe('app-1');
    expect(config.appSecret).toBe('secret-1');
    expect(config.prNumber).toBe(42);
    expect(config.baseSha).toBe('base-sha-123');
    expect(config.headSha).toBe('head-sha-456');
    expect(config.owner).toBe('wix');
    expect(config.repo).toBe('skills');
  });

  it('masks all secret inputs', () => {
    getEvalConfig();
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('ghs_token');
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('app-1');
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('secret-1');
  });

  it('blocking is true when input is "true"', () => {
    expect(getEvalConfig().blocking).toBe(true);
  });

  it('blocking is false when input is "false"', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => ({ ...ALL_INPUTS, blocking: 'false' }[name] ?? ''));
    expect(getEvalConfig().blocking).toBe(false);
  });

  it('blocking is true when input is absent (empty string)', () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => ({ ...ALL_INPUTS, blocking: '' }[name] ?? ''));
    expect(getEvalConfig().blocking).toBe(true);
  });

  it('throws when a required input is missing', () => {
    vi.mocked(core.getInput).mockImplementation((name, opts) => {
      if (name === 'evalforge-url') {
        if (opts?.required) throw new Error('Input required and not supplied: evalforge-url');
        return '';
      }
      return ALL_INPUTS[name] ?? '';
    });
    expect(() => getEvalConfig()).toThrow('evalforge-url');
  });
});

describe('getCleanupConfig', () => {
  it('returns cleanup config with required fields', () => {
    const config = getCleanupConfig();
    expect(config.evalforgeUrl).toBe('https://ef.example.com/api');
    expect(config.projectId).toBe('proj-1');
    expect(config.mcpId).toBe('mcp-1');
    expect(config.appId).toBe('app-1');
    expect(config.appSecret).toBe('secret-1');
    expect(config.prNumber).toBe(42);
  });

  it('does not include agentId, blocking, baseSha, headSha, owner, or repo', () => {
    const config = getCleanupConfig();
    expect(config).not.toHaveProperty('agentId');
    expect(config).not.toHaveProperty('blocking');
    expect(config).not.toHaveProperty('baseSha');
    expect(config).not.toHaveProperty('owner');
  });

  it('masks app-id and app-secret', () => {
    vi.mocked(core.setSecret).mockReset();
    getCleanupConfig();
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('app-1');
    expect(vi.mocked(core.setSecret)).toHaveBeenCalledWith('secret-1');
  });
});

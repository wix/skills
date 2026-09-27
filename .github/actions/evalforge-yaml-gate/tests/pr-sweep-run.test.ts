import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import type { SweepVerdict } from '../src/utils/sweep-verdict';

// `vi.hoisted` because `vi.mock` is hoisted above these declarations.
const { sweep, resolveSweepTags, upsert, postPending, clearPending, clearAck } = vi.hoisted(() => ({
  sweep: vi.fn<() => Promise<SweepVerdict>>(),
  resolveSweepTags: vi.fn<() => { tags: string[] } | { reason: string }>(),
  upsert: vi.fn<(body: string) => Promise<void>>(),
  postPending: vi.fn<(body: string) => Promise<void>>(),
  clearPending: vi.fn<() => Promise<void>>(),
  clearAck: vi.fn<() => Promise<void>>(),
}));

vi.mock('../src/utils/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/github')>();
  return {
    ...actual,
    makeSweepCommenter: () => upsert,
    makeSweepPendingCommenter: () => ({ post: postPending, clear: clearPending, clearAck }),
  };
});

vi.mock('../src/utils/merge-tag-sweep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/merge-tag-sweep')>();
  return { ...actual, sweep, resolveSweepTags };
});

vi.mock('@actions/github', () => ({
  getOctokit: () => ({}),
  context: {
    repo: { owner: 'wix', repo: 'skills' },
    payload: { pull_request: { number: 42, head: { sha: 'abc1234def5678' } } },
  },
}));

import { runPrSweep } from '../src/utils/pr-sweep';
import { PR_SWEEP_PENDING_MARKER, PR_SWEEP_MARKER } from '../src/utils/comment';

const INPUTS: Record<string, string> = {
  'INPUT_GITHUB-TOKEN': 'gh-token',
  'INPUT_EVALFORGE-URL': 'https://evalforge.example',
  'INPUT_EVALFORGE-PROJECT-ID': 'proj-1',
  'INPUT_EVALFORGE-AGENT-ID': 'agent-1',
  'INPUT_EVALFORGE-MCP-ID': 'mcp-1',
  'INPUT_EVALFORGE-APP-ID': 'app-1',
  'INPUT_EVALFORGE-APP-SECRET': 'secret-1',
  'INPUT_CHANGED-FILES': 'M\tskills/wix-manage/references/blog/blog-dashboard-navigation.md',
};

const PASSED: SweepVerdict = { kind: 'passed', tags: ['blog'], sampled: 7, total: 7, runUrl: 'https://evalforge/run/1' };

let setFailed: ReturnType<typeof vi.spyOn>;
let warning: ReturnType<typeof vi.spyOn>;

function setInputs(extra: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries({ ...INPUTS, ...extra })) process.env[k] = v;
}

beforeEach(() => {
  vi.clearAllMocks();
  setInputs();
  process.env.GITHUB_RUN_ATTEMPT = '1';
  resolveSweepTags.mockReturnValue({ tags: ['blog'] });
  sweep.mockResolvedValue(PASSED);
  upsert.mockResolvedValue();
  postPending.mockResolvedValue();
  clearPending.mockResolvedValue();
  setFailed = vi.spyOn(core, 'setFailed').mockImplementation(() => {});
  warning = vi.spyOn(core, 'warning').mockImplementation(() => {});
  vi.spyOn(core, 'info').mockImplementation(() => {});
  vi.spyOn(core, 'setOutput').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of [...Object.keys(INPUTS), 'INPUT_REQUIRED', 'INPUT_BLOCKING', 'INPUT_REMIND']) delete process.env[k];
  delete process.env.GITHUB_RUN_ATTEMPT;
  vi.restoreAllMocks();
});

describe('runPrSweep — first attempt, a push', () => {
  it('never spends on EvalForge', async () => {
    await runPrSweep();
    expect(sweep).not.toHaveBeenCalled();
  });

  // The workflow has no paths filter, so it runs on every PR in the repo. A PR the sweep would
  // have nothing to run for must look exactly as if the workflow did not exist.
  describe('on a PR that touches nothing a sweep covers', () => {
    beforeEach(() => resolveSweepTags.mockReturnValue({ reason: 'no eval-relevant tags in PR #42' }));

    it('posts nothing and warns nothing', async () => {
      await runPrSweep();
      expect(postPending).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
    });

    it('stays green even when the sweep is required', async () => {
      setInputs({ INPUT_REQUIRED: 'true', INPUT_BLOCKING: 'true' });
      await runPrSweep();
      expect(setFailed).not.toHaveBeenCalled();
    });

    it('clears a reminder left from an earlier commit that did touch covered content', async () => {
      await runPrSweep();
      expect(clearPending).toHaveBeenCalled();
    });
  });

  describe('on a PR the sweep covers', () => {
    it('posts no comment while reminders are off, which is the default', async () => {
      await runPrSweep();
      expect(postPending).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('posts the reminder once reminders are on', async () => {
      setInputs({ INPUT_REMIND: 'true' });
      await runPrSweep();
      expect(postPending).toHaveBeenCalledTimes(1);
      expect(postPending.mock.calls[0][0]).toContain(PR_SWEEP_PENDING_MARKER);
    });

    it('stays green when the sweep is not required', async () => {
      await runPrSweep();
      expect(setFailed).not.toHaveBeenCalled();
    });

    it('goes red, naming the command, when the sweep is required', async () => {
      setInputs({ INPUT_REQUIRED: 'true' });
      await runPrSweep();
      expect(setFailed).toHaveBeenCalledTimes(1);
      expect(String(setFailed.mock.calls[0][0])).toContain('/sweep');
    });
  });
});

describe('runPrSweep — a re-run, which is what /sweep does', () => {
  beforeEach(() => { process.env.GITHUB_RUN_ATTEMPT = '2'; });

  it('sweeps and posts the verdict', async () => {
    await runPrSweep();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toContain(PR_SWEEP_MARKER);
  });

  it('clears the reminder and the acknowledgement once the verdict is posted', async () => {
    await runPrSweep();
    expect(clearPending).toHaveBeenCalled();
  });
});

describe('runPrSweep — a configuration error', () => {
  // The check must be red only when someone turned a dial on. With both off, a broken repo
  // variable warns and passes, so it cannot block every PR in the repo.
  beforeEach(() => { delete process.env['INPUT_EVALFORGE-MCP-ID']; });

  it('warns and stays green when neither required nor blocking is on', async () => {
    await runPrSweep();
    expect(setFailed).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('evalforge-mcp-id'));
  });

  it('goes red when the sweep is required', async () => {
    setInputs({ INPUT_REQUIRED: 'true' });
    delete process.env['INPUT_EVALFORGE-MCP-ID'];
    await runPrSweep();
    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('evalforge-mcp-id'));
  });

  it('goes red when the sweep is blocking', async () => {
    setInputs({ INPUT_BLOCKING: 'true' });
    delete process.env['INPUT_EVALFORGE-MCP-ID'];
    await runPrSweep();
    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('evalforge-mcp-id'));
  });
});

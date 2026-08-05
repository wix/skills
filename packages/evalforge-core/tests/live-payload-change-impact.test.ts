import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvalForgeClient } from '../src/evalforge';
import { foldScenarioIterations } from '../src/fold-scenario-iterations';
import { classifyChangeImpact } from '../src/classify-change-impact';

// End-to-end check on the real captured payloads (see fixtures/live-eval-run-*-arm.json):
// getEvalRun → foldScenarioIterations → classifyChangeImpact, exactly the pipeline the
// gate runs on a real comparison. Before the ASSERTION_RESULT_STATUS_ prefix fix, every
// assertion in these fixtures mapped to ERROR, so every scenario was 'still-failing' and
// the comment's failing list wrongly named all six distinct assertions (including two that
// passed: "Skill was called" x2). This test pins the correct outcome: the four assertions
// that actually failed, in either arm.
describe('live payload — change impact end to end', () => {
  const LIVE_PR_ARM_BODY = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/live-eval-run-pr-arm.json'), 'utf8'),
  );
  const LIVE_BASE_ARM_BODY = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/live-eval-run-base-arm.json'), 'utf8'),
  );

  function mockFetchReturning(body: unknown) {
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 300 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }

  it('classifies the real scenario as still-failing but blames only the four assertions that genuinely failed', async () => {
    const client = new EvalForgeClient('https://example.test', 'cid', 'csec');

    mockFetchReturning(LIVE_PR_ARM_BODY);
    const prStatus = await client.getEvalRun('proj-1', 'run-pr');
    mockFetchReturning(LIVE_BASE_ARM_BODY);
    const baseStatus = await client.getEvalRun('proj-1', 'run-base');

    const prOutcomes = foldScenarioIterations(prStatus.results);
    const baseOutcomes = foldScenarioIterations(baseStatus.results);
    const impact = classifyChangeImpact(prOutcomes, baseOutcomes);

    expect(impact.scenarios).toHaveLength(1);
    expect(impact.scenarios[0].impact).toBe('still-failing');
    // Exactly the four names that genuinely failed in at least one arm — not all six
    // distinct assertion names (which is what the ERROR-fallback bug would have produced,
    // since it counted every passing assertion as a failure too).
    expect(impact.scenarios[0].failingAssertionNames).toEqual([
      'NOT: Skill was called',
      'Build passed',
      'Time limit',
      'Cost',
    ]);
  });
});

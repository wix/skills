import { describe, it, expect } from 'vitest';
import { toEvalForgeBody, type ScenarioAssertionLink } from '../src/utils/evalforge-mapper';
import type { Scenario } from '../src/utils/schema';

const scenario: Scenario = {
  name: 'blog/how-to-create-blog-posts',
  description: 'Create and publish a blog post.',
  triggerPrompt: 'Create a blog post titled Hello',
  tags: ['blog'],
  assertions: [
    {
      tool: 'wix_mcp_remote_ReadFullDocsArticle',
      params: { articleUrl: 'https://dev.wix.com/foo' },
    },
    {
      tool: 'wix_mcp_remote_CallWixSiteAPI',
      params: { url: 'https://www.wixapis.com/blog/v3/draft-posts', method: 'POST' },
    },
  ],
};

function linkByType(links: ScenarioAssertionLink[], systemId: string): ScenarioAssertionLink {
  const link = links.find(l => l.assertionId === systemId);
  if (!link) throw new Error(`no link with assertionId=${systemId}`);
  return link;
}

describe('toEvalForgeBody', () => {
  it('maps top-level fields', () => {
    const body = toEvalForgeBody(scenario);
    expect(body.name).toBe(scenario.name);
    expect(body.description).toBe(scenario.description);
    expect(body.triggerPrompt).toBe(scenario.triggerPrompt);
  });

  it('drops the YAML-only tags field (handled separately by sync)', () => {
    expect(toEvalForgeBody(scenario)).not.toHaveProperty('tags');
  });

  it('produces assertionLinks pointing at system:tool_called_with_param', () => {
    const body = toEvalForgeBody(scenario);
    expect(body.assertionLinks).toHaveLength(2);
    for (const l of body.assertionLinks) {
      expect(l.assertionId).toBe('system:tool_called_with_param');
      expect(l.params).toBeDefined();
    }
  });

  it('JSON-stringifies params into expectedParams string', () => {
    const [first] = toEvalForgeBody(scenario).assertionLinks;
    expect(first.params?.toolName).toBe('wix_mcp_remote_ReadFullDocsArticle');
    expect(typeof first.params?.expectedParams).toBe('string');
    expect(JSON.parse(String(first.params?.expectedParams))).toEqual({ articleUrl: 'https://dev.wix.com/foo' });
  });

  it('handles assertions with no params (empty object)', () => {
    const noParams: Scenario = { ...scenario, assertions: [{ tool: 't' }] };
    const [l] = toEvalForgeBody(noParams).assertionLinks;
    expect(JSON.parse(String(l.params?.expectedParams))).toEqual({});
  });

  it('maps llm_judge with minimal fields (prompt only)', () => {
    const judge: Scenario = {
      ...scenario,
      assertions: [{ type: 'llm_judge', prompt: 'judge {{output}}' }],
    };
    const [l] = toEvalForgeBody(judge).assertionLinks;
    expect(l).toEqual({
      assertionId: 'system:llm_judge',
      params: { prompt: 'judge {{output}}' },
    });
  });

  it('maps llm_judge with optional fields (only sets the ones provided)', () => {
    const judge: Scenario = {
      ...scenario,
      assertions: [{
        type: 'llm_judge',
        prompt: 'judge {{output}}',
        minScore: 8,
        model: 'claude-3-5-haiku-20241022',
        maxTokens: 2048,
        temperature: 0.2,
      }],
    };
    const [l] = toEvalForgeBody(judge).assertionLinks;
    expect(l).toEqual({
      assertionId: 'system:llm_judge',
      params: {
        prompt: 'judge {{output}}',
        minScore: 8,
        model: 'claude-3-5-haiku-20241022',
        maxTokens: 2048,
        temperature: 0.2,
      },
    });
  });

  it('mixes tool_called_with_param + llm_judge in one scenario', () => {
    const mixed: Scenario = {
      ...scenario,
      assertions: [
        { tool: 'wix_mcp_remote_X', params: { url: 'https://x' } },
        { type: 'llm_judge', prompt: 'judge' },
      ],
    };
    const body = toEvalForgeBody(mixed);
    expect(body.assertionLinks.map(l => l.assertionId)).toEqual([
      'system:tool_called_with_param',
      'system:llm_judge',
    ]);
  });

  it('maps api_call: stringifies object expectedResponse, passes string through', () => {
    const objExpected: Scenario = {
      ...scenario,
      assertions: [{
        type: 'api_call',
        url: 'https://x',
        expectedResponse: { ok: true },
      }],
    };
    const l1 = linkByType(toEvalForgeBody(objExpected).assertionLinks, 'system:api_call');
    expect(l1.params?.expectedResponse).toBe('{"ok":true}');

    const stringExpected: Scenario = {
      ...scenario,
      assertions: [{
        type: 'api_call',
        url: 'https://x',
        expectedResponse: '{"ok":true}',
      }],
    };
    const l2 = linkByType(toEvalForgeBody(stringExpected).assertionLinks, 'system:api_call');
    expect(l2.params?.expectedResponse).toBe('{"ok":true}');
  });

  it('maps api_call: emits all optional fields when set', () => {
    const full: Scenario = {
      ...scenario,
      assertions: [{
        type: 'api_call',
        url: 'https://x',
        method: 'POST',
        requestBody: { k: 'v' },
        expectedResponse: { ok: true },
        requestHeaders: { Authorization: 'Bearer y' },
        timeoutMs: 5000,
        negate: false,
      }],
    };
    const [l] = toEvalForgeBody(full).assertionLinks;
    expect(l).toEqual({
      assertionId: 'system:api_call',
      params: {
        url: 'https://x',
        method: 'POST',
        requestBody: '{"k":"v"}',
        expectedResponse: '{"ok":true}',
        requestHeaders: '{"Authorization":"Bearer y"}',
        timeoutMs: 5000,
        negate: false,
      },
    });
  });

  it('maps cost', () => {
    const c: Scenario = {
      ...scenario,
      assertions: [{ type: 'cost', maxCostUsd: 0.5 }],
    };
    const [l] = toEvalForgeBody(c).assertionLinks;
    expect(l).toEqual({ assertionId: 'system:cost', params: { maxCostUsd: 0.5 } });
  });

  it('maps time_limit', () => {
    const t: Scenario = {
      ...scenario,
      assertions: [{ type: 'time_limit', maxDurationMs: 60_000, negate: true }],
    };
    const [l] = toEvalForgeBody(t).assertionLinks;
    expect(l).toEqual({
      assertionId: 'system:time_limit',
      params: { maxDurationMs: 60_000, negate: true },
    });
  });

  it('omits siteSetup when the scenario has none', () => {
    expect(toEvalForgeBody(scenario)).not.toHaveProperty('siteSetup');
  });

  it('maps a template siteSetup (mode + templateId, no bootstrap)', () => {
    const s: Scenario = { ...scenario, siteSetup: { mode: 'template', templateId: 'ecommerce' } };
    expect(toEvalForgeBody(s).siteSetup).toEqual({ mode: 'template', templateId: 'ecommerce' });
  });

  it('omits bootstrap when steps is empty (matches EvalForge normalization)', () => {
    const s: Scenario = {
      ...scenario,
      siteSetup: { mode: 'template', templateId: 'ecommerce', bootstrap: { steps: [] } },
    };
    expect(toEvalForgeBody(s).siteSetup).toEqual({ mode: 'template', templateId: 'ecommerce' });
  });

  it('maps bootstrap steps through, dropping undefined optionals', () => {
    const s: Scenario = {
      ...scenario,
      siteSetup: {
        mode: 'template',
        templateId: 'ecommerce',
        bootstrap: { steps: [{ method: 'post', url: 'https://x', body: { a: 1 } }] },
      },
    };
    expect(toEvalForgeBody(s).siteSetup).toEqual({
      mode: 'template',
      templateId: 'ecommerce',
      bootstrap: { steps: [{ method: 'post', url: 'https://x', body: { a: 1 } }] },
    });
  });
});

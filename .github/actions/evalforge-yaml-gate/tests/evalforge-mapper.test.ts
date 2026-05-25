import { describe, it, expect } from 'vitest';
import { toEvalForgeBody } from '../src/utils/evalforge-mapper';
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

  it('produces flat tool_called_with_param assertions (no config wrapper, no name/description)', () => {
    const body = toEvalForgeBody(scenario);
    expect(body.assertions).toHaveLength(2);
    for (const a of body.assertions) {
      expect(a.type).toBe('tool_called_with_param');
      // EvalForge schema is strictObject — extra keys would be rejected.
      expect(a).not.toHaveProperty('name');
      expect(a).not.toHaveProperty('description');
      expect(a).not.toHaveProperty('config');
    }
  });

  it('JSON-stringifies params into top-level expectedParams string', () => {
    const [first] = toEvalForgeBody(scenario).assertions;
    expect(first.toolName).toBe('wix_mcp_remote_ReadFullDocsArticle');
    expect(typeof first.expectedParams).toBe('string');
    expect(JSON.parse(first.expectedParams)).toEqual({ articleUrl: 'https://dev.wix.com/foo' });
  });

  it('handles assertions with no params (empty object)', () => {
    const noParams: Scenario = { ...scenario, assertions: [{ tool: 't' }] };
    const [a] = toEvalForgeBody(noParams).assertions;
    expect(JSON.parse(a.expectedParams)).toEqual({});
  });
});

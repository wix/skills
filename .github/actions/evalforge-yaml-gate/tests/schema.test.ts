import { describe, it, expect } from 'vitest';
import { ScenarioSchema, parseScenario } from '../src/utils/schema';

const minimalYaml = `
name: blog/create-and-publish-post
description: "Create a blog post"
triggerPrompt: "Create a blog post titled Hello"
tags: [blog]
assertions:
  - tool: wix_mcp_remote_ReadFullDocsArticle
    params:
      articleUrl: https://dev.wix.com/foo
`;

describe('parseScenario', () => {
  it('parses a valid scenario', () => {
    const s = parseScenario(minimalYaml);
    expect(s.name).toBe('blog/create-and-publish-post');
    expect(s.tags).toEqual(['blog']);
    expect(s.assertions).toHaveLength(1);
  });
  it('rejects missing required fields', () => {
    expect(() => parseScenario('name: foo')).toThrow();
  });
  it('requires tags to be non-empty', () => {
    expect(() => parseScenario(minimalYaml.replace('tags: [blog]', 'tags: []'))).toThrow(/tags/);
  });
  it('rejects draft:* in tags', () => {
    expect(() => parseScenario(minimalYaml.replace('tags: [blog]', 'tags: [blog, "draft:wix/skills#1"]'))).toThrow(/draft|reserved/i);
  });
  it('rejects pending:* in tags', () => {
    expect(() => parseScenario(minimalYaml.replace('tags: [blog]', 'tags: [blog, "pending:wix/skills#1"]'))).toThrow(/pending|reserved/i);
  });
  it('rejects rejected:* in tags', () => {
    expect(() => parseScenario(minimalYaml.replace('tags: [blog]', 'tags: [blog, "rejected:wix/skills#1"]'))).toThrow(/rejected|reserved/i);
  });
  it('rejects empty assertions', () => {
    expect(() => parseScenario(minimalYaml.replace(/assertions:[\s\S]*$/, 'assertions: []'))).toThrow(/assertions/);
  });
  it('rejects names with invalid chars', () => {
    expect(() => parseScenario(minimalYaml.replace('blog/create-and-publish-post', 'BLOG Foo'))).toThrow(/name/);
  });
  it('rejects nested object params (Phase 1)', () => {
    const yaml = minimalYaml + `      body:\n        foo: bar\n`;
    expect(() => parseScenario(yaml)).toThrow(/nested/);
  });
  it('accepts array params (contains-matcher)', () => {
    const yaml = minimalYaml.replace('articleUrl: https://dev.wix.com/foo',
      'sourceDocUrls:\n        - https://dev.wix.com/foo');
    expect(() => parseScenario(yaml)).not.toThrow();
  });

  it('accepts an llm_judge assertion with minimal fields', () => {
    const yaml = minimalYaml.replace(
      /assertions:[\s\S]*$/,
      `assertions:\n  - type: llm_judge\n    prompt: "Evaluate {{output}} for correctness"\n`,
    );
    const s = parseScenario(yaml);
    const a = s.assertions[0];
    expect(a.type).toBe('llm_judge');
    if (a.type === 'llm_judge') expect(a.prompt).toMatch(/Evaluate/);
  });

  it('accepts an llm_judge assertion with all optional fields', () => {
    const yaml = minimalYaml.replace(
      /assertions:[\s\S]*$/,
      `assertions:
  - type: llm_judge
    prompt: "judge it: {{output}}"
    minScore: 8
    model: claude-3-5-haiku-20241022
    maxTokens: 2048
    temperature: 0.2
`,
    );
    const s = parseScenario(yaml);
    const a = s.assertions[0];
    if (a.type !== 'llm_judge') throw new Error('expected llm_judge');
    expect(a.minScore).toBe(8);
    expect(a.model).toBe('claude-3-5-haiku-20241022');
    expect(a.maxTokens).toBe(2048);
    expect(a.temperature).toBeCloseTo(0.2);
  });

  it('rejects llm_judge with empty prompt', () => {
    const yaml = minimalYaml.replace(
      /assertions:[\s\S]*$/,
      `assertions:\n  - type: llm_judge\n    prompt: ""\n`,
    );
    expect(() => parseScenario(yaml)).toThrow();
  });

  it('rejects llm_judge with minScore out of range', () => {
    const yaml = minimalYaml.replace(
      /assertions:[\s\S]*$/,
      `assertions:\n  - type: llm_judge\n    prompt: "x"\n    minScore: 11\n`,
    );
    expect(() => parseScenario(yaml)).toThrow();
  });
});

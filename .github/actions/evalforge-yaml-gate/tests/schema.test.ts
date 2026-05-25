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
});

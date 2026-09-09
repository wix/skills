import { describe, it, expect } from 'vitest';
import { readHeadRepoFullName, isSameRepoBranch, assertSameRepoBranch } from '../src/author-gate';

describe('readHeadRepoFullName', () => {
  it('reads the head repository off a pull_request payload', () => {
    expect(readHeadRepoFullName({ pull_request: { head: { repo: { full_name: 'wix/skills' } } } }))
      .toBe('wix/skills');
  });

  /**
   * `head.repo` is `oneOf: [repository, null]` in GitHub's payload schema — it goes null once
   * the source fork is deleted. That is a reachable state, not a malformed payload, and it is
   * certainly not this repository, so it reads as a refusal rather than an error.
   */
  it('returns null when GitHub reports no head repository', () => {
    expect(readHeadRepoFullName({ pull_request: { head: { repo: null } } })).toBeNull();
    expect(readHeadRepoFullName({ pull_request: { head: null } })).toBeNull();
    expect(readHeadRepoFullName({ pull_request: {} })).toBeNull();
    expect(readHeadRepoFullName({})).toBeNull();
  });

  it('ignores a non-string or empty full name rather than passing it on', () => {
    expect(readHeadRepoFullName({ pull_request: { head: { repo: { full_name: 42 } } } })).toBeNull();
    expect(readHeadRepoFullName({ pull_request: { head: { repo: { full_name: '  ' } } } })).toBeNull();
  });
});

describe('isSameRepoBranch', () => {
  it('accepts a branch pushed to this repository', () => {
    expect(isSameRepoBranch('wix/skills', 'wix', 'skills')).toBe(true);
  });

  // GitHub treats owner and repo names case-insensitively; a gate should not turn on casing.
  it('accepts it regardless of casing or surrounding space', () => {
    expect(isSameRepoBranch('Wix/Skills', 'wix', 'skills')).toBe(true);
    expect(isSameRepoBranch('  wix/skills  ', 'wix', 'skills')).toBe(true);
  });

  /**
   * The case the gate exists for: an outside contributor has no push access here, so their
   * branch lives in their own fork. wix/skills#1163 is exactly this.
   */
  it('refuses a fork', () => {
    expect(isSameRepoBranch('anupamme/skills', 'wix', 'skills')).toBe(false);
  });

  it('refuses a deleted head repository and a look-alike name', () => {
    expect(isSameRepoBranch(null, 'wix', 'skills')).toBe(false);
    expect(isSameRepoBranch('wix/skills-evil', 'wix', 'skills')).toBe(false);
    expect(isSameRepoBranch('notwix/skills', 'wix', 'skills')).toBe(false);
    expect(isSameRepoBranch('', 'wix', 'skills')).toBe(false);
  });
});

describe('assertSameRepoBranch', () => {
  it('passes a same-repo branch and logs why', () => {
    const lines: string[] = [];
    expect(() => assertSameRepoBranch('wix/skills', 'wix', 'skills', m => lines.push(m))).not.toThrow();
    expect(lines[0]).toContain('has write access');
  });

  it('throws for a fork, naming both repositories', () => {
    expect(() => assertSameRepoBranch('outsider/skills', 'wix', 'skills'))
      .toThrow(/head branch is in outsider\/skills, not wix\/skills/);
  });

  it('throws for a deleted head repository', () => {
    expect(() => assertSameRepoBranch(null, 'wix', 'skills'))
      .toThrow(/no longer exists/);
  });
});

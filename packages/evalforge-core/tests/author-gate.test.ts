import { describe, it, expect } from 'vitest';
import { isWixOrgAuthor, requireAuthorAssociation, assertWixAuthor } from '../src/author-gate';

describe('isWixOrgAuthor', () => {
  it('accepts org members and owners', () => {
    expect(isWixOrgAuthor('MEMBER')).toBe(true);
    expect(isWixOrgAuthor('OWNER')).toBe(true);
    expect(isWixOrgAuthor('  member  ')).toBe(true);
  });

  // Push access on the repo is not org membership: an outside collaborator can hold it
  // without being in the organization, so it must not open the gate.
  it('rejects a direct collaborator', () => {
    expect(isWixOrgAuthor('COLLABORATOR')).toBe(false);
  });

  it('rejects outside authors and missing associations', () => {
    expect(isWixOrgAuthor('CONTRIBUTOR')).toBe(false);
    expect(isWixOrgAuthor('FIRST_TIME_CONTRIBUTOR')).toBe(false);
    expect(isWixOrgAuthor('NONE')).toBe(false);
    expect(isWixOrgAuthor('')).toBe(false);
    expect(isWixOrgAuthor(undefined)).toBe(false);
    expect(isWixOrgAuthor(null)).toBe(false);
  });
});

describe('requireAuthorAssociation', () => {
  it('reads the association off a pull_request payload', () => {
    expect(requireAuthorAssociation({ pull_request: { author_association: 'MEMBER' } })).toBe('MEMBER');
  });

  /**
   * A gate that cannot identify the author must fail loudly. Returning a default here
   * would make a malformed payload look like an ordinary refusal, or worse a pass.
   */
  it('throws for a payload from any other event', () => {
    expect(() => requireAuthorAssociation({})).toThrow(/must be triggered by a pull_request event/);
    expect(() => requireAuthorAssociation({ pull_request: null })).toThrow(/pull_request event/);
  });

  it('throws when the PR object carries no usable association', () => {
    expect(() => requireAuthorAssociation({ pull_request: { number: 7 } }))
      .toThrow(/missing author_association/);
    expect(() => requireAuthorAssociation({ pull_request: { author_association: null } }))
      .toThrow(/missing author_association/);
    expect(() => requireAuthorAssociation({ pull_request: { author_association: 42 } }))
      .toThrow(/missing author_association/);
    expect(() => requireAuthorAssociation({ pull_request: { author_association: '  ' } }))
      .toThrow(/missing author_association/);
  });
});

describe('assertWixAuthor', () => {
  it('passes an org member and logs the association', () => {
    const lines: string[] = [];
    expect(() => assertWixAuthor('MEMBER', 'wix', m => lines.push(m))).not.toThrow();
    expect(lines).toEqual(['Author gate passed — PR author association: MEMBER']);
  });

  it('throws for an outside author, naming the association and the org', () => {
    expect(() => assertWixAuthor('CONTRIBUTOR', 'wix')).toThrow(
      /not a member of the wix organization \(author_association: CONTRIBUTOR\)/,
    );
  });

  /**
   * The gate reads no commit data at all, so there is nothing an author can set to
   * clear it — a commit author email is free text copied from `user.email`.
   */
  it('cannot be cleared by anything the author controls', () => {
    expect(() => assertWixAuthor('NONE', 'wix')).toThrow();
    expect(() => assertWixAuthor('ceo@wix.com', 'wix')).toThrow();
  });
});

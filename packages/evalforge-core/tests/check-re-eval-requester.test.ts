import { describe, it, expect, vi } from 'vitest';
import { checkReEvalRequester, type CollaboratorPermissionClient } from '../src/check-re-eval-requester';

const TARGET = { owner: 'wix', repo: 'skills', requester: 'someone', prAuthor: 'author' };

const clientWith = (getCollaboratorPermissionLevel: unknown): CollaboratorPermissionClient =>
  ({ rest: { repos: { getCollaboratorPermissionLevel } } }) as unknown as CollaboratorPermissionClient;

const permission = (level: string) => vi.fn().mockResolvedValue({ data: { permission: level } });

describe('checkReEvalRequester', () => {
  it('allows the PR author without calling GitHub', async () => {
    const lookup = vi.fn();
    const result = await checkReEvalRequester(clientWith(lookup), { ...TARGET, requester: 'author' });

    expect(result).toEqual({ allowed: true, via: 'author' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['admin', 'write'])('allows a %s collaborator', async (level) => {
    const lookup = permission(level);
    const result = await checkReEvalRequester(clientWith(lookup), TARGET);

    expect(result).toEqual({ allowed: true, via: 'collaborator' });
    expect(lookup).toHaveBeenCalledWith({ owner: 'wix', repo: 'skills', username: 'someone' });
  });

  it.each(['read', 'none'])('denies a %s collaborator', async (level) => {
    const result = await checkReEvalRequester(clientWith(permission(level)), TARGET);

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toContain('write access');
  });

  // The endpoint wants push access, so a 403 here is the expected failure, not an exotic one.
  it('denies and names the failure when the lookup throws', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('Resource not accessible by integration'));
    const result = await checkReEvalRequester(clientWith(lookup), TARGET);

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toContain('Resource not accessible by integration');
  });

  it('still allows the author when the lookup would throw', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('403'));
    const result = await checkReEvalRequester(clientWith(lookup), { ...TARGET, requester: 'author' });

    expect(result).toEqual({ allowed: true, via: 'author' });
  });

  // A permission the API might add later must not be read as approval.
  it('denies an unrecognised permission level', async () => {
    const result = await checkReEvalRequester(clientWith(permission('triage')), TARGET);

    expect(result.allowed).toBe(false);
  });

  it('denies when the response carries no permission at all', async () => {
    const lookup = vi.fn().mockResolvedValue({ data: {} });
    const result = await checkReEvalRequester(clientWith(lookup), TARGET);

    expect(result.allowed).toBe(false);
  });
});

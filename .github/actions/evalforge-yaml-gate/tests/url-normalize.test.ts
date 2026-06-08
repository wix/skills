import { describe, it, expect } from 'vitest';
import { normalizeUrl, isUrlShaped } from '../src/utils/url-normalize';

describe('isUrlShaped', () => {
  it('accepts https/http URLs', () => {
    expect(isUrlShaped('https://dev.wix.com/foo')).toBe(true);
    expect(isUrlShaped('http://x.com')).toBe(true);
  });
  it('rejects non-URLs and other schemes', () => {
    expect(isUrlShaped('POST')).toBe(false);
    expect(isUrlShaped('file:///etc/passwd')).toBe(false);
    expect(isUrlShaped('')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  const base = 'https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts';

  it('preserves a canonical URL', () => {
    expect(normalizeUrl(base)).toBe(base);
  });
  it('strips trailing slashes', () => {
    expect(normalizeUrl(base + '/')).toBe(base);
    expect(normalizeUrl(base + '///')).toBe(base);
  });
  it('lowercases scheme + host', () => {
    expect(normalizeUrl('HTTPS://Dev.Wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts')).toBe(base);
  });
  it('drops query and fragment', () => {
    expect(normalizeUrl(base + '?foo=bar#section')).toBe(base);
  });
  it('preserves non-default port in host', () => {
    expect(normalizeUrl('https://dev.wix.com:8443/foo')).toBe('https://dev.wix.com:8443/foo');
  });
  it('throws on non-URL inputs', () => {
    expect(() => normalizeUrl('not a url')).toThrow();
  });
});
